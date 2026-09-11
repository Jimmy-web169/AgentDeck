interface CdpSocket {
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'message', listener: (data: unknown) => void): unknown
  send(data: string, callback: (error?: Error | null) => void): void
  close(): void
}
import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import type { FixtureManifest, FixtureProject, FixtureSession } from './make-fixture.ts'
import type { Target } from '../../shared/types.d.ts'
import type { Preferences } from '../../src/lib/prefs.ts'
import type { Pin } from '../../src/lib/pins.ts'
import type { Workspace } from '../../src/lib/workspaces.ts'
import type { Tab } from '../../src/lib/tabs.ts'
export type Fixture = ReturnType<typeof loadFixture>
export interface Seeds {
  agentdeck_theme: string
  agentdeck_prefs: Partial<Preferences> & { showFirstPrompt?: boolean }
  agentdeck_sidebar_sections: { workspaces: boolean; pinned: boolean; projects: boolean }
  agentdeck_pins?: Pin[]
  agentdeck_workspaces?: Workspace[]
  agentdeck_recent?: (Target & { at: number })[]
  agentdeck_tabs?: { tabs: Tab[]; activeKey: string }
}
interface CdpReplies {
  'Page.captureScreenshot': { data: string }
  'Page.addScriptToEvaluateOnNewDocument': { identifier: string }
  'Runtime.evaluate': { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
}
interface CdpEvents {
  'Network.requestWillBeSent': { requestId: string; request: { url: string } }
  'Network.loadingFinished': { requestId: string }
  'Network.loadingFailed': { requestId: string; errorText?: string; canceled?: boolean }
  'Network.responseReceived': { requestId: string; response: { url: string; status: number } }
  'Log.entryAdded': { entry: { level: string; text: string; source: string; url?: string } }
  'Runtime.exceptionThrown': { exceptionDetails: { text: string; exception?: { description?: string } } }
  'Page.screencastFrame': { data: string; sessionId: number; metadata: { timestamp: number } }
}
// Shared plumbing for the demo scripts (shoot.mjs, record.mjs): find a browser,
// drive it over the DevTools protocol with the `ws` package (no puppeteer), and
// turn the fixture manifest into the localStorage the app expects.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const sleep = (ms: number | undefined) => new Promise((r) => setTimeout(r, ms))

export async function withBrowserCleanup<T>(close: () => Promise<unknown>, run: () => T | Promise<T>, log: Pick<Console, 'error'> = console) {
  let failed = false
  let primaryError: unknown
  let result!: T
  try {
    result = await run()
  } catch (error) {
    failed = true
    primaryError = error
  }
  try {
    await close()
  } catch (error) {
    if (!failed) throw error
    process.exitCode = 1
    try {
      log.error(`[browser cleanup] ${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // A secondary reporting error must not replace the original failure.
    }
  }
  if (failed) throw primaryError
  return result
}

// Wait for our spawned process before touching its private profile. A fixed
// sleep races Chromium's final writes, especially after a large contact sheet.
export async function closeOwnedBrowser(
  chrome: Pick<ChildProcess, 'exitCode' | 'signalCode' | 'kill'> & {
    once(event: 'exit', callback: () => void): unknown
    once(event: 'error', callback: (error: Error) => void): unknown
    removeListener(event: 'exit', callback: () => void): unknown
    removeListener(event: 'error', callback: (error: Error) => void): unknown
  },
  profile: fs.PathLike,
  { keepProfile = false, graceMs = 3000, remove = fs.promises.rm } = {}
) {
  if (chrome.exitCode == null && chrome.signalCode == null) {
    await new Promise<void>((resolve, reject) => {
      let timer: string | number | NodeJS.Timeout | undefined
      const finish = (error?: Error) => {
        clearTimeout(timer)
        chrome.removeListener('exit', exited)
        chrome.removeListener('error', failed)
        if (error) reject(error)
        else resolve()
      }
      const exited = () => finish()
      const failed = (error: Error) => finish(error)
      chrome.once('exit', exited)
      chrome.once('error', failed)
      timer = setTimeout(() => {
        timer = setTimeout(() => finish(new Error('Owned browser did not exit; its profile was retained')), graceMs)
        chrome.kill('SIGKILL')
      }, graceMs)
      chrome.kill('SIGTERM')
    })
  }
  if (!keepProfile) await remove(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
}

export function parseArgs(argv: string[], flags: string[] = []) {
  const o: Record<string, string | true | undefined> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (flags.includes(a) || a === '--help' || a === '-h') o[a.slice(2)] = true
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}

export function fail(msg: string): never {
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

// theme name on the command line / in file names → the app's theme key (src/lib/prefs.ts THEMES)
export const THEME_KEYS: Record<string, string> = { dark: 'midnight', midnight: 'midnight', graphite: 'graphite', light: 'light', paper: 'light' }

// ---- browser ------------------------------------------------------------------

export function findBrowser(explicit?: string) {
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
  new Promise<number>((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
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
export async function launchBrowser({
  browser,
  width,
  height,
  keepProfile = false,
}: {
  browser: string
  width: number
  height: number
  keepProfile?: boolean
}) {
  const port = await freePort()
  const staging = path.join(REPO, 'tmp')
  fs.mkdirSync(staging, { recursive: true })
  const profile = fs.mkdtempSync(path.join(staging, 'agentdeck-demo-'))
  const chrome = spawn(
    browser,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--lang=en-US',
      '--disable-back-forward-cache',
      '--disable-features=BackForwardCache',
      `--window-size=${width},${height}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
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
    await closeOwnedBrowser(chrome, profile, { keepProfile })
    fail('the browser did not start (remote debugging port never answered)')
  }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  const cdp = new Cdp(ws)
  let closing: Promise<void>
  const close = () => {
    if (!closing) {
      try {
        ws.close()
      } catch {}
      closing = closeOwnedBrowser(chrome, profile, { keepProfile })
    }
    return closing
  }
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {})
  } catch (error) {
    return withBrowserCleanup(close, () => {
      throw error
    })
  }
  return { cdp, close, version: version.Browser, port }
}

// ---- CDP client ---------------------------------------------------------------

export class Cdp {
  ws: CdpSocket
  timeoutMs: number
  closedError: Error | null
  id: number
  pending: Map<number, { method: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }>
  listeners: Map<string, Set<(params: unknown) => void>>

