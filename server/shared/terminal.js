import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { findTerminal } from './terminalIdentity.js'
import { processFiles } from './terminalDiscovery.js'

// Shared embedded-terminal pool. Runs a provider's real CLI TUI inside a ttyd
// process (webterm.js, our node-pty stand-in, on native Windows) and serves it
// to the browser. Keys include provider + root + launch/session identity.
// Provider behavior is supplied by registered adapters (see docs/TERMINALS.md).
// `checkOrigin` adds ttyd's -O flag (origin check) — providers opt in per their
// embedding needs, so neither provider's original behavior changes.
//
// When tmux is available the CLI runs inside a named tmux session rather than as
// ttyd's direct child. ttyd just attaches to it, so the session survives ttyd /
// server teardown (it detaches instead of dying), can be attached from a real
// terminal with `tmux attach -t <name>`, and re-attaches with full state when
// reopened. End (stopTerminal) kills the tmux session; a server shutdown leaves
// it alive on purpose.

const MAX = 6 // concurrent embedded terminals
const PORT_BASE = 7682
const PORT_MAX = 7781
const sessions = new Map() // key -> { proc, port, url, meta }
const providers = new Map()
const opening = new Map()
export function registerTerminalProvider(config) { providers.set(config.id, config) }
const metadataOf = (value = {}) => Object.fromEntries(Object.entries(value).filter(([k]) => !['url', 'port', 'alive', 'tmux', 'tmuxName', 'attached', 'ok', 'reused', 'requestedTarget'].includes(k)))
let nextPort = PORT_BASE

const IS_WIN = process.platform === 'win32'
// On native Windows ttyd's latest release (1.7.7) crashes when spawning the CLI
// (tsl0922/ttyd#1292), so the browser terminal is served by our own node-pty
// based stand-in instead. tmux duties are covered by psmux's tmux.exe alias.
const WEBTERM = fileURLToPath(new URL('./webterm.js', import.meta.url))

export function findOnPath(names, extra = []) {
  // Windows executables carry an extension; `claude` on PATH is claude.exe/.cmd
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']
  const cands = []
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    // `npm run` prepends the project's node_modules/.bin — never run a bundled
    // CLI (e.g. the codex SDK ships an old `codex`) in the embedded terminal.
    if (!d || /node_modules[\\/]\.bin$/i.test(d)) continue
    for (const n of names) for (const e of exts) cands.push(path.join(d, n + e))
  }
  for (const x of extra) for (const e of exts) cands.push(x + e)
  return (
    cands.find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    }) || null
  )
}

// npm global installs on Windows expose only .cmd/.ps1 shims, and Node's spawn
// refuses .cmd/.bat without shell:true (CVE-2024-27980 hardening) — SDKs that
// spawn the resolved path directly throw EINVAL. Dig the real vendored .exe out
// of the npm package behind the shim. Breadth-first with a depth cap: the vendor
// layout moves between package versions, so a fixed path would rot.
export function resolveVendoredExe(bin, pkgName, exeName) {
  if (!IS_WIN || !bin || !/\.(cmd|bat|ps1)$/i.test(bin)) return bin
  const pkgDir = path.join(path.dirname(bin), 'node_modules', ...pkgName.split('/'))
  const queue = [[pkgDir, 0]]
  while (queue.length) {
    const [dir, depth] = queue.shift()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isFile() && e.name.toLowerCase() === exeName) return p
      if (e.isDirectory() && depth < 6) queue.push([p, depth + 1])
    }
  }
  return bin // nothing vendored — hand back the shim so the caller's error surfaces
}

let ttydBin
export const findTtyd = () => (ttydBin !== undefined ? ttydBin : (ttydBin = findOnPath(['ttyd'], ['/opt/homebrew/bin/ttyd', '/usr/local/bin/ttyd'])))

// On Windows "tmux" is psmux's tmux-compatible alias. winget's portable install
// adds its package dir to the *user* PATH, which a server started from an older
// shell won't have — so also try that deterministic install location directly.
const TMUX_EXTRA = IS_WIN
  ? [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'marlocarlo.psmux_Microsoft.Winget.Source_8wekyb3d8bbwe', 'tmux'),
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'tmux'),
    ]
  : ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']
let tmuxBin
export const findTmux = () => (tmuxBin !== undefined ? tmuxBin : (tmuxBin = findOnPath(['tmux'], TMUX_EXTRA)))

// A stable, collision-free tmux session name derived from the terminal key, so
// reopening the same monitored session always re-attaches the same tmux session.
function tmuxSessionName(key) {
  return `agentdeck-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`
}

function killTmuxSession(name) {
  const tmux = findTmux()
  if (!tmux) return
  try {
    execFileSync(tmux, ['kill-session', '-t', `=${name}`], { stdio: 'ignore', timeout: 2000 })
  } catch {}
}

