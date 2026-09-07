// Shared plumbing for the demo scripts (shoot.mjs, record.mjs): find a browser,
// drive it over the DevTools protocol with the `ws` package (no puppeteer), and
// turn the fixture manifest into the localStorage the app expects.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function parseArgs(argv, flags = []) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (flags.includes(a) || a === '--help' || a === '-h') o[a.slice(2)] = true
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}

export function fail(msg) {
  console.error(`demo: ${msg}`)
  process.exit(1)
}

// Each release keeps its own folder — demo/v1.0/, demo/v2.0/ … — so README can
// show what a version looked like and old material is never overwritten. The
// default release comes from package.json ("2.1.0" → v2.1); --release overrides.
export function currentRelease() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version || '0.0.0'
    const [major, minor] = v.split('.')
    return `v${major}.${minor}`
  } catch {
    return 'v0.0'
  }
}

// theme name on the command line / in file names → the app's theme key (src/lib/prefs.js THEMES)
export const THEME_KEYS = { dark: 'midnight', midnight: 'midnight', graphite: 'graphite', light: 'light', paper: 'light' }

// ---- browser ------------------------------------------------------------------

export function findBrowser(explicit) {
  if (explicit) return explicit
  const env = [process.env.CHROME_PATH, process.env.AGENTDECK_BROWSER].filter(Boolean)
  const win = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  const mac = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
  const linux = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
  const cands = [...env, ...(process.platform === 'win32' ? win : process.platform === 'darwin' ? mac : [])]
  for (const c of cands) if (c && fs.existsSync(c)) return c
  if (process.platform !== 'win32') {
    for (const c of linux) {
      const r = spawnSync('which', [c], { encoding: 'utf8' })
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
    }
  }
  return null
}

export const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
    s.on('error', reject)
  })

// Launch headless Chrome/Edge with a throw-away profile and hand back a CDP
// client on a fresh tab plus a `close()` that kills the browser and removes the
// profile. The back-forward cache is off on purpose: with it on, every page we
// navigate away from stays alive for a while with its /events SSE socket open,
// and after five or six navigations Chrome's six-connections-per-host budget is
// spent — every /api request then queues forever.
export async function launchBrowser({ browser, width, height, keepProfile = false } = {}) {
  const port = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-demo-'))
  const chrome = spawn(
    browser,
    [`--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--lang=en-US', '--disable-back-forward-cache', '--disable-features=BackForwardCache', `--window-size=${width},${height}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: 'ignore' }
  )
  let version = null
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    } catch {
      await sleep(250)
    }
  }
  if (!version) {
    chrome.kill()
    fail('the browser did not start (remote debugging port never answered)')
  }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {})
  const close = async () => {
    try {
      ws.close()
    } catch {}
    chrome.kill()
    await sleep(300)
    if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true })
  }
  return { cdp, close, version: version.Browser, port }
}

// ---- CDP client ---------------------------------------------------------------

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.on('message', (m) => {
      const msg = JSON.parse(m)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result)
      } else if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method)) {
          try {
            fn(msg.params)
          } catch (e) {
            console.warn(`  ! ${msg.method} handler: ${e.message}`)
          }
        }
      }
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(fn)
    return () => this.listeners.get(method).delete(fn)
  }
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }
  // poll a page-side predicate (JS expression) until it is truthy
  async waitFor(expression, { timeout = 10000, every = 150 } = {}) {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      try {
        if (await this.eval(expression)) return true
      } catch {}
      await sleep(every)
    }
    return false
  }
}

// ---- the running server must be serving the fixture, never a real home --------

export async function assertFixtureServer(base, fx) {
  let rootsSeen
  try {
    rootsSeen = await (await fetch(`${base}/api/claude/roots`)).json()
  } catch (e) {
    fail(`${base} is not answering (${e.message}) — start the server first (see the header of this file)`)
  }
  const served = (rootsSeen.roots || []).map((r) => path.resolve(r.dir))
  const expected = path.resolve(fx.manifest.claudeHome)
  if (!served.length || served.some((d) => d !== expected)) fail(`${base} serves ${served.join(', ') || 'nothing'} — not the fixture at ${expected}. Start it with AGENTDECK_CONFIG_DIR=<fixture dir>`)
}

// ---- fixture → localStorage seeds -----------------------------------------------
// Shapes come from src/lib/prefs.js, tabs.js, pins.js, workspaces.js — keep in sync.