  constructor(ws: CdpSocket, { timeoutMs = 30000 } = {}) {
    this.ws = ws
    this.timeoutMs = timeoutMs
    this.closedError = null
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    const disconnect = (error: Error) => {
      this.closedError ||= error
      for (const pending of this.pending.values()) pending.reject(new Error(`CDP ${pending.method}: ${this.closedError.message}`, { cause: this.closedError }))
    }
    ws.on('close', () => disconnect(new Error('CDP connection closed')))
    ws.on('error', (error) => disconnect(error))
    ws.on('message', (m) => {
      const msg = JSON.parse(String(m))
      const pending = msg.id ? this.pending.get(msg.id) : undefined
      if (pending) {
        const { resolve, reject } = pending
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result)
      } else if (msg.method && this.listeners.has(msg.method)) {
        for (const fn of this.listeners.get(msg.method) || []) {
          try {
            fn(msg.params)
          } catch (e) {
            console.warn(`  ! ${msg.method} handler: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
    })
  }
  send<K extends keyof CdpReplies>(method: K, params?: Record<string, unknown>): Promise<CdpReplies[K]>
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError)
    return new Promise((resolve, reject) => {
      const id = ++this.id
      const settle = (callback: (value: unknown) => void, value: unknown) => {
        clearTimeout(timer)
        this.pending.delete(id)
        callback(value)
      }
      const fail = (error: unknown) => settle(reject, error)
      const timer = setTimeout(() => fail(new Error(`CDP ${method} timed out after ${this.timeoutMs}ms`)), this.timeoutMs)
      this.pending.set(id, { method, resolve: (value: unknown) => settle(resolve, value), reject: fail })
      try {
        this.ws.send(JSON.stringify({ id, method, params }), (error) => {
          if (error) fail(error)
        })
      } catch (error) {
        fail(error)
      }
    })
  }
  on<K extends keyof CdpEvents>(method: K, fn: (params: CdpEvents[K]) => void): () => boolean
  on(method: string, fn: (params: unknown) => void) {
    const listeners = this.listeners.get(method) || new Set<(params: unknown) => void>()
    this.listeners.set(method, listeners)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  async eval<T = unknown>(expression: string, { awaitPromise = true } = {}): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value as T
  }
  // poll a page-side predicate (JS expression) until it is truthy
  async waitFor(expression: string, { timeout = 10000, every = 150 } = {}) {
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

export async function assertFixtureServer(base: string, fx: Fixture, reject: (message: string) => never = fail) {
  let rootsSeen: { roots?: { dir: string }[] }
  try {
    rootsSeen = await (await fetch(`${base}/api/claude/roots`)).json()
  } catch (e) {
    return reject(`${base} is not answering (${e instanceof Error ? e.message : String(e)}) — start the server first (see the header of this file)`)
  }
  const served = (rootsSeen.roots || []).map((r: { dir: string }) => path.resolve(r.dir))
  const expected = path.resolve(fx.manifest.claudeHome)
  if (!served.length || served.some((d: string) => d !== expected))
    return reject(`${base} serves ${served.join(', ') || 'nothing'} — not the fixture at ${expected}. Start it with AGENTDECK_CONFIG_DIR=<fixture dir>`)
}

// ---- fixture → localStorage seeds -----------------------------------------------
// Shapes come from src/lib/prefs.ts, tabs.js, pins.js, workspaces.js — keep in sync.

export function loadFixture(fixtureDir: string) {
  const mf = path.join(fixtureDir, 'manifest.json')
  if (!fs.existsSync(mf)) fail(`no manifest at ${mf} — run scripts/demo/make-fixture.ts first (or pass --fixture)`)
  const manifest: FixtureManifest = JSON.parse(fs.readFileSync(mf, 'utf8'))
  const rootsOf = (id: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(fixtureDir, `roots.${id}.json`), 'utf8'))[0]
    } catch {
      return null
    }
  }
  const roots: Record<string, { id: string; label?: string; dir: string } | null> = {
    claude: rootsOf('claude'),
    codex: rootsOf('codex'),
    antigravity: rootsOf('antigravity'),
  }
  const target = (s: FixtureSession | null) => {
    if (!s) throw new Error('Scene requires a fixture session')
    return {
      provider: s.provider,
      root: manifest.rootIds[s.provider],
      rootLabel: roots[s.provider]?.label || `~/.${s.provider}`,
      slug: s.slug,
      id: s.id,
      title: s.title || null,
      project: s.project,
      cwd: s.cwd,
    }
  }
  const byMinutes = (a: { minutes: number }, b: { minutes: number }) => b.minutes - a.minutes
  const claude = manifest.sessions.filter((s: { provider: string }) => s.provider === 'claude')
  const codex = manifest.sessions.filter((s: { provider: string }) => s.provider === 'codex')
  const claudeStar = claude.find((s) => s.subagents.length) || [...claude].sort(byMinutes)[0] || null
  const codexStar = codex.find((s) => s.subagents.length) || [...codex].sort(byMinutes)[0] || null
  const agy = manifest.sessions.filter((s: { provider: string }) => s.provider === 'antigravity')
  const agyStar = [...agy].sort((a, b) => b.toolCalls - a.toolCalls || byMinutes(a, b))[0] || null
  const longest = [...manifest.sessions].sort(byMinutes)[0] || null
  const shared = manifest.projects.find((p) => p.providers.length > 1) || manifest.projects[0] || null
  const otherProject =
    manifest.projects.find((p: { providers: string | string[] }) => p !== shared && p.providers.includes('codex')) ||
    manifest.projects.find((p) => p !== shared) ||
    null
  const projectTarget = (p: FixtureProject, provider: string) => ({
    kind: 'project',
    provider,
    root: manifest.rootIds[provider],
    rootLabel: roots[provider]?.label || `~/.${provider}`,
    slug: provider === 'claude' ? p.claudeSlug : p.cwd,
    cwd: p.cwd,
    project: p.name,
    id: null,
    title: null,
  })
  const recent = [...manifest.sessions].sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime()).slice(0, 6)
  return { manifest, roots, target, claudeStar, codexStar, agyStar, longest, shared, otherProject, projectTarget, recent }
}

export function seedsFor(fx: Fixture, themeKey: string, level: string) {
  const now = Date.now()
  const seeds: Seeds = {
    agentdeck_theme: themeKey,
    agentdeck_prefs: {
      theme: themeKey,
      density: 'comfortable',
      showWorkspaces: true,
      showPinned: true,
      showSuggestions: true,
      showFirstPrompt: true,
      inlineSubagents: true,
      customAccents: ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#818cf8', '#e879f9'],
    },
    agentdeck_sidebar_sections: { workspaces: true, pinned: true, projects: true },
  }
  if (level === 'base') return seeds
  const { target, longest, claudeStar, codexStar, agyStar, shared, otherProject, projectTarget, recent } = fx
  // pins: one session (the long pairing session) + one whole project
  const pins: Pin[] = []
  if (longest) pins.push({ ...target(longest), at: now - 3600e3 })
  if (otherProject) {
    const prov = otherProject.providers.includes('codex') ? 'codex' : otherProject.providers[0]
    const pt = projectTarget(otherProject, prov)
    pins.push({
      provider: pt.provider,
      root: pt.root,
      rootLabel: pt.rootLabel,
      slug: pt.slug,
      id: null,
      title: null,
      project: pt.project,
      cwd: pt.cwd,
      at: now - 7200e3,
    })
  }
  seeds.agentdeck_pins = pins
  // one workspace: the project that lives in both providers, grouped and coloured
  if (shared)
    seeds.agentdeck_workspaces = [
      {
        id: 'demo-ws-1',
        name: shared.name,
        at: now - 86400e3,
        color: '#a78bfa',
        icon: 'rocket',
        items: shared.providers.map((prov) => projectTarget(shared, prov)),
      },
    ]
  // MRU for the quick switcher
  seeds.agentdeck_recent = recent.map((s, i) => ({ ...target(s), at: now - (i + 1) * 900e3 }))
  // a lived-in tab strip: Home + the two showcase sessions (the hash decides which is active)
  const tabs: Tab[] = [{ key: 'demo-home', target: { provider: null, view: 'activity', focus: null } }]
  if (claudeStar) tabs.push({ key: 'demo-claude', target: { ...target(claudeStar), view: 'conversation' } })
  if (codexStar) tabs.push({ key: 'demo-codex', target: { ...target(codexStar), view: 'conversation' } })
  if (agyStar) tabs.push({ key: 'demo-agy', target: { ...target(agyStar), view: 'conversation' } })
  seeds.agentdeck_tabs = { tabs, activeKey: 'demo-home' }
  return seeds
}

// wrapped in try/catch: the script also runs on the about:blank we park on
// between navigations, where localStorage access throws a SecurityError
export const seedScript = (seeds: object) =>
  'try {\n' +
  Object.entries(seeds)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`)
    .join('\n') +
  '\n} catch {}'

export const sessionHash = (t: Target) => `#/${[t.provider, t.root, t.slug, t.id].map((part) => encodeURIComponent(part || '')).join('/')}`

// ffmpeg on PATH?
export const hasFfmpeg = () => spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0

export function argText(value: string | true | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
