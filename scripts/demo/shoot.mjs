#!/usr/bin/env node
// shoot.mjs — headless screenshots of AgentDeck for README / release notes.
//
// Drives Chrome (or Edge) over the DevTools protocol (scripts/demo/lib.mjs — the
// `ws` package, no puppeteer). Meant to run against a server that serves the
// demo fixture, never a real home:
//
//   node scripts/demo/make-fixture.mjs            # tmp/demo-root
//   npx vite build
//   AGENTDECK_CONFIG_DIR=tmp/demo-root AGENTDECK_PORT=47861 AGENTDECK_WEB_PORT=47862 node server/index.js &
//   node scripts/demo/shoot.mjs --base http://localhost:47861
//
// Output goes to demo/<release>/<shot>.png (release = vMAJOR.MINOR from
// package.json, e.g. demo/v2.0/; --release overrides). One theme by default
// (graphite); with several --themes the file names get a -<theme> suffix. The
// browser profile is a throw-away temp dir; localStorage is seeded per shot
// (theme, prefs, pins, a workspace, recent sessions, tabs) from the fixture
// manifest, so the sidebar looks lived-in and only ever names fictional
// projects. The moving tour (tour.gif / tour.mp4) is record.mjs's job.
//
// Usage:
//   node scripts/demo/shoot.mjs [--base http://localhost:47861] [--release v2.0] [--out <dir>] [--fixture tmp/demo-root]
//        [--themes graphite] [--shots home-activity,insights,…] [--w 1440] [--h 900] [--scale 1]
//        [--seed base|full] [--browser <path-to-chrome-or-edge>] [--keep-profile] [--list]
//   --seed overrides every shot's storage seeding: base = theme/prefs only, full = + pins,
//   workspace, recent, tabs (the default is per shot, see SHOTS)

import fs from 'node:fs'
import path from 'node:path'
import { REPO, THEME_KEYS, assertFixtureServer, currentRelease, fail, findBrowser, launchBrowser, loadFixture, parseArgs, seedScript, seedsFor, sessionHash, sleep } from './lib.mjs'

const A = parseArgs(process.argv.slice(2), ['--keep-profile', '--list'])
if (A.help) {
  console.log('usage: node scripts/demo/shoot.mjs [--base http://localhost:47861] [--release v2.0] [--out <dir>] [--fixture tmp/demo-root] [--themes graphite] [--shots a,b] [--w 1440] [--h 900] [--scale 1] [--browser exe] [--keep-profile] [--list]')
  process.exit(0)
}
const BASE = (A.base || 'http://localhost:47861').replace(/\/+$/, '')
const RELEASE = A.release || currentRelease()
const OUT = path.resolve(A.out || path.join(REPO, 'demo', RELEASE))
const FIXTURE = path.resolve(A.fixture || path.join(REPO, 'tmp', 'demo-root'))
const W = Number(A.w || 1440)
const H = Number(A.h || 900)
const SCALE = Number(A.scale || 1)
const THEMES = (A.themes || 'graphite').split(',').map((s) => s.trim()).filter(Boolean)
for (const t of THEMES) if (!THEME_KEYS[t]) fail(`unknown theme "${t}" — one of ${Object.keys(THEME_KEYS).join(', ')}`)

// ---- the shot list ----------------------------------------------------------------
// hash: where to navigate (src/lib/route.js) · seed: 'base' | 'full' · h: viewport
// height · ready: page-side predicate that says the data is on screen · act: extra
// steps before capture (CDP client + fixture)

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
    about: 'Sidebar with a cross-provider workspace (grouped by project) and pinned rows',
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
  {
    name: 'preferences-open',
    hash: '#/',
    seed: 'full',
    h: H,
    ready: () => all(booted, hasText('LATEST SESSIONS')),
    act: async (cdp) => {
      await cdp.eval(`(() => { const b = document.querySelector('button[title="Preferences"]'); if (b) b.click(); return !!b })()`)
      await cdp.waitFor(`/colours/i.test(${T})`, { timeout: 3000 }) // innerText carries the CSS uppercase
      // unfold the first provider's colour tray so the picker is in the shot
      await cdp.eval(`(() => { const c = document.querySelector('[data-accent-chip]'); if (c) c.click(); return !!c })()`)
      await cdp.waitFor(`!!document.querySelector('[data-swatch]')`, { timeout: 3000 })
      await sleep(400)
    },
    about: 'Preferences popover with a provider colour tray open',
  },
  {
    name: 'workspace-menu',
    hash: '#/',
    seed: 'full',
    h: H,
    ready: () => all(booted, hasText('LATEST SESSIONS')),
    act: async (cdp, fx) => {
      // the workspace row's ⋯ menu, with its colour tray unfolded
      await cdp.eval(`(() => {
        const s = document.querySelector('span[title=${JSON.stringify(fx.shared?.name || '')}]');
        const row = s && s.closest('.group');
        const more = row && row.querySelector('button[title="More"]'); if (more) more.click();
        return !!more })()`)
      await cdp.waitFor(`!!document.querySelector('[data-accent-chip]')`, { timeout: 3000 })
      // unfold the icon grid (the colour tray stays folded — one thing at a time)
      await cdp.eval(`(() => { const c = document.querySelector('[data-icon-chip]'); if (c) c.click(); return !!c })()`)
      await cdp.waitFor(`!!document.querySelector('[data-icon-choice]')`, { timeout: 3000 })
      await sleep(400)
    },
    about: 'A workspace ⋯ menu (rename, delete, icon, colour)',
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

  const browser = findBrowser(A.browser)
  if (!browser) fail('no Chrome/Edge found — pass --browser <path> or set CHROME_PATH')
  const fx = loadFixture(FIXTURE)
  await assertFixtureServer(BASE, fx)

  fs.mkdirSync(OUT, { recursive: true })
  const { cdp, close, version } = await launchBrowser({ browser, width: W, height: H, keepProfile: !!A['keep-profile'] })
  const written = []
  try {
    console.log(`browser: ${version}  ·  server: ${BASE}  ·  fixture: ${path.relative(process.cwd(), FIXTURE) || '.'} (${fx.manifest.scenario})  ·  out: ${path.relative(process.cwd(), OUT)}`)
    await cdp.send('Log.enable').catch(() => {})
    await cdp.send('Network.enable').catch(() => {})
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
        const name = THEMES.length > 1 ? `${shot.name}-${theme}.png` : `${shot.name}.png`
        const file = path.join(OUT, name)
        const h = shot.h || H
        pageErrors = []
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: SCALE, mobile: false })
        // seed storage before the app boots (index.html reads the theme before React mounts)
        const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(seedsFor(fx, themeKey, A.seed || shot.seed)) })
        const hash = typeof shot.hash === 'function' ? shot.hash(fx) : shot.hash
        // a per-shot query string forces a full document load (a bare hash change
        // would not re-run the seed script). Up to three fresh loads: the page is
        // only "ready" once the data is in.
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
  } finally {
    await close()
  }

  const flagged = written.filter((w) => !w.ok)
  if (flagged.length) {
    console.warn(`\n${flagged.length} shot(s) flagged (!) — review them, then re-run just those:  --shots ${[...new Set(flagged.map((w) => w.shot))].join(',')}`)
    process.exitCode = 2
  }
}

main().catch((e) => {
  console.error(`shoot: ${e.stack || e.message}`)
  process.exit(1)
})
