import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { configDir } from '../shared/roots.js'
import { findTmux, findTtyd, findOnPath, listLiveTmux } from '../shared/terminal.js'

const err = (status, message) => Object.assign(new Error(message), { status })
const uuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)
const cleanEnv = () => { const env = { ...process.env }; delete env.TMUX; delete env.TMUX_PANE; return env }

// Run on first access after upgrade, not at module import. Rename the complete
// store (including interrupted-write files) rather than copying stale records.
// If both stores exist, leave both untouched for explicit conflict resolution.
function dashboardDirectory(base) {
  const legacy = path.join(base, 'dashboards')
  const directory = path.join(base, '.agentdeck', 'dashboards')
  let previous
  try { previous = fs.lstatSync(legacy) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (!previous) return directory
  if (!previous.isDirectory()) throw err(409, 'Legacy dashboard storage is not a directory; no data was moved.')
  let destination
  try { destination = fs.lstatSync(directory) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (destination) throw err(409, 'Both dashboards/ and .agentdeck/dashboards/ exist. Resolve the storage conflict before continuing; neither was changed.')
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 })
  fs.renameSync(legacy, directory)
  return directory
}

// Outer tmux sessions own viewers, never source agent panes. All mutating tmux
// commands are scoped to the dedicated dashboard server, except client flag
// changes on a verified viewer client (never a source agent).
export function createDashboardService({ getConfigDirectory = configDir, getDirectory, live = listLiveTmux,
  tmuxBin = findTmux, ttydBin = findTtyd, envBin = () => findOnPath(['env']), platform = process.platform,
  run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', timeout: 3000, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }), spawnProcess = spawn } = {}) {
  const frontends = new Map(), opening = new Map()
  // Retain the pre-migration namespace even though storage now lives under
  // .agentdeck. Moving metadata must never create a different tmux server.
  // Explicit directories keep their existing isolated test namespace.
  const getSocketIdentity = getDirectory || (() => path.join(getConfigDirectory(), 'dashboards'))
  getDirectory ||= () => dashboardDirectory(getConfigDirectory())
  let nextPort = 7900
  const capability = () => ({ supported: platform !== 'win32' && !!tmuxBin() && !!ttydBin() && !!envBin(), experimental: true,
    reason: platform === 'win32' ? 'Nested dashboard clients are not yet validated on psmux.' : 'Requires POSIX tmux, ttyd and env. Nested terminal interaction is experimental.' })
  const requireSupport = () => { if (!capability().supported) throw err(409, capability().reason) }
  const socketName = () => 'agentdeck-dash-' + crypto.createHash('sha256').update(getSocketIdentity()).digest('hex').slice(0, 12)
  const outer = (args) => run(tmuxBin(), ['-L', socketName(), '-f', '/dev/null', ...args]).trim()
  const sourceRun = (source, args) => run(tmuxBin(), ['-S', source.socket, ...args]).trim()
  const filename = (id) => { if (!uuid(id)) throw err(400, 'Invalid dashboard id'); return path.join(getDirectory(), `${id}.json`) }
  const save = (d) => {
    fs.mkdirSync(getDirectory(), { recursive: true, mode: 0o700 })
    const file = filename(d.id), temp = `${file}.${crypto.randomUUID()}.tmp`
    fs.writeFileSync(temp, JSON.stringify(d), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
    return d
  }
  const get = (id) => {
    try {
      const d = JSON.parse(fs.readFileSync(filename(id), 'utf8'))
      if (d.id !== id || d.name !== `dashboard-${id}`) throw err(409, 'Dashboard tracking identity does not match its file. No operation was performed.')
      return d
    }
    catch (e) { if (e.code === 'ENOENT') throw err(404, 'Dashboard not found'); throw e }
  }
  const forget = (d) => {
    frontends.get(d.id)?.proc.kill(); frontends.delete(d.id)
    fs.rmSync(filename(d.id), { force: true })
    return { ...d, endedAt: d.endedAt || Date.now(), control: null }
  }
  const alive = (d, strict = false) => {
    try { outer(['has-session', '-t', `=${d.name}`]); return true }
    catch (e) {
      const message = String(e.stderr || e.message)
      if (strict && !/can't find session|no server running|no sessions|no such file or directory|not running/i.test(message)) throw err(503, 'Cannot verify the dashboard tmux server. No end/replace operation was performed.')
      return false
    }
  }
  const list = () => {
    let files
    try { files = fs.readdirSync(getDirectory()) } catch (e) { if (e.code === 'ENOENT') return { dashboards: [], capability: capability() }; throw e }
    const dashboards = files.filter((f) => uuid(f.slice(0, -5)) && f.endsWith('.json')).map((f) => get(f.slice(0, -5)))
      .sort((a, b) => b.createdAt - a.createdAt).flatMap((d) => {
        // Retire legacy End records only after confirming their container is gone.
        if (d.endedAt) {
          try { if (!alive(d, true)) { forget(d); return [] } } catch {}
        }
        return [{ ...d, running: alive(d) }]
      })
    return { dashboards, capability: capability() }
  }
  const sourceInfo = (entry) => {
    if (!entry.tmuxSocket || !path.isAbsolute(entry.tmuxSocket)) throw err(409, 'Live inventory cannot identify this terminal’s exact tmux socket.')
    // display-message expects a pane target. The trailing colon explicitly
    // selects this session's current window; a bare =name can resolve without
    // session context and return empty session fields even on a live server.
    const fields = run(tmuxBin(), ['-S', entry.tmuxSocket, 'display-message', '-p', '-t', `=${entry.tmuxName}:`, '#{socket_path}\t#{session_id}\t#{session_created}\t#{pid}']).trim().split('\t')
    if (fields.length !== 4 || !path.isAbsolute(fields[0]) || !/^\$\d+$/.test(fields[1]) || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3])) throw err(409, 'Cannot verify the selected tmux session identity. Refresh Live sessions and try again.')
    return { key: entry.key, provider: entry.provider, root: entry.root, id: entry.id || null, launchId: entry.launchId || null,
      startedAt: entry.startedAt || null, cwd: entry.cwd || null, title: entry.title || entry.provider, tmuxName: entry.tmuxName,
      socket: fields[0], sessionId: fields[1], sessionCreated: fields[2], serverPid: fields[3] }
  }
  const verify = (s) => {
    const entry = live().find((t) => t.key === s.key && t.provider === s.provider && t.root === s.root && (t.startedAt || null) === s.startedAt)
    if (!entry) throw err(410, 'Source terminal has ended or changed. It will not be replaced automatically.')
    const current = sourceInfo(entry)
    if (['socket', 'sessionId', 'sessionCreated', 'serverPid'].some((k) => current[k] !== s[k])) throw err(410, 'Source tmux instance changed. Create a new dashboard to select it explicitly.')
  }
  const command = (s) => [envBin(), '-u', 'TMUX', '-u', 'TMUX_PANE', tmuxBin(), '-S', s.socket, 'attach-session', '-f', 'read-only,ignore-size', '-E', '-t', s.sessionId]
  const create = (keys, title) => {
    requireSupport()
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > 4 || keys.some((k) => typeof k !== 'string') || new Set(keys).size !== keys.length) throw err(400, 'Select 2–4 distinct live terminals.')
    if (list().dashboards.filter((d) => d.running).length >= 8) throw err(429, 'End a dashboard first (maximum 8 running dashboards).')
    const entries = live()
    const sources = keys.map((key) => {
      const entry = entries.find((t) => t.key === key)
      if (!entry?.tmuxName || !entry.provider || !entry.root) throw err(410, 'One selected terminal is no longer live in tmux.')
      return sourceInfo(entry)
    })
    if (new Set(sources.map((s) => JSON.stringify([s.socket, s.sessionId]))).size !== sources.length) throw err(400, 'The same source tmux session was selected twice.')
    const id = crypto.randomUUID(), d = { schemaVersion: 1, id, name: `dashboard-${id}`, title: typeof title === 'string' ? title.slice(0, 80) : 'Live dashboard', createdAt: Date.now(), sources, control: null }
    save(d) // persist membership before starting a container; never re-enrol sources after a crash
    try {
      for (const s of sources) verify(s)
      sources[0].pane = outer(['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', d.name, '-x', '180', '-y', '50', '--', ...command(sources[0])])
      outer(['set-option', '-t', `=${d.name}:`, 'prefix', 'C-a'])
      outer(['set-option', '-t', `=${d.name}:`, 'mouse', 'on'])
      outer(['set-window-option', '-t', `=${d.name}:`, 'remain-on-exit', 'on'])
      outer(['set-window-option', '-t', `=${d.name}:`, 'pane-border-status', 'top'])
      outer(['set-window-option', '-t', `=${d.name}:`, 'pane-border-format', '#{pane_index} · #{pane_title}'])
      for (const s of sources.slice(1)) s.pane = outer(['split-window', '-d', '-P', '-F', '#{pane_id}', '-t', `=${d.name}:`, '--', ...command(s)])
      for (const [i, s] of sources.entries()) outer(['select-pane', '-t', s.pane, '-T', `${i + 1} · ${s.provider} / ${s.root}`])
      outer(['select-layout', '-t', `=${d.name}:`, 'tiled'])
      return save(d)
    } catch (e) {
      let cleaned = false
      try { outer(['kill-session', '-t', `=${d.name}`]); cleaned = true } catch {}
      if (cleaned) forget(d)
      else save({ ...d, error: e.message })
      throw err(502, `Dashboard creation failed; source agents were not ended. ${e.message}`)
    }
  }
  const viewer = (d, s) => {
    verify(s)
    const pid = outer(['display-message', '-p', '-t', s.pane, '#{pane_pid}'])
    const clients = sourceRun(s, ['list-clients', '-F', '#{client_pid}\t#{client_tty}\t#{session_id}\t#{client_readonly}']).split('\n').map((line) => line.split('\t'))
    const client = clients.find((c) => c[0] === pid && c[2] === s.sessionId)
    if (!client?.[1] || !['0', '1'].includes(client[3])) throw err(409, 'Dashboard viewer is not attached to its original source. Reopen or recreate the dashboard.')
    return { tty: client[1], readOnly: client[3] === '1' }
  }
  const control = (id, key) => {
    const d = get(id)
    if (d.endedAt || !alive(d, true)) throw err(410, 'Dashboard has ended.')
    const selected = key === null ? null : d.sources.find((s) => s.key === key)
    if (key !== null && !selected) throw err(400, 'Select a dashboard member to control.')
    // Revoke the previous controller before granting another; on any failure,
    // grant nothing. External user-owned clients are deliberately not touched.
    for (const s of d.sources) {
      try { sourceRun(s, ['refresh-client', '-t', viewer(d, s).tty, '-f', 'read-only,ignore-size']) }
      catch (e) { if (s.key === d.control || s === selected) throw e }
    }
    d.control = null
    save(d) // revoked state survives a failed grant or process interruption
    if (selected) {
      outer(['select-pane', '-t', selected.pane])
      const client = viewer(d, selected)
      if (!client.readOnly) throw err(409, 'Viewer did not enter read-only mode; control was not granted.')
      try {
        // tmux 3.6a deliberately refuses to clear read-only with refresh -f.
        // switch-client -r is the supported toggle. We first verify the revoked
        // state, then restore ignore-size (the toggle flips both flags).
        sourceRun(selected, ['switch-client', '-c', client.tty, '-t', selected.sessionId, '-E', '-r'])
        sourceRun(selected, ['refresh-client', '-t', client.tty, '-f', 'ignore-size'])
        if (viewer(d, selected).readOnly) throw err(409, 'tmux did not grant viewer control.')
      } catch (e) {
        // A partial grant must not leave an apparently read-only viewer writable.
        sourceRun(selected, ['refresh-client', '-t', viewer(d, selected).tty, '-f', 'read-only,ignore-size'])
        throw e
      }
    }
    d.control = key
    return save(d)
  }
  const stop = (id) => {
    let d
    try { d = get(id) } catch (e) { if (e.status === 404) return { id, endedAt: Date.now(), control: null }; throw e }
    if (alive(d, true)) outer(['kill-session', '-t', `=${d.name}`])
    // Do not lose ownership if verification or kill failed; a retry can finish.
    return forget(d)
  }
  const remove = (id, key) => {
    const d = get(id), member = d.sources.find((s) => s.key === key)
    if (!member) throw err(404, 'Dashboard member not found.')
    if (d.endedAt || !alive(d, true)) throw err(410, 'Dashboard has ended.')
    if (outer(['display-message', '-p', '-t', member.pane, '#{session_name}']) !== d.name) throw err(409, 'Viewer pane no longer belongs to this dashboard.')
    outer(['kill-pane', '-t', member.pane]) // kills the attach client, never its source agent
    d.sources = d.sources.filter((s) => s !== member)
    if (d.control === key) d.control = null
    if (d.sources.length) outer(['select-layout', '-t', `=${d.name}:`, 'tiled'])
    else return forget(d)
    return save(d)
  }
  const attach = (id) => {
    if (opening.has(id)) return opening.get(id)
    const promise = attachOnce(id).finally(() => opening.delete(id))
    opening.set(id, promise)
    return promise
  }
  const attachOnce = async (id) => {
    requireSupport()
    const d = get(id)
    if (d.endedAt || !alive(d, true)) throw err(410, 'Dashboard container has ended; create a new dashboard from live sessions.')
    const existing = frontends.get(id)
    if (existing && !existing.proc.killed && existing.proc.exitCode == null) return { dashboard: d, url: existing.url }
    if (frontends.size >= 8) throw err(429, 'Too many dashboard viewers open.')
    const port = nextPort++
    if (nextPort > 7999) nextPort = 7900
    const proc = spawnProcess(ttydBin(), ['-W', '-O', '-i', '127.0.0.1', '-p', String(port), tmuxBin(), '-L', socketName(), 'attach-session', '-t', `=${d.name}`], { env: cleanEnv(), stdio: 'ignore' })
    const entry = { proc, url: `http://localhost:${port}` }
    frontends.set(id, entry)
    const remove = () => { if (frontends.get(id) === entry) frontends.delete(id) }
    proc.once('exit', remove); proc.once('error', remove)
    await new Promise((resolve, reject) => {
      let timer
      const fail = () => { clearTimeout(timer); reject(err(502, 'Dashboard viewer failed to bind. The tmux container remains available; retry opening it.')) }
      proc.once('error', fail); proc.once('exit', fail)
      timer = setTimeout(() => { proc.removeListener('error', fail); proc.removeListener('exit', fail); resolve() }, 350)
    })
    return { dashboard: d, url: entry.url }
  }
  const closeFrontends = () => { for (const e of frontends.values()) e.proc.kill(); frontends.clear() }
  return { list, get, create, attach, control, stop, remove, closeFrontends, capability }
}

export const dashboards = createDashboardService()
