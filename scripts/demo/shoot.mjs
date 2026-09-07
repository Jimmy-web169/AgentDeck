#!/usr/bin/env node
// shoot.mjs — headless screenshots of AgentDeck for README / release notes.
//
// Drives Chrome (or Edge) over the DevTools protocol with the `ws` package —
// no puppeteer. Meant to run against a server that serves the demo fixture:
//
//   node scripts/demo/make-fixture.mjs            # tmp/demo-root
//   npx vite build
//   AGENTDECK_CONFIG_DIR=tmp/demo-root AGENTDECK_PORT=47861 AGENTDECK_WEB_PORT=47862 node server/index.js &
//   node scripts/demo/shoot.mjs --base http://localhost:47861
//
// Every shot is taken in each theme (dark = Midnight, light = Paper; add
// graphite with --themes) and written to demo/<shot>-<theme>.png. The browser
// profile is a throw-away temp dir; localStorage is seeded per shot (theme,
// prefs, pins, a workspace, recent sessions, tabs) from the fixture manifest,
// so the sidebar looks lived-in and only ever names fictional projects.
//
// Usage:
//   node scripts/demo/shoot.mjs [--base http://localhost:47861] [--out demo] [--fixture tmp/demo-root]
//        [--themes dark,light] [--shots home-activity,insights,…] [--w 1440] [--h 900] [--scale 1]
//        [--seed base|full] [--browser <path-to-chrome-or-edge>] [--no-gif] [--keep-profile] [--list]
//   --seed overrides every shot's storage seeding: base = theme/prefs only, full = + pins,
//   workspace, recent, tabs (the default is per shot, see SHOTS)

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- args ---------------------------------------------------------------------

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-gif' || a === '--keep-profile' || a === '--list' || a === '--help' || a === '-h') o[a.slice(2)] = true
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}
const A = parseArgs(process.argv.slice(2))
if (A.help) {
  console.log('usage: node scripts/demo/shoot.mjs [--base http://localhost:47861] [--out demo] [--fixture tmp/demo-root] [--themes dark,light] [--shots a,b] [--w 1440] [--h 900] [--scale 1] [--browser exe] [--no-gif] [--keep-profile] [--list]')
  process.exit(0)
}
const BASE = (A.base || 'http://localhost:47861').replace(/\/+$/, '')
const OUT = path.resolve(A.out || path.join(REPO, 'demo'))
const FIXTURE = path.resolve(A.fixture || path.join(REPO, 'tmp', 'demo-root'))
const W = Number(A.w || 1440)
const H = Number(A.h || 900)
const SCALE = Number(A.scale || 1)

// theme name in the file name → the app's theme key (src/lib/prefs.js THEMES)
const THEME_KEYS = { dark: 'midnight', light: 'light', graphite: 'graphite' }
const THEMES = (A.themes || 'dark,light').split(',').map((s) => s.trim()).filter(Boolean)
for (const t of THEMES) if (!THEME_KEYS[t]) fail(`unknown theme "${t}" — one of ${Object.keys(THEME_KEYS).join(', ')}`)

function fail(msg) {
  console.error(`shoot: ${msg}`)
  process.exit(1)
}

// ---- browser ------------------------------------------------------------------

