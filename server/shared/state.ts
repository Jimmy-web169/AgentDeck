import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export function configDir() {
  const value = process.env.AGENTDECK_CONFIG_DIR?.trim()
  return value ? path.resolve(value) : REPO
}
export const stateDir = (base = configDir()) => path.join(base, '.agentdeck')
type FileOwner = 'roots' | 'probe'
type DirectoryOwner = 'handoffs' | 'dashboards'
function identifier(id: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Invalid state owner id')
  return id
}

// A current owner always takes precedence; a legacy file is read only while no
// current one exists. Fresh installs write only below .agentdeck; no directory
// is created by reads. Startup converges existing installations (see
// migrateStateOnStartup) without ever removing the legacy fallback.
export function stateFile(owner: FileOwner, id: string, base = configDir()) {
  identifier(id)
  const current = path.join(stateDir(base), owner, `${id}.json`)
  const legacy = path.join(base, `${owner}.${id}.json`)
  return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy
}
export function stateDirectory(owner: DirectoryOwner, base = configDir()) {
  const current = path.join(stateDir(base), owner),
    legacy = path.join(base, owner)
  // An interrupted explicit copy must not hide the uncopied legacy records.
  if (fs.existsSync(path.join(current, '.migration-pending')) && fs.existsSync(legacy)) return legacy
  return fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy
}

export interface MigrationEntry {
  kind?: 'directory'
  source: string
  destination: string
  status: 'copy' | 'identical' | 'conflict' | 'blocked' | 'copied'
  reason?: string
  hash?: string
}
const hash = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex')
function safeDestination(base: string, file: string) {
  const rel = path.relative(base, file)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error('Migration path escapes config directory')
  let parent = path.dirname(file)
  while (parent !== base) {
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) throw Error(`Destination parent is a symlink: ${parent}`)
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
    }
    parent = path.dirname(parent)
  }
}

// Dry-run inventories bytes and conflicts only. Apply is a separate explicit
// operation, performed with the running service stopped; no legacy file moves.
export function planStateMigration(directory = configDir()): MigrationEntry[] {
  const base = fs.realpathSync(directory),
    entries: MigrationEntry[] = []
  const add = (source: string, destination: string) => {
    const entry: MigrationEntry = { source, destination, status: 'copy' }
    entries.push(entry)
    try {
      if (!fs.lstatSync(source).isFile()) throw Error('Source is not a regular file')
      safeDestination(base, destination)
      const bytes = fs.readFileSync(source)
      if (source.endsWith('.json')) JSON.parse(bytes.toString('utf8'))
      entry.hash = hash(bytes)
      if (fs.existsSync(destination)) {
        if (!fs.lstatSync(destination).isFile()) throw Error('Destination is not a regular file')
        entry.status = hash(fs.readFileSync(destination)) === entry.hash ? 'identical' : 'conflict'
      }
    } catch (error) {
      entry.status = 'blocked'
      entry.reason = error instanceof Error ? error.message : String(error)
    }
  }
  const walk = (source: string, destination: string) => {
    const children = fs.readdirSync(source, { withFileTypes: true })
    if (!children.length) {
      const entry: MigrationEntry = { source, destination, kind: 'directory', status: 'copy' }
      entries.push(entry)
      try {
        safeDestination(base, destination)
        if (fs.existsSync(destination)) {
          if (!fs.lstatSync(destination).isDirectory()) throw Error('Destination is not a regular directory')
          entry.status = 'identical'
        }
      } catch (error) {
        entry.status = 'blocked'
        entry.reason = error instanceof Error ? error.message : String(error)
      }
    }
    for (const entry of children) {
      if (entry.name.endsWith('.migrated')) continue
      const file = path.join(source, entry.name),
        target = path.join(destination, entry.name)
      if (entry.isDirectory()) walk(file, target)
      else add(file, target)
    }
  }
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const match = /^(roots|probe)\.([a-z][a-z0-9-]*)\.json$/.exec(entry.name)
    if (match) add(path.join(base, entry.name), path.join(stateDir(base), match[1], `${match[2]}.json`))
    else if (entry.name === 'handoffs' || entry.name === 'dashboards') {
      if (entry.isDirectory()) walk(path.join(base, entry.name), path.join(stateDir(base), entry.name))
      else
        entries.push({
          source: path.join(base, entry.name),
          destination: path.join(stateDir(base), entry.name),
          status: 'blocked',
          reason: 'Legacy directory is not a regular directory',
        })
    }
  }
  return entries.sort((a, b) => a.source.localeCompare(b.source))
}

