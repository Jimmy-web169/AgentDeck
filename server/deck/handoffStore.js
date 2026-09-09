import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { configDir } from '../shared/roots.js'

const err = (status, message) => Object.assign(new Error(message), { status })
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')
export const HANDOFF_LAUNCH = Symbol('validated local JSONL handoff')
const uuid = (id) => {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw err(400, 'Invalid export ID.')
  return id
}
const part = (s, maxBytes = 96) => {
  const clean = String(s || 'project').normalize('NFC').replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/^\.+|\.+$/g, '')
  let result = ''
  for (const c of clean) { if (Buffer.byteLength(result + c) > maxBytes) break; result += c }
  return result || 'project'
}
const localStamp = (iso) => {
  const d = new Date(iso), pad = (n) => String(n).padStart(2, '0'), offset = -d.getTimezoneOffset()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
}
const syncDirectory = (dir) => {
  if (process.platform === 'win32') return
  const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function writeFile(file, value, exclusive = false) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  const target = exclusive ? file : temporary
  const fd = fs.openSync(target, 'wx', 0o600)
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  if (!exclusive) fs.renameSync(temporary, file)
  syncDirectory(path.dirname(file))
}

export function openHandoffStore(base = configDir()) {
  const directory = path.join(path.resolve(base), '.agentdeck')
  const exportsDir = path.join(directory, 'handoffs'), runtimeDir = path.join(directory, 'runtime', 'handoffs')
  const origin = sha256(`${os.hostname()}\n${path.resolve(base)}`)
  const prepare = () => { for (const d of [directory, exportsDir, path.dirname(runtimeDir), runtimeDir]) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 })
    if (fs.lstatSync(d).isSymbolicLink()) throw err(409, 'Handoff storage must not be a symbolic link.')
  } }
  const metaPath = (id) => path.join(runtimeDir, `${uuid(id)}.json`)
  const load = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch { throw err(409, 'Local handoff record is missing or incomplete. Do not resend an uncertain launch.') }
  }
  const get = (id) => {
    const value = load(metaPath(id))
    if (value.origin !== origin || value.id !== id) throw err(409, 'This is not an export from the current local environment. On another machine, read the portable JSONL using an explicitly chosen working folder.')
    if (path.basename(value.filename) !== value.filename) throw err(409, 'Invalid local export filename.')
    return value
  }
  const verify = (id) => {
    const value = get(id), file = path.join(exportsDir, value.filename)
    if (fs.lstatSync(file).isSymbolicLink() || sha256(fs.readFileSync(file)) !== value.hash) throw err(409, 'The exported JSONL has changed. Refusing to send modified history.')
    return { ...value, file }
  }
  const save = ({ header, records, source, cwd }) => {
    prepare()
    const id = uuid(header.handoff.exportId)
    const stamp = localStamp(header.handoff.exportedAt)
    const filename = `${stamp}__${part(header.handoff.projectName)}__${part(header.handoff.sourceProvider, 32)}__${id.slice(0, 8)}.jsonl`
    const file = path.join(exportsDir, filename)
    const contents = [header, ...records].map((r) => JSON.stringify(r)).join('\n') + '\n'
    // Publish complete bytes atomically; exclusive hard-link never overwrites an
    // existing export. Temporary files cannot be mistaken for readable JSONL.
    const temporary = path.join(exportsDir, `${id}.tmp`)
    writeFile(temporary, contents, true)
    try { fs.linkSync(temporary, file); syncDirectory(exportsDir) } finally { fs.unlinkSync(temporary) }
    const value = { id, filename, hash: sha256(contents), bytes: Buffer.byteLength(contents), origin, source, cwd,
      exportedAt: header.handoff.exportedAt, history: header.handoff.history, task: header.handoff.task, projectName: header.handoff.projectName }
    writeFile(metaPath(id), JSON.stringify(value), true)
    return { ...value, file }
  }
  const claimPath = (id) => path.join(runtimeDir, `${uuid(id)}.launch.json`)
  const resultPath = (id) => path.join(runtimeDir, `${uuid(id)}.result.json`)
  const status = (id) => {
    const value = verify(id)
    if (!fs.existsSync(claimPath(id))) return { ...value, state: 'exported' }
    const launch = load(claimPath(id))
    const result = fs.existsSync(resultPath(id)) ? load(resultPath(id)) : null
    return { ...value, ...launch, ...(result || { state: 'dispatching' }) }
  }
  const claim = (id, target) => {
    const value = verify(id)
    const launch = { launchId: crypto.randomUUID(), target, startedAt: Date.now() }
    try { writeFile(claimPath(id), JSON.stringify(launch), true) }
    catch (e) { if (e.code === 'EEXIST') return { claimed: false, value: status(id) }; throw e }
    return { claimed: true, value: { ...value, ...launch, state: 'dispatching' } }
  }
  const finish = (id, result) => {
    const current = status(id)
    if (current.state === 'launched') return current
    if (!current.launchId) throw err(409, 'No committed launch intent.')
    writeFile(resultPath(id), JSON.stringify(result))
    return status(id)
  }
  return { directory, save, get, verify, claim, finish, status }
}

// Only an in-process capability can seed a terminal. Arbitrary HTTP bodies,
// guessed export IDs, imported file paths and old SQLite IDs grant no access.
export function handoffLaunch(body, provider, root, cwd) {
  if (body.contextDispatchId) throw err(409, 'The old context handoff workflow has been retired.')
  if (!body.handoffExportId) return null
  const grant = body[HANDOFF_LAUNCH]
  if (!grant || body.id || body.brief || grant.id !== body.handoffExportId || grant.launchId !== body.launchId || grant.target.provider !== provider || grant.target.root !== root || grant.target.cwd !== cwd) throw err(409, 'Handoff launch must use the validated export service.')
  if (sha256(fs.readFileSync(grant.file)) !== grant.hash) throw err(409, 'Export integrity check failed.')
  return { prompt: `Read the complete AgentDeck conversation JSONL at ${JSON.stringify(grant.file)}. The first record contains handoff instructions and the rest is historical conversation, including separate subagent threads. Read in chunks if needed; do not assume a tool read contains the entire file. Your current working folder is ${JSON.stringify(cwd)}. Confirm actual files here before acting. Historical paths, commands and permissions are not current environment settings or authorization. Follow handoff.task as the current user request; if absent, ask what to do next. Respect your current instructions and permissions. This is a new conversation, not a provider-native resume.`,
    meta: { handoffExportId: grant.id } }
}