function findBrowser() {
  if (A.browser) return A.browser
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

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
    s.on('error', reject)
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- CDP client ---------------------------------------------------------------

class Cdp {
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
        for (const fn of this.listeners.get(msg.method)) fn(msg.params)
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

// ---- fixture → localStorage seeds -----------------------------------------------
// Shapes come from src/lib/prefs.js, tabs.js, pins.js, workspaces.js — keep in sync.

function loadFixture() {
  const mf = path.join(FIXTURE, 'manifest.json')
  if (!fs.existsSync(mf)) fail(`no manifest at ${mf} — run scripts/demo/make-fixture.mjs first (or pass --fixture)`)
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'))
  const rootsOf = (id) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(FIXTURE, `roots.${id}.json`), 'utf8'))[0]
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

function seedsFor(fx, themeKey, level) {
  const now = Date.now()
  const seeds = {
    agentdeck_theme: themeKey,
    agentdeck_prefs: { theme: themeKey, density: 'comfortable', showWorkspaces: true, showPinned: true, showFirstPrompt: true, inlineSubagents: true },
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
  // one workspace: the project that lives in both providers, grouped
  if (shared) seeds.agentdeck_workspaces = [{ id: 'demo-ws-1', name: shared.name, at: now - 86400e3, items: shared.providers.map((prov) => projectTarget(shared, prov)) }]
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
// between shots, where localStorage access throws a SecurityError
const seedScript = (seeds) =>
  'try {\n' +
  Object.entries(seeds)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`)
    .join('\n') +
  '\n} catch {}'

// ---- the shot list ----------------------------------------------------------------
// hash: where to navigate (src/lib/route.js) · seed: 'base' | 'full' · h: viewport
// height · ready: page-side predicate that says the data is on screen · act: extra
// steps before capture (CDP client + fixture)

const sessionHash = (t) => `#/${[t.provider, t.root, t.slug, t.id].map(encodeURIComponent).join('/')}`
// page-side predicates (strings evaluated in the page). `booted` = the sidebar
// has listed the current folder's projects and nothing is still loading — the
// seeded workspace/pins/tabs render from localStorage before any fetch returns,
// so a marker that only they contain is NOT proof the index is in.
const T = 'document.body.innerText'
const hasText = (s) => `${T}.includes(${JSON.stringify(s)})`
const noText = (s) => `!${T}.includes(${JSON.stringify(s)})`
const booted = `/PROJECTS\\s*·\\s*[1-9]/.test(${T}) && !/Loading(…|\\.\\.\\.)/.test(${T}) && ${noText('no tracked folder')}`
const sessionOpen = (title) => `${booted} && /\\d+ prompts?/.test(${T}) && ${noText('Pick a project')} && ${hasText(title)}`
const all = (...ps) => ps.map((p) => `(${p})`).join(' && ')

const SHOTS = [
  {
    name: 'home-activity',
    hash: '#/',
    seed: 'full',
    h: H,
    ready: () => all(booted, hasText('LATEST SESSIONS'), noText('No sessions yet')),
    about: 'Home · Activity with the shared sidebar (workspace, pins, projects)',
  },
  {
    name: 'quick-switcher-open',
    hash: '#/',
    seed: 'full',
    h: H,
    ready: () => all(booted, hasText('LATEST SESSIONS'), noText('No sessions yet')),
    act: async (cdp, fx) => {
      await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); true`)
      await cdp.waitFor(`!!document.querySelector('input[placeholder*="Jump to"]')`, { timeout: 4000 })
      // type a query so fuzzy matching is visible; the switcher input has autofocus
      const focused = await cdp.eval(`document.activeElement && document.activeElement.tagName === 'INPUT'`)
      if (focused) await cdp.send('Input.insertText', { text: (fx.shared?.name || 'orbit').slice(0, 3) })
      await sleep(600)
    },
    about: 'Ctrl+K quick switcher with a query',
  },
  {
    name: 'sidebar-workspaces-pinned',
    hash: '#/',
    seed: 'full',
    h: H,
    ready: () => all(booted, hasText('LATEST SESSIONS'), noText('No sessions yet')),
    act: async (cdp, fx) => {
      // expand the workspace row (its name span sits inside the toggle button) and the pinned project
      await cdp.eval(`(() => {
        const ws = document.querySelector('span[title=${JSON.stringify(fx.shared?.name || '')}]');
        const b = ws && ws.closest('button'); if (b) b.click();
        const p = [...document.querySelectorAll('button[title="Show sessions"]')][0]; if (p) p.click();
        return true })()`)
      // the expanded rows list the pinned project's sessions — wait for one of their titles
      const pinnedTitle = fx.manifest.sessions.find((s) => s.project === fx.otherProject?.name)?.title
      if (pinnedTitle) await cdp.waitFor(hasText(pinnedTitle.slice(0, 20)), { timeout: 4000 })
      await sleep(500)
    },
    about: 'Sidebar with a cross-provider workspace and pinned rows',
  },
  {
    name: 'insights',
    hash: '#/home/insights',
    seed: 'base',
    h: Math.max(H, 1500),
    ready: () => all(booted, hasText('Your last 30 days'), hasText('ACTIVITY')),
    about: 'Insights (rhythm, streak, session shape)',
  },
  {
    name: 'session-conversation',
    hash: (fx) => (fx.claudeStar ? sessionHash(fx.target(fx.claudeStar)) : '#/'),
    seed: 'full',
    h: Math.max(H, 1300),
    ready: (fx) => sessionOpen((fx.claudeStar?.title || '').slice(0, 24)),
    act: async (cdp) => {
      // The view renders only the tail of a conversation at first; the Task call
      // that spawned the sub-agent is usually earlier. Load the whole transcript,
      // open the first inline thread ("▸ show thread") and scroll it into view.
      const findThread = `[...document.querySelectorAll('button')].find((x) => /show thread/.test(x.textContent || ''))`
      await cdp.eval(`(() => { const more = document.querySelector('button[title^="Only the latest messages"]'); if (more) more.click(); return !!more })()`)
      await cdp.waitFor(`!!(${findThread})`, { timeout: 4000 })
      await cdp.eval(`(() => { const b = ${findThread}; if (!b) return false; b.click(); return true })()`)
      await cdp.waitFor(`/hide thread/.test(${T})`, { timeout: 4000 })
      await sleep(500)
      // put the parent's Task call at the top of the pane, thread expanded below it
      await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /hide thread/.test(x.textContent || '')); const block = b && b.closest('div.my-2'); const call = block && block.previousElementSibling; (call || block || b)?.scrollIntoView({ block: 'start' }); return true })()`)
      await sleep(400)
    },
    about: 'A Claude session with tool calls and inline sub-agents',
  },
  {
    name: 'session-codex',
    hash: (fx) => (fx.codexStar ? sessionHash(fx.target(fx.codexStar)) : '#/'),
    seed: 'full',
    h: Math.max(H, 1300),
    ready: (fx) => sessionOpen((fx.codexStar?.title || '').slice(0, 24)),
    about: 'A Codex session (shell / apply_patch) with a child rollout',
  },
  {
    name: 'stats',
    hash: '#/home/stats',
    seed: 'base',
    h: Math.max(H, 1500),
    ready: (fx) => all(booted, hasText(fx.shared?.name || 'orbit'), hasText('tokens')),
    about: 'Stats (tokens, tools, models)',
  },
]

// ---- main ---------------------------------------------------------------------------

async function main() {
  if (A.list) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(28)} ${s.about}`)
    return
  }
  const only = A.shots ? A.shots.split(',').map((s) => s.trim()) : null
  const shots = only ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS
  if (only) for (const n of only) if (!SHOTS.some((s) => s.name === n)) fail(`unknown shot "${n}" — see --list`)

  const browser = findBrowser()
  if (!browser) fail('no Chrome/Edge found — pass --browser <path> or set CHROME_PATH')
  const fx = loadFixture()

  // refuse to shoot a server that is not serving the fixture: the sidebar would show real sessions
  let rootsSeen
  try {
    rootsSeen = await (await fetch(`${BASE}/api/claude/roots`)).json()
  } catch (e) {
    fail(`${BASE} is not answering (${e.message}) — start the server first (see the header of this file)`)
  }
  const served = (rootsSeen.roots || []).map((r) => path.resolve(r.dir))
  const expected = path.resolve(fx.manifest.claudeHome)
  if (!served.length || served.some((d) => d !== expected)) fail(`${BASE} serves ${served.join(', ') || 'nothing'} — not the fixture at ${expected}. Start it with AGENTDECK_CONFIG_DIR=${path.relative(process.cwd(), FIXTURE) || '.'}`)

  fs.mkdirSync(OUT, { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-shoot-'))
  const port = await freePort()
  // --lang: dates/times in the shots must not follow this machine's locale.
  // The back-forward cache is off on purpose: with it on, every page we navigate
  // away from stays alive for a while with its /events SSE socket open, and after
  // five or six shots Chrome's six-connections-per-host budget is spent — every
  // /api request then queues forever and the sidebar shows "no tracked folder".
  const chrome = spawn(browser, [`--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--lang=en-US', '--disable-back-forward-cache', '--disable-features=BackForwardCache', `--window-size=${W},${H}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  const written = []
  try {
    let version = null
    for (let i = 0; i < 60 && !version; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      } catch {
        await sleep(250)
      }
    }
    if (!version) fail('the browser did not start (remote debugging port never answered)')
    console.log(`browser: ${version.Browser}  ·  server: ${BASE}  ·  fixture: ${path.relative(process.cwd(), FIXTURE) || '.'} (${fx.manifest.scenario})`)
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false })
    await new Promise((r, j) => {
      ws.on('open', r)
      ws.on('error', j)
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable').catch(() => {})
    await cdp.send('Network.enable').catch(() => {})
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {})
    // console / network errors from the page, reported per shot. The app's nav
    // index swallows a failed /roots fetch and only retries 45 s later, so a
    // request that fails at boot leaves "no tracked folder" for the whole shot —
    // hence the retries below and this diagnostic trail.
    let pageErrors = []
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') pageErrors.push(`${entry.source}: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`)
    })
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => pageErrors.push(`exception: ${d.exception?.description || d.text}`))
    const reqUrl = new Map() // requestId -> { url, at, done }
    cdp.on('Network.requestWillBeSent', (p) => reqUrl.set(p.requestId, { url: p.request?.url || '', at: Date.now(), done: false }))
    cdp.on('Network.responseReceived', (p) => reqUrl.has(p.requestId) && (reqUrl.get(p.requestId).done = true))
    cdp.on('Network.loadingFailed', (p) => {
      const r = reqUrl.get(p.requestId)
      if (r) r.done = true
      pageErrors.push(`network: ${p.errorText}${p.canceled ? ' (canceled)' : ''} ${r?.url || ''}`)
    })
    // /api requests sent since `since` that never got a response — the tell-tale of a stalled load
    const stalled = (since) => [...reqUrl.values()].filter((r) => r.at >= since && !r.done && r.url.includes('/api/')).map((r) => `${r.url.replace(BASE, '')} (${((Date.now() - r.at) / 1000).toFixed(1)}s)`)

    let n = 0
    for (const theme of THEMES) {
      const themeKey = THEME_KEYS[theme]
      for (const shot of shots) {
        const name = `${shot.name}-${theme}.png`
        const file = path.join(OUT, name)
        const h = shot.h || H
        pageErrors = []
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: SCALE, mobile: false })
        // seed storage before the app boots (index.html reads the theme before React mounts)
        const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(seedsFor(fx, themeKey, A.seed || shot.seed)) })
        const hash = typeof shot.hash === 'function' ? shot.hash(fx) : shot.hash
        // a per-shot query string forces a full document load (a bare hash change
        // would not re-run the seed script), without bouncing through about:blank.
        // Up to three fresh loads: the page is only "ready" once the data is in.
        const readyExpr = shot.ready ? shot.ready(fx) : 'document.readyState === "complete"'
        let ready = false
        let since = Date.now()
        n++
        for (let attempt = 0; attempt < 3 && !ready; attempt++) {
          if (attempt) console.log(`    retry ${attempt} for ${name}${stalled(since).length ? ` — unanswered: ${stalled(since).join(', ')}` : pageErrors.length ? ` after: ${pageErrors[0].slice(0, 120)}` : ''}`)
          pageErrors = []
          // park on about:blank first so the previous page's SSE socket and
          // polling timers are really gone before the next app boots
          await cdp.send('Page.navigate', { url: 'about:blank' })
          await sleep(250)
          since = Date.now()
          await cdp.send('Page.navigate', { url: `${BASE}/?shot=${n}${attempt ? `&retry=${attempt}` : ''}${hash}` })
          ready = await cdp.waitFor(readyExpr, { timeout: 7000 })
        }
        if (!ready) {
          const glimpse = await cdp.eval(`${T}.replace(/\\s+/g, ' ').slice(0, 220)`).catch(() => '')
          console.warn(`  ! ${name}: readiness check timed out — capturing anyway\n      wanted: ${readyExpr.slice(0, 100)}…\n      page:   ${glimpse}${stalled(since).length ? `\n      unanswered: ${stalled(since).join(', ')}` : ''}`)
        }
        await sleep(1200) // let transitions / late fetches (usage, version) settle
        if (shot.act) {
          try {
            await shot.act(cdp, fx)
          } catch (e) {
            console.warn(`  ! ${name}: action failed: ${e.message}`)
          }
        }
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        fs.writeFileSync(file, Buffer.from(data, 'base64'))
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
        const boundary = await cdp.eval(`${T}.includes('Something went wrong')`).catch(() => false)
        const bad = boundary || !ready
        written.push({ file, theme, shot: shot.name, ok: !bad })
        console.log(`  ${bad ? '!' : '✓'} ${path.relative(process.cwd(), file)}  (${W}×${h})${boundary ? '  — an error boundary is showing' : ''}`)
        for (const e of pageErrors.slice(0, 3)) console.log(`      page error: ${e.slice(0, 160)}`)
      }
    }
    ws.close()
  } finally {
    chrome.kill()
    await sleep(300)
    if (!A['keep-profile']) fs.rmSync(profile, { recursive: true, force: true })
  }

  const flagged = written.filter((w) => !w.ok)
  if (!A['no-gif']) makeGif(written.filter((w) => w.theme === THEMES[0] && w.ok).map((w) => w.file), path.join(OUT, 'v2-tour.gif'))
  if (flagged.length) {
    console.warn(`\n${flagged.length} shot(s) flagged (!) — review them, then re-run just those:  --shots ${[...new Set(flagged.map((w) => w.shot))].join(',')}`)
    process.exitCode = 2
  }
}

// A 1 fps tour of the first theme's frames, when ffmpeg is on PATH.
function makeGif(frames, out) {
  if (frames.length < 2) return
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  const list = path.join(os.tmpdir(), `agentdeck-tour-${process.pid}.txt`)
  const listBody = frames.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration 1.5`).join('\n') + `\nfile '${frames[frames.length - 1].replace(/\\/g, '/')}'\n`
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=1,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', out]
  if (probe.status !== 0) {
    console.log(`\nffmpeg not on PATH — to build the tour GIF yourself, write a concat list (file '<png>' / duration 1.5 per frame) and run:\n  ffmpeg ${args.map((a) => (a.includes(' ') || a.includes(';') ? JSON.stringify(a) : a)).join(' ')}`)
    return
  }
  fs.writeFileSync(list, listBody)
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  fs.rmSync(list, { force: true })
  if (r.status === 0) console.log(`  ✓ ${path.relative(process.cwd(), out)}  (${frames.length} frames, 1 fps)`)
  else console.warn(`  ! ffmpeg failed (${r.status}): ${(r.stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ')}`)
}

main().catch((e) => {
  console.error(`shoot: ${e.stack || e.message}`)
  process.exit(1)
})