function pickPort() {
  const used = new Set([...sessions.values()].map((s) => s.port))
  for (let i = 0; i <= PORT_MAX - PORT_BASE; i++) {
    const p = PORT_BASE + ((nextPort - PORT_BASE + i) % (PORT_MAX - PORT_BASE + 1))
    if (!used.has(p)) {
      nextPort = p + 1
      return p
    }
  }
  return null
}

function err(status, message) {
  return Object.assign(new Error(message), { status })
}

// Start (or reuse) a ttyd terminal running the provider's CLI (optionally
// resuming a session). Resolves only after ttyd has had a moment to bind, so a
// bad binary / taken port fails loudly instead of handing the browser a dead iframe.
export function startTerminal(options) {
  const { key } = options
  if (opening.has(key)) return opening.get(key)
  const promise = Promise.resolve().then(() => startTerminalOnce(options)).finally(() => opening.delete(key))
  opening.set(key, promise)
  return promise
}

function startTerminalOnce({ key, cwd, configDir, resumeId, promptArgs = null, meta, config, attach = null }) {
  meta = metadataOf(meta)
  const existing = sessions.get(key)
  if (existing && existing.proc && existing.proc.exitCode == null && !existing.proc.killed) {
    if (meta) existing.meta = { ...existing.meta, ...meta }
    return { key, ...existing.meta, url: existing.url, port: existing.port, reused: true }
  }
  if (sessions.size >= MAX) throw err(429, `Too many embedded terminals open (max ${MAX}). End one from Live sessions first.`)
  const ttyd = IS_WIN ? null : findTtyd() // win32 uses the built-in webterm instead
  if (!IS_WIN && !ttyd) throw err(404, 'ttyd not found — install it (e.g. `brew install ttyd`) to use terminal mode.')
  const bin = attach ? null : config.findBin()
  if (!attach && !bin) throw err(404, `${config.title} executable not found`)
  const port = pickPort()
  if (port == null) throw err(503, 'no free port for a terminal')

  // resume an existing session, or start seeded with a prompt (AI hand-off), or plain
  const prepared = (!attach && config.prepareLaunch ? config.prepareLaunch({ bin, key, cwd, configDir, resumeId, meta }) : null) || {}
  meta = { ...meta, ...prepared.meta, provider: config.id, configDir, canBindSession: !!config.resolveSavedSession, startedAt: meta?.startedAt || Date.now() }
  const cliArgs = [...(prepared.args || []), ...(resumeId ? config.resumeArgs(resumeId) : []), ...(promptArgs || [])]

  // Claude marks child processes with CLAUDE_CODE_CHILD_SESSION / CLAUDECODE and
  // — when it sees them (own env OR `tmux show-environment -g`) — silently stops
  // writing transcripts to disk, which kills AgentDeck's whole read-the-jsonl
  // model. A stale CLAUDE_CONFIG_DIR redirects them to another root entirely.
  // Scrub every such marker so a terminal spawned from a claude-launched dev
  // server (or a polluted tmux server) still behaves like a first-class session.
  const env = { ...process.env }
  for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PID', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) {
    delete env[k]
  }
  if (config.envKey) env[config.envKey] = configDir
  Object.assign(env, prepared.env || {})

  // Inside tmux when available (persistent, attachable); otherwise run the CLI
  // directly (ttyd's child). Creation and exact attachment are separate;
  // `-e` pins the tracked home's login env for first creation.
  const tmux = findTmux()
  const tmuxName = tmux ? attach?.tmuxName || tmuxSessionName(key) : null
  if (attach && !tmux) throw err(410, 'This terminal is no longer running.')
  let command
  if (tmux) {
    // claude consults the tmux SERVER's global env (`show-environment -g`) for
    // the child-session marker — pane env can't override that, so scrub the
    // global itself. A leftover global marker is always pollution (a real child
    // session carries it in its own process env), so unsetting is safe.
    try {
      execFileSync(tmux, ['set-environment', '-gu', 'CLAUDE_CODE_CHILD_SESSION'], { stdio: 'ignore', timeout: 2000 })
    } catch {
      // no tmux server yet (first session), or var already absent — both fine
    }
    // stash enough metadata on the tmux session itself (base64 JSON in a session
    // env var) that listLiveTmux can rebuild the Live-now entry — including after
    // a server restart, when the in-memory `sessions` map is gone.
    const metaB64 = Buffer.from(
      JSON.stringify({
        ...meta,
        key,
        provider: config.id || config.title, // the registry id — clients key their live sets on it
        root: meta?.root ?? null,
        slug: meta?.slug ?? null,
        id: meta?.id ?? null,
        title: meta?.title ?? null,
        cwd: cwd ?? null,
        isNew: meta?.isNew ?? false,
      })
    ).toString('base64')
    if (!attach) {
      const ns = ['new-session', '-d', '-s', tmuxName, '-e', `AGENTDECK_META=${metaB64}`]
      if (config.envKey) ns.push('-e', `${config.envKey}=${configDir}`)
      for (const [k, v] of Object.entries(prepared.env || {})) ns.push('-e', `${k}=${v}`)
      if (cwd && fs.existsSync(cwd)) ns.push('-c', cwd)
      ns.push('--', bin, ...cliArgs)
      try { execFileSync(tmux, ns, { env, stdio: 'pipe', timeout: 5000 }) }
      catch (e) { throw err(502, `Could not create terminal: ${String(e.stderr || e.message).trim()}`) }
    } else {
      try { execFileSync(tmux, ['has-session', '-t', `=${tmuxName}`], { stdio: 'ignore', timeout: 2000 }) }
      catch { throw err(410, 'This terminal has ended. Open a new conversation or resume its saved session.') }
    }
    command = [tmux, 'attach-session', '-t', `=${tmuxName}`]
  } else {
    command = [bin, ...cliArgs]
  }

  // Front-end serving the terminal page: ttyd where it works, webterm on win32.
  // ttyd [opts] <command> [args]; -W writable, -i localhost-only, optional -O origin
  // check. NB: -O is --check-origin; the lowercase -o is --once (accept one client,
  // exit on disconnect) — using it broke "pop out", which disconnects the iframe to
  // reconnect in a new tab, killing ttyd before the tab could attach.
  const front = IS_WIN
    ? [process.execPath, WEBTERM, '-p', String(port), ...(config.checkOrigin ? ['-O'] : []), '-t', config.title, '--', ...command]
    : [ttyd, '-p', String(port), '-i', '127.0.0.1', '-W', ...(config.checkOrigin ? ['-O'] : []), '-t', `titleFixed=${config.title}`, ...command]
  const proc = spawn(front[0], front.slice(1), {
    cwd: fs.existsSync(cwd) ? cwd : undefined,
    env, // scrubbed above, with the tracked home's config dir pinned
    stdio: 'ignore',
  })
  const entry = { proc, port, url: `http://localhost:${port}`, meta: meta || {}, tmuxName }
  sessions.set(key, entry)
  proc.on('exit', () => {
    if (sessions.get(key) === entry) sessions.delete(key)
  })
  proc.on('error', () => {
    if (sessions.get(key) === entry) sessions.delete(key)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const onEarlyExit = () => {
      if (settled) return
      settled = true
      sessions.delete(key)
      reject(err(502, 'terminal failed to start (ttyd/CLI exited immediately — check they are installed and the port is free).'))
    }
    proc.once('exit', onEarlyExit)
    proc.once('error', onEarlyExit)
    setTimeout(() => {
      if (settled) return
      settled = true
      proc.removeListener('exit', onEarlyExit)
      proc.removeListener('error', onEarlyExit)
      resolve({ key, ...meta, url: entry.url, port, reused: !!attach })
    }, IS_WIN ? 700 : 350) // webterm is a node process — imports land before a bad bind fails
  })
}