export function applyStateMigration(directory = configDir()): MigrationEntry[] {
  const base = fs.realpathSync(directory),
    entries = planStateMigration(base)
  if (entries.some((entry) => entry.status === 'blocked' || entry.status === 'conflict'))
    throw Object.assign(Error('Migration has blocked or conflicting files; no copies were made'), { entries })
  const pending: string[] = []
  for (const owner of ['handoffs', 'dashboards'] as const) {
    const target = path.join(stateDir(base), owner),
      marker = path.join(target, '.migration-pending')
    if (!entries.some((entry) => entry.destination === target || entry.destination.startsWith(`${target}${path.sep}`))) continue
    if (!fs.existsSync(target) || fs.existsSync(marker)) {
      safeDestination(base, marker)
      fs.mkdirSync(target, { recursive: true, mode: 0o700 })
      if (!fs.existsSync(marker)) fs.writeFileSync(marker, 'Legacy storage remains authoritative until every copy is verified.\n', { flag: 'wx', mode: 0o600 })
      pending.push(marker)
    }
  }
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      if (!fs.lstatSync(entry.source).isDirectory()) throw Error(`Source changed during migration: ${entry.source}`)
      safeDestination(base, entry.destination)
      fs.mkdirSync(entry.destination, { recursive: true, mode: 0o700 })
      if (entry.status === 'copy') entry.status = 'copied'
      continue
    }
    const before = fs.statSync(entry.source),
      bytes = fs.readFileSync(entry.source),
      after = fs.statSync(entry.source)
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || hash(bytes) !== entry.hash)
      throw Error(`Source changed during migration: ${entry.source}`)
    if (entry.status === 'copy') {
      safeDestination(base, entry.destination)
      fs.mkdirSync(path.dirname(entry.destination), { recursive: true, mode: 0o700 })
      const temporary = `${entry.destination}.${crypto.randomUUID()}.tmp`
      const failures: unknown[] = []
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600)
        try {
          fs.writeFileSync(fd, bytes)
          fs.fsyncSync(fd)
        } finally {
          fs.closeSync(fd)
        }
        fs.linkSync(temporary, entry.destination)
      } catch (error) {
        failures.push(error)
      }
      try {
        fs.unlinkSync(temporary)
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) failures.push(error)
      }
      if (failures.length > 1) throw new AggregateError(failures, `Migration copy and cleanup failed: ${entry.source}`)
      if (failures.length) throw failures[0]
      entry.status = 'copied'
    }
    const marker = `${entry.source}.migrated`
    if (!fs.existsSync(marker))
      fs.writeFileSync(marker, `${JSON.stringify({ destination: entry.destination, sha256: entry.hash })}\n`, { flag: 'wx', mode: 0o600 })
  }
  // Recheck all sources and destinations before switching a directory owner.
  // If verification fails, its pending marker keeps the intact legacy view.
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      if (!fs.lstatSync(entry.source).isDirectory() || !fs.lstatSync(entry.destination).isDirectory())
        throw Error(`Migration verification failed: ${entry.source}`)
      continue
    }
    if (hash(fs.readFileSync(entry.source)) !== entry.hash || hash(fs.readFileSync(entry.destination)) !== entry.hash)
      throw Error(`Migration verification failed: ${entry.source}`)
  }
  for (const marker of pending) fs.unlinkSync(marker)
  return entries
}

export interface StartupMigration {
  status: 'none' | 'current' | 'copied' | 'skipped' | 'failed'
  entries: MigrationEntry[]
  error?: string
}

// Every start copies clean legacy state into .agentdeck/, so installations
// converge without an operator step, and never destroys the fallback: originals
// are retained, conflicting or blocked entries leave the legacy files
// authoritative (reported for `npm run migrate:state`), and a copy that fails
// part-way leaves the resolution rules above pointing at intact legacy files.
export function migrateStateOnStartup(directory = configDir()): StartupMigration {
  let entries: MigrationEntry[]
  try {
    entries = planStateMigration(directory)
  } catch (error) {
    return { status: 'failed', entries: [], error: error instanceof Error ? error.message : String(error) }
  }
  if (!entries.length) return { status: 'none', entries }
  if (entries.every((entry) => entry.status === 'identical')) return { status: 'current', entries }
  if (entries.some((entry) => entry.status === 'blocked' || entry.status === 'conflict')) return { status: 'skipped', entries }
  try {
    return { status: 'copied', entries: applyStateMigration(directory) }
  } catch (error) {
    return { status: 'failed', entries, error: error instanceof Error ? error.message : String(error) }
  }
}