export function loadFixture(fixtureDir) {
  const mf = path.join(fixtureDir, 'manifest.json')
  if (!fs.existsSync(mf)) fail(`no manifest at ${mf} — run scripts/demo/make-fixture.mjs first (or pass --fixture)`)
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'))
  const rootsOf = (id) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(fixtureDir, `roots.${id}.json`), 'utf8'))[0]
    } catch {
      return null
    }
  }
  const roots = { claude: rootsOf('claude'), codex: rootsOf('codex') }
  const target = (s) => ({ provider: s.provider, root: manifest.rootIds[s.provider], rootLabel: roots[s.provider]?.label || `~/.${s.provider}`, slug: s.slug, id: s.id, title: s.title || null, project: s.project, cwd: s.cwd })
  const byMinutes = (a, b) => b.minutes - a.minutes
  const claude = manifest.sessions.filter((s) => s.provider === 'claude')
  const codex = manifest.sessions.filter((s) => s.provider === 'codex')
  const claudeStar = claude.find((s) => s.subagents.length) || [...claude].sort(byMinutes)[0] || null
  const codexStar = codex.find((s) => s.subagents.length) || [...codex].sort(byMinutes)[0] || null
  const longest = [...manifest.sessions].sort(byMinutes)[0] || null
  const shared = manifest.projects.find((p) => p.providers.length > 1) || manifest.projects[0] || null
  const otherProject = manifest.projects.find((p) => p !== shared && p.providers.includes('codex')) || manifest.projects.find((p) => p !== shared) || null
  const projectTarget = (p, provider) => ({ kind: 'project', provider, root: manifest.rootIds[provider], rootLabel: roots[provider]?.label || `~/.${provider}`, slug: provider === 'claude' ? p.claudeSlug : p.cwd, cwd: p.cwd, project: p.name, id: null, title: null })
  const recent = [...manifest.sessions].sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 6)
  return { manifest, roots, target, claudeStar, codexStar, longest, shared, otherProject, projectTarget, recent }
}

export function seedsFor(fx, themeKey, level) {
  const now = Date.now()
  const seeds = {
    agentdeck_theme: themeKey,
    agentdeck_prefs: { theme: themeKey, density: 'comfortable', showWorkspaces: true, showPinned: true, showSuggestions: true, showFirstPrompt: true, inlineSubagents: true, customAccents: ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#818cf8', '#e879f9'] },
    agentdeck_sidebar_sections: { workspaces: true, pinned: true, projects: true },
  }
  if (level === 'base') return seeds
  const { target, longest, claudeStar, codexStar, shared, otherProject, projectTarget, recent } = fx
  // pins: one session (the long pairing session) + one whole project
  const pins = []
  if (longest) pins.push({ ...target(longest), at: now - 3600e3 })
  if (otherProject) {
    const prov = otherProject.providers.includes('codex') ? 'codex' : otherProject.providers[0]
    const pt = projectTarget(otherProject, prov)
    pins.push({ provider: pt.provider, root: pt.root, rootLabel: pt.rootLabel, slug: pt.slug, id: null, title: null, project: pt.project, cwd: pt.cwd, at: now - 7200e3 })
  }
  seeds.agentdeck_pins = pins
  // one workspace: the project that lives in both providers, grouped and coloured
  if (shared) seeds.agentdeck_workspaces = [{ id: 'demo-ws-1', name: shared.name, at: now - 86400e3, color: '#a78bfa', items: shared.providers.map((prov) => projectTarget(shared, prov)) }]
  // MRU for the quick switcher
  seeds.agentdeck_recent = recent.map((s, i) => ({ ...target(s), at: now - (i + 1) * 900e3 }))
  // a lived-in tab strip: Home + the two showcase sessions (the hash decides which is active)
  const tabs = [{ key: 'demo-home', target: { provider: null, view: 'activity', focus: null } }]
  if (claudeStar) tabs.push({ key: 'demo-claude', target: { ...target(claudeStar), view: 'conversation' } })
  if (codexStar) tabs.push({ key: 'demo-codex', target: { ...target(codexStar), view: 'conversation' } })
  seeds.agentdeck_tabs = { tabs, activeKey: 'demo-home' }
  return seeds
}

// wrapped in try/catch: the script also runs on the about:blank we park on
// between navigations, where localStorage access throws a SecurityError
export const seedScript = (seeds) =>
  'try {\n' +
  Object.entries(seeds)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`)
    .join('\n') +
  '\n} catch {}'

export const sessionHash = (t) => `#/${[t.provider, t.root, t.slug, t.id].map(encodeURIComponent).join('/')}`

// ffmpeg on PATH?
export const hasFfmpeg = () => spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