export function listTerminals() {
  return [...sessions.entries()].map(([key, e]) => ({ key, port: e.port, url: e.url, alive: e.proc?.exitCode == null && !e.proc?.killed, tmux: !!e.tmuxName, tmuxName: e.tmuxName || null, ...e.meta }))
}

export async function reattachTerminal({ body, root, config }) {
  if (body.bindSessionId && !body.terminalKey) throw err(400, 'Select a running terminal to link.')
  const live = listLiveTmux()
  const entries = [...live, ...listTerminals()]
  const hit = findTerminal(entries, config.id, root.id, body)
  if (!hit) {
    if (body.terminalKey) throw err(410, 'This terminal has ended. Open a new conversation or resume its saved session.')
    return null
  }
  if (body.bindSessionId) {
    if (!config.resolveSavedSession) throw err(400, 'This provider does not support linking saved conversations.')
    const saved = config.resolveSavedSession({ root, id: body.bindSessionId, slug: body.slug })
    if (!saved?.id) throw err(404, 'The selected conversation is not available in this data folder.')
    if (entries.some((e) => e.provider === config.id && e.root === root.id && e.id === saved.id && e.key !== hit.key)) throw err(409, 'That conversation already has a different running terminal.')
    const bound = metadataOf({ ...hit, ...saved, isNew: false })
    if (hit.tmuxName) {
      execFileSync(findTmux(), ['set-environment', '-t', `=${hit.tmuxName}`, 'AGENTDECK_META', Buffer.from(JSON.stringify(bound)).toString('base64')], { stdio: 'ignore', timeout: 2000 })
    }
    const entry = sessions.get(hit.key)
    if (entry) entry.meta = { ...entry.meta, ...bound }
    return { ...bound, key: hit.key, reused: true }
  }
  return startTerminal({ key: hit.key, cwd: hit.cwd, configDir: hit.configDir || root.dir, meta: hit, config, attach: hit })
}

