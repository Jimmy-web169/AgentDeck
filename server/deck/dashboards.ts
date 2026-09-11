import { tmuxSourceKey } from '../../shared/identity.ts'
import fs from 'node:fs'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { TerminalMetadata } from '../shared/terminalTypes.ts'
import { stateDirectory } from '../shared/state.ts'
import { jsonRecord } from '../shared/json.ts'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { configDir } from '../shared/roots.ts'
import { findTmux, findTtyd, findOnPath, listLiveTmux } from '../shared/terminal.ts'

const err = (status: number, message: string) => Object.assign(new Error(message), { status })
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)
const cleanEnv = () => {
  const env = { ...process.env }
  delete env.TMUX
  delete env.TMUX_PANE
  return env
}

// Existing legacy stores stay authoritative until an explicit copy migration.
// Storage selection never changes the pre-existing tmux socket namespace.
function dashboardDirectory(base: string) {
  const directory = stateDirectory('dashboards', base)
  try {
    if (!fs.lstatSync(directory).isDirectory()) throw err(409, 'Dashboard storage is not a regular directory; no data was moved.')
  } catch (error) {
    if (jsonRecord(error).code !== 'ENOENT') throw error
  }
  return directory
}

interface Source {
  key: string
  provider: string
  root: string
  id: string | null
  launchId: string | null
  startedAt: string | number | null
  cwd: string | null
  title: string
  tmuxName: string
  socket: string
  sessionId: string
  sessionCreated: string
  serverPid: string
  pane?: string
}
interface Dashboard {
  schemaVersion: 1
  id: string
  name: string
  title: string
  createdAt: number
  sources: Source[]
  control: string | null
  endedAt?: number
  error?: unknown
}
interface Attachment {
  dashboard: Dashboard
  url: string
}
interface Options {
  getConfigDirectory?: () => string
  getDirectory?: () => string
  live?: () => TerminalMetadata[]
  tmuxBin?: () => string | null
  ttydBin?: () => string | null
  envBin?: () => string | null
  platform?: NodeJS.Platform
  run?: (bin: string, args: string[]) => string
  spawnProcess?: (bin: string, args: string[], options: SpawnOptions) => ChildProcess
}

