import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Shared embedded-terminal pool. Runs a provider's real CLI TUI inside a ttyd
// process and serves it to the browser. One pool across providers (keys embed
// the tracked-root id, which is unique per home dir). Provider behavior is
// supplied via `config`:
//   { findBin(), title, envKey, resumeArgs(id) -> string[], checkOrigin: bool }
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
let nextPort = PORT_BASE

export function findOnPath(names, extra = []) {
  const cands = []
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const n of names) if (d) cands.push(path.join(d, n))
  cands.push(...extra)
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

let ttydBin
const findTtyd = () => (ttydBin !== undefined ? ttydBin : (ttydBin = findOnPath(['ttyd'], ['/opt/homebrew/bin/ttyd', '/usr/local/bin/ttyd'])))

let tmuxBin
const findTmux = () => (tmuxBin !== undefined ? tmuxBin : (tmuxBin = findOnPath(['tmux'], ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'])))

// A stable, collision-free tmux session name derived from the terminal key, so
// reopening the same monitored session always re-attaches the same tmux session.
function tmuxSessionName(key) {
  return `agentdeck-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}`
}

function killTmuxSession(name) {
  const tmux = findTmux()
  if (!tmux) return
  try {
    spawn(tmux, ['kill-session', '-t', name], { stdio: 'ignore' })
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
export function startTerminal({ key, cwd, configDir, resumeId, meta, config }) {
  const existing = sessions.get(key)
  if (existing && existing.proc && existing.proc.exitCode == null && !existing.proc.killed) {
    if (meta) existing.meta = { ...existing.meta, ...meta }
    return { url: existing.url, port: existing.port, reused: true }
  }
  if (sessions.size >= MAX) throw err(429, `Too many embedded terminals open (max ${MAX}). Close one first.`)
  const ttyd = findTtyd()
  if (!ttyd) throw err(404, 'ttyd not found — install it (e.g. `brew install ttyd`) to use terminal mode.')
  const bin = config.findBin()
  if (!bin) throw err(404, `${config.title} executable not found`)
  const port = pickPort()
  if (port == null) throw err(503, 'no free port for a terminal')

  // ttyd [opts] <command> [args]; -W writable, -i localhost-only, optional -O origin check.
  // NB: -O is --check-origin; the lowercase -o is --once (accept one client, exit on
  // disconnect) — using it broke "pop out", which disconnects the iframe to reconnect
  // in a new tab, killing ttyd before the tab could attach.
  const ttydOpts = ['-p', String(port), '-i', '127.0.0.1', '-W', ...(config.checkOrigin ? ['-O'] : []), '-t', `titleFixed=${config.title}`]
  const cliArgs = resumeId ? config.resumeArgs(resumeId) : []

  // Inside tmux when available (persistent, attachable); otherwise run the CLI
  // directly (ttyd's child). `tmux new-session -A` attaches an existing session
  // or creates one; `-e` pins the tracked home's login env for first creation.
  const tmux = findTmux()
  const tmuxName = tmux ? tmuxSessionName(key) : null
  let command
  if (tmux) {
    // stash enough metadata on the tmux session itself (base64 JSON in a session
    // env var) that listLiveTmux can rebuild the Live-now entry — including after
    // a server restart, when the in-memory `sessions` map is gone.
    const metaB64 = Buffer.from(
      JSON.stringify({
        key,
        provider: config.title,
        root: meta?.root ?? null,
        slug: meta?.slug ?? null,
        id: meta?.id ?? null,
        title: meta?.title ?? null,
        cwd: cwd ?? null,
        isNew: meta?.isNew ?? false,
      })
    ).toString('base64')
    const ns = ['new-session', '-A', '-s', tmuxName, '-e', `${config.envKey}=${configDir}`, '-e', `AGENTDECK_META=${metaB64}`]
    if (cwd && fs.existsSync(cwd)) ns.push('-c', cwd)
    ns.push('--', bin, ...cliArgs)
    command = [tmux, ...ns]
  } else {
    command = [bin, ...cliArgs]
  }

  const proc = spawn(ttyd, [...ttydOpts, ...command], {
    cwd: fs.existsSync(cwd) ? cwd : undefined,
    env: { ...process.env, [config.envKey]: configDir }, // pin the tracked home's login/config
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
      resolve({ url: entry.url, port, reused: false })
    }, 350)
  })
}

export function listTerminals() {
  return [...sessions.entries()].map(([key, e]) => ({ key, port: e.port, url: e.url, alive: e.proc?.exitCode == null && !e.proc?.killed, tmux: !!e.tmuxName, tmuxName: e.tmuxName || null, ...e.meta }))
}

// All live AgentDeck tmux sessions on the box — including ones with no ttyd
// currently attached (e.g. after closing the browser or restarting the server).
// Metadata is read back from each session's AGENTDECK_META env var. `attached`
// reflects whether something (a ttyd or a real terminal) is viewing it now.
export function listLiveTmux() {
  const tmux = findTmux()
  if (!tmux) return []
  let rows
  try {
    rows = execFileSync(tmux, ['list-sessions', '-F', '#{session_name}\t#{session_attached}'], { encoding: 'utf8', timeout: 3000 })
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
      const env = execFileSync(tmux, ['show-environment', '-t', name, 'AGENTDECK_META'], { encoding: 'utf8', timeout: 2000 }).trim()
      const i = env.indexOf('=')
      if (i > 0) meta = JSON.parse(Buffer.from(env.slice(i + 1), 'base64').toString('utf8'))
    } catch {}
    out.push({ tmuxName: name, attached: attached !== '0', ...meta })
  }
  return out
}

// End = really end it: kill the ttyd front-end AND the persistent tmux session
// (whether or not a ttyd is currently attached to it).
export function stopTerminal(key) {
  const e = sessions.get(key)
  if (e) {
    try {
      e.proc.kill()
    } catch {}
    sessions.delete(key)
  }
  killTmuxSession(tmuxSessionName(key))
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