// All live AgentDeck tmux sessions on the box — including ones with no ttyd
// currently attached (e.g. after closing the browser or restarting the server).
// Metadata is read back from each session's AGENTDECK_META env var. `attached`
// reflects whether something (a ttyd or a real terminal) is viewing it now.
const LEGACY_PROVIDER = { agy: 'antigravity' }
const discovered = new Map()
const discoveryVersions = new Map()
const discoveryScope = (meta) => `${meta.provider}|${meta.root}`

// Watcher events invalidate evidence, but never constitute ownership evidence.
// Keep provider/root isolation and a short burst throttle for expensive probes.
export function noteTerminalChanges(changes) {
  for (const scope of new Set(changes.filter((c) => c.provider && c.root).map(discoveryScope))) {
    discoveryVersions.set(scope, (discoveryVersions.get(scope) || 0) + 1)
  }
}

export function listLiveTmux() {
  const tmux = findTmux()
  if (!tmux) return []
  let rows
  try {
    // stderr dropped: with no tmux server running, tmux prints "no server running on …" on every poll
    rows = execFileSync(tmux, ['list-sessions', '-F', '#{session_name}\t#{session_attached}'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean)
  } catch {
    return [] // tmux server not running / no sessions
  }
  const out = []
  for (const row of rows) {
    const [name, attached] = row.split('\t')
    if (!name || !name.startsWith('agentdeck-')) continue
    let meta = {}
    try {
      // tmux prints just the named variable; psmux (the Windows tmux stand-in)
      // prints the whole environment — pick the right line either way.
      const env = execFileSync(tmux, ['show-environment', '-t', name, 'AGENTDECK_META'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })
      const line = env
        .split('\n')
        .map((s) => s.trim())
        .find((s) => s.startsWith('AGENTDECK_META='))
      if (line) meta = JSON.parse(Buffer.from(line.slice('AGENTDECK_META='.length), 'base64').toString('utf8'))
    } catch {}
    // sessions started before the id was stored carry the CLI title instead
    if (LEGACY_PROVIDER[meta.provider]) meta.provider = LEGACY_PROVIDER[meta.provider]
    const provider = providers.get(meta.provider)
    const last = discovered.get(name)
    const version = discoveryVersions.get(discoveryScope(meta)) || 0
    const dirty = last && last.version !== version
    if (provider?.resolveSession && (!last || Date.now() - last.at >= (dirty ? 500 : 4000))) {
      try {
        const observed = provider.resolveSession({ meta, files: () => processFiles(tmux, name) })
        if (observed?.id && (observed.id !== meta.id || observed.slug !== meta.slug || observed.title !== meta.title)) {
          meta = { ...meta, ...observed, isNew: false }
          execFileSync(tmux, ['set-environment', '-t', `=${name}`, 'AGENTDECK_META', Buffer.from(JSON.stringify(meta)).toString('base64')], { stdio: 'ignore', timeout: 2000 })
          const pool = sessions.get(meta.key)
          if (pool) pool.meta = { ...pool.meta, ...meta }
        }
      } catch { /* Unavailable evidence does not make a live terminal disappear. */ }
      discovered.set(name, { at: Date.now(), version })
    }
    out.push({ ...meta, tmuxName: name, attached: attached !== '0' })
  }
  return out
}

// End = really end it: kill the ttyd front-end AND the persistent tmux session
// (whether or not a ttyd is currently attached to it).
export function stopTerminal(key, provider = null) {
  if (typeof key !== 'string' || !key) throw err(400, 'missing terminal key')
  if (provider) {
    const entry = [...listTerminals(), ...listLiveTmux()].find((e) => e.key === key)
    if (entry && entry.provider !== provider) throw err(403, 'This terminal belongs to a different provider.')
  }
  const e = sessions.get(key)
  if (e) {
    try {
      e.proc.kill()
    } catch {}
    sessions.delete(key)
  }
  killTmuxSession(tmuxSessionName(key))
  discovered.delete(tmuxSessionName(key))
  return { stopped: !!e }
}

// Server shutdown: kill the ttyd front-ends only. Any tmux sessions stay alive
// (detached) on purpose, so a restart — or `tmux attach` from a real terminal —
// can pick them back up. Use stopTerminal (End) to actually end one.
export function stopAllTerminals() {
  for (const e of sessions.values()) {
    try {
      e.proc.kill()
    } catch {}
  }
  sessions.clear()
}