// Outer tmux sessions own viewers, never source agent panes. All mutating tmux
// commands are scoped to the dedicated dashboard server, except client flag
// changes on a verified viewer client (never a source agent).
export function createDashboardService({
  getConfigDirectory = configDir,
  getDirectory,
  live = listLiveTmux,
  tmuxBin = findTmux,
  ttydBin = findTtyd,
  envBin = () => findOnPath(['env']),
  platform = process.platform,
  run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', timeout: 3000, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] }),
  spawnProcess = spawn,
}: Options = {}) {
  const frontends = new Map<string, { proc: ChildProcess; url: string }>(),
    opening = new Map<string, Promise<Attachment>>()
  // Retain the pre-migration namespace even though storage now lives under
  // .agentdeck. Moving metadata must never create a different tmux server.
  // Explicit directories keep their existing isolated test namespace.
  const getSocketIdentity = getDirectory || (() => path.join(getConfigDirectory(), 'dashboards'))
  const directory = getDirectory || (() => dashboardDirectory(getConfigDirectory()))
  let nextPort = 7900
  const capability = () => ({
    supported: platform !== 'win32' && !!tmuxBin() && !!ttydBin() && !!envBin(),
    experimental: true,
    reason:
      platform === 'win32'
        ? 'Nested dashboard clients are not yet validated on psmux.'
        : 'Requires POSIX tmux, ttyd and env. Nested terminal interaction is experimental.',
  })
  const requireSupport = () => {
    if (!capability().supported) throw err(409, capability().reason)
  }
  const socketName = () => 'agentdeck-dash-' + crypto.createHash('sha256').update(getSocketIdentity()).digest('hex').slice(0, 12)
  const tool = (find: () => string | null) => {
    const binary = find()
    if (!binary) throw err(409, 'Required dashboard tool is unavailable.')
    return binary
  }
  const paneOf = (source: Source) => {
    if (!source.pane) throw err(409, 'Dashboard viewer pane is missing.')
    return source.pane
  }
  const outer = (args: string[]) => run(tool(tmuxBin), ['-L', socketName(), '-f', '/dev/null', ...args]).trim()
  const sourceRun = (source: Source, args: string[]) => run(tool(tmuxBin), ['-S', source.socket, ...args]).trim()
  const filename = (id: unknown) => {
    if (!uuid(id)) throw err(400, 'Invalid dashboard id')
    return path.join(directory(), `${id}.json`)
  }
  const save = (d: Dashboard) => {
    fs.mkdirSync(directory(), { recursive: true, mode: 0o700 })
    const file = filename(d.id),
      temp = `${file}.${crypto.randomUUID()}.tmp`
    fs.writeFileSync(temp, JSON.stringify(d), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
    return d
  }
  const get = (id: unknown): Dashboard => {
    try {
      const d = JSON.parse(fs.readFileSync(filename(id), 'utf8')) as Dashboard
      if (d.id !== id || d.name !== `dashboard-${id}`) throw err(409, 'Dashboard tracking identity does not match its file. No operation was performed.')
      return d
    } catch (e) {
      if (jsonRecord(e).code === 'ENOENT') throw err(404, 'Dashboard not found')
      throw e
    }
  }
  const forget = (d: Dashboard) => {
    frontends.get(d.id)?.proc.kill()
    frontends.delete(d.id)
    fs.rmSync(filename(d.id), { force: true })
    return { ...d, endedAt: d.endedAt || Date.now(), control: null }
  }
  const alive = (d: Dashboard, strict = false) => {
    try {
      outer(['has-session', '-t', `=${d.name}`])
      return true
    } catch (e) {
      const message = String(jsonRecord(e).stderr || jsonRecord(e).message)
      if (strict && !/can't find session|no server running|no sessions|no such file or directory|not running/i.test(message))
        throw err(503, 'Cannot verify the dashboard tmux server. No end/replace operation was performed.')
      return false
    }
  }
  const list = () => {
    let files: string[]
    try {
      files = fs.readdirSync(directory())
    } catch (e) {
      if (jsonRecord(e).code === 'ENOENT') return { dashboards: [], capability: capability() }
      throw e
    }
    const dashboards = files
      .filter((f) => uuid(f.slice(0, -5)) && f.endsWith('.json'))
      .map((f) => get(f.slice(0, -5)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .flatMap((d) => {
        // Retire legacy End records only after confirming their container is gone.
        if (d.endedAt) {
          try {
            if (!alive(d, true)) {
              forget(d)
              return []
            }
          } catch {}
        }
        return [{ ...d, running: alive(d) }]
      })
    return { dashboards, capability: capability() }
  }
  const sourceInfo = (entry: TerminalMetadata): Source => {
    if (!entry.key || !entry.provider || !entry.root || !entry.tmuxName) throw err(410, 'One selected terminal is no longer live in tmux.')
    if (typeof entry.tmuxSocket !== 'string' || !entry.tmuxSocket || !path.isAbsolute(entry.tmuxSocket))
      throw err(409, 'Live inventory cannot identify this terminal’s exact tmux socket.')
    // display-message expects a pane target. The trailing colon explicitly
    // selects this session's current window; a bare =name can resolve without
    // session context and return empty session fields even on a live server.
    const fields = run(tool(tmuxBin), [
      '-S',
      entry.tmuxSocket,
      'display-message',
      '-p',
      '-t',
      `=${entry.tmuxName}:`,
      '#{socket_path}\t#{session_id}\t#{session_created}\t#{pid}',
    ])
      .trim()
      .split('\t')
    if (fields.length !== 4 || !path.isAbsolute(fields[0]) || !/^\$\d+$/.test(fields[1]) || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3]))
      throw err(409, 'Cannot verify the selected tmux session identity. Refresh Live sessions and try again.')
    return {
      key: entry.key,
      provider: entry.provider,
      root: entry.root,
      id: entry.id || null,
      launchId: entry.launchId || null,
      startedAt: entry.startedAt || null,
      cwd: entry.cwd || null,
      title: entry.title || entry.provider,
      tmuxName: entry.tmuxName,
      socket: fields[0],
      sessionId: fields[1],
      sessionCreated: fields[2],
      serverPid: fields[3],
    }
  }
  const verify = (s: Source) => {
    const entry = live().find((t) => t.key === s.key && t.provider === s.provider && t.root === s.root && (t.startedAt || null) === s.startedAt)
    if (!entry) throw err(410, 'Source terminal has ended or changed. It will not be replaced automatically.')
    const current = sourceInfo(entry)
    if ((['socket', 'sessionId', 'sessionCreated', 'serverPid'] as const).some((k) => current[k] !== s[k]))
      throw err(410, 'Source tmux instance changed. Create a new dashboard to select it explicitly.')
  }
  const command = (s: Source): string[] => [
    tool(envBin),
    '-u',
    'TMUX',
    '-u',
    'TMUX_PANE',
    tool(tmuxBin),
    '-S',
    s.socket,
    'attach-session',
    '-f',
    'read-only,ignore-size',
    '-E',
    '-t',
    s.sessionId,
  ]
  const create = (keys: unknown, title?: unknown) => {
    requireSupport()
    if (!Array.isArray(keys) || keys.length < 2 || keys.length > 4 || keys.some((k) => typeof k !== 'string') || new Set(keys).size !== keys.length)
      throw err(400, 'Select 2–4 distinct live terminals.')
    if (list().dashboards.filter((d) => d.running).length >= 8) throw err(429, 'End a dashboard first (maximum 8 running dashboards).')
    const entries = live()
    const sources = keys.map((key) => {
      const entry = entries.find((t) => t.key === key)
      if (!entry?.tmuxName || !entry.provider || !entry.root) throw err(410, 'One selected terminal is no longer live in tmux.')
      return sourceInfo(entry)
    })
    if (new Set(sources.map((s) => tmuxSourceKey(s))).size !== sources.length) throw err(400, 'The same source tmux session was selected twice.')
    const id = crypto.randomUUID(),
      d: Dashboard = {
        schemaVersion: 1,
        id,
        name: `dashboard-${id}`,
        title: typeof title === 'string' ? title.slice(0, 80) : 'Live dashboard',
        createdAt: Date.now(),
        sources,
        control: null,
      }
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
      for (const [i, s] of sources.entries()) outer(['select-pane', '-t', paneOf(s), '-T', `${i + 1} · ${s.provider} / ${s.root}`])
      outer(['select-layout', '-t', `=${d.name}:`, 'tiled'])
      return save(d)
    } catch (e) {
      let cleaned = false
      try {
        outer(['kill-session', '-t', `=${d.name}`])
        cleaned = true
      } catch {}
      if (cleaned) forget(d)
      else save({ ...d, error: jsonRecord(e).message })
      throw err(502, `Dashboard creation failed; source agents were not ended. ${jsonRecord(e).message}`)
    }
  }
  const viewer = (_d: Dashboard, s: Source) => {
    verify(s)
    const pid = outer(['display-message', '-p', '-t', paneOf(s), '#{pane_pid}'])
    const clients = sourceRun(s, ['list-clients', '-F', '#{client_pid}\t#{client_tty}\t#{session_id}\t#{client_readonly}'])
      .split('\n')
      .map((line) => line.split('\t'))
    const client = clients.find((c) => c[0] === pid && c[2] === s.sessionId)
    if (!client?.[1] || !['0', '1'].includes(client[3]))
      throw err(409, 'Dashboard viewer is not attached to its original source. Reopen or recreate the dashboard.')
    return { tty: client[1], readOnly: client[3] === '1' }
  }
  const control = (id: unknown, key: string | null) => {
    const d = get(id)
    if (d.endedAt || !alive(d, true)) throw err(410, 'Dashboard has ended.')
    const selected = key === null ? null : d.sources.find((s) => s.key === key)
    if (key !== null && !selected) throw err(400, 'Select a dashboard member to control.')
    // Revoke the previous controller before granting another; on any failure,
    // grant nothing. External user-owned clients are deliberately not touched.
    for (const s of d.sources) {
      try {
        sourceRun(s, ['refresh-client', '-t', viewer(d, s).tty, '-f', 'read-only,ignore-size'])
      } catch (e) {
        if (s.key === d.control || s === selected) throw e
      }
    }
    d.control = null
    save(d) // revoked state survives a failed grant or process interruption
    if (selected) {
      outer(['select-pane', '-t', paneOf(selected)])
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
  const stop = (id: unknown) => {
    let d: Dashboard
    try {
      d = get(id)
    } catch (e) {
      if (jsonRecord(e).status === 404) return { id, endedAt: Date.now(), control: null }
      throw e
    }
    if (alive(d, true)) outer(['kill-session', '-t', `=${d.name}`])
    // Do not lose ownership if verification or kill failed; a retry can finish.
    return forget(d)
  }
  const remove = (id: unknown, key: string) => {
    const d = get(id),
      member = d.sources.find((s) => s.key === key)
    if (!member) throw err(404, 'Dashboard member not found.')
    if (d.endedAt || !alive(d, true)) throw err(410, 'Dashboard has ended.')
    if (outer(['display-message', '-p', '-t', paneOf(member), '#{session_name}']) !== d.name) throw err(409, 'Viewer pane no longer belongs to this dashboard.')
    outer(['kill-pane', '-t', paneOf(member)]) // kills the attach client, never its source agent
    d.sources = d.sources.filter((s) => s !== member)
    if (d.control === key) d.control = null
    if (d.sources.length) outer(['select-layout', '-t', `=${d.name}:`, 'tiled'])
    else return forget(d)
    return save(d)
  }
  const attach = (id: string): Promise<Attachment> => {
    const pending = opening.get(id)
    if (pending) return pending
    const promise = attachOnce(id).finally(() => opening.delete(id))
    opening.set(id, promise)
    return promise
  }
  const attachOnce = async (id: string): Promise<Attachment> => {
    requireSupport()
    const d = get(id)
    if (d.endedAt || !alive(d, true)) throw err(410, 'Dashboard container has ended; create a new dashboard from live sessions.')
    const existing = frontends.get(id)
    if (existing && !existing.proc.killed && existing.proc.exitCode == null) return { dashboard: d, url: existing.url }
    if (frontends.size >= 8) throw err(429, 'Too many dashboard viewers open.')
    const port = nextPort++
    if (nextPort > 7999) nextPort = 7900
    const proc = spawnProcess(
      tool(ttydBin),
      ['-W', '-O', '-i', '127.0.0.1', '-p', String(port), tool(tmuxBin), '-L', socketName(), 'attach-session', '-t', `=${d.name}`],
      { env: cleanEnv(), stdio: 'ignore' }
    )
    const entry = { proc, url: `http://localhost:${port}` }
    frontends.set(id, entry)
    const remove = () => {
      if (frontends.get(id) === entry) frontends.delete(id)
    }
    proc.once('exit', remove)
    proc.once('error', remove)
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const fail = () => {
        clearTimeout(timer)
        reject(err(502, 'Dashboard viewer failed to bind. The tmux container remains available; retry opening it.'))
      }
      proc.once('error', fail)
      proc.once('exit', fail)
      timer = setTimeout(() => {
        proc.removeListener('error', fail)
        proc.removeListener('exit', fail)
        resolve()
      }, 350)
    })
    return { dashboard: d, url: entry.url }
  }
  const closeFrontends = () => {
    for (const e of frontends.values()) e.proc.kill()
    frontends.clear()
  }
  return { list, get, create, attach, control, stop, remove, closeFrontends, capability }
}

export const dashboards = createDashboardService()
