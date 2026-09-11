#!/usr/bin/env node
// shoot.mjs — headless screenshots of AgentDeck for README / release notes.
//
// Drives Chrome (or Edge) over the DevTools protocol (scripts/demo/lib.ts — the
// `ws` package, no puppeteer). Meant to run against a server that serves the
// demo fixture, never a real home:
//
//   node scripts/demo/make-fixture.ts            # tmp/demo-root
//   npx vite build
//   AGENTDECK_CONFIG_DIR=tmp/demo-root AGENTDECK_PORT=47861 AGENTDECK_WEB_PORT=47862 node server/index.ts &
//   node scripts/demo/shoot.ts --base http://localhost:47861
//
// Output goes to demo/<release>/<shot>.png (release = vMAJOR.MINOR from
// package.json, e.g. demo/v2.0/; --release overrides). One theme by default
// (midnight); with several --themes the file names get a -<theme> suffix. The
// browser profile is a throw-away temp dir; localStorage is seeded per shot
// (theme, prefs, pins, a workspace, recent sessions, tabs) from the fixture
// manifest, so the sidebar looks lived-in and only ever names fictional
// projects. The moving tour (tour.gif / tour.mp4) is record.mjs's job.
//
// Usage:
//   node scripts/demo/shoot.ts [--base http://localhost:47861] [--release v2.0] [--out <dir>] [--fixture tmp/demo-root]
//        [--themes midnight] [--shots home-activity,insights,…] [--w 1440] [--h 900] [--scale 1]
//        [--seed base|full] [--browser <path-to-chrome-or-edge>] [--keep-profile] [--list]
//   --seed overrides every shot's storage seeding: base = theme/prefs only, full = + pins,
//   workspace, recent, tabs (the default is per shot, see SHOTS)

import { getScenes } from './scenes.ts'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPO,
  THEME_KEYS,
  assertFixtureServer,
  currentRelease,
  fail,
  findBrowser,
  launchBrowser,
  withBrowserCleanup,
  loadFixture,
  parseArgs,
  argText,
  seedScript,
  seedsFor,
  sleep,
} from './lib.ts'

const A = parseArgs(process.argv.slice(2), ['--keep-profile', '--list'])
if (A.help) {
  console.log(
    'usage: node scripts/demo/shoot.ts [--base http://localhost:47861] [--release v2.0] [--out <dir>] [--fixture tmp/demo-root] [--themes graphite] [--shots a,b] [--w 1440] [--h 900] [--scale 1] [--browser exe] [--keep-profile] [--list]'
  )
  process.exit(0)
}
const BASE = (argText(A.base) || 'http://localhost:47861').replace(/\/+$/, '')
const RELEASE = argText(A.release) || currentRelease()
const OUT = path.resolve(argText(A.out) || path.join(REPO, 'demo', RELEASE))
const FIXTURE = path.resolve(argText(A.fixture) || path.join(REPO, 'tmp', 'demo-root'))
const W = Number(A.w || 1440)
const H = Number(A.h || 900)
const SCALE = Number(A.scale || 1)
const THEMES = (argText(A.themes) || 'midnight')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)
for (const t of THEMES) if (!THEME_KEYS[t]) fail(`unknown theme "${t}" — one of ${Object.keys(THEME_KEYS).join(', ')}`)

const T = 'document.body.innerText'
const SHOTS = getScenes(H)

// ---- main ---------------------------------------------------------------------------

async function main() {
  if (A.list) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(28)} ${s.about}`)
    return
  }
  const only = argText(A.shots) ? (argText(A.shots) || '').split(',').map((s: string) => s.trim()) : null
  const shots = only ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS
  if (only) for (const n of only) if (!SHOTS.some((s) => s.name === n)) fail(`unknown shot "${n}" — see --list`)

  const browser = findBrowser(argText(A.browser))
  if (!browser) fail('no Chrome/Edge found — pass --browser <path> or set CHROME_PATH')
  const fx = loadFixture(FIXTURE)
  await assertFixtureServer(BASE, fx)

  fs.mkdirSync(OUT, { recursive: true })
  const { cdp, close, version } = await launchBrowser({ browser, width: W, height: H, keepProfile: !!A['keep-profile'] })
  const written: { file: string; theme: string; shot: string; ok: boolean }[] = []
  await withBrowserCleanup(close, async () => {
    console.log(
      `browser: ${version}  ·  server: ${BASE}  ·  fixture: ${path.relative(process.cwd(), FIXTURE) || '.'} (${fx.manifest.scenario})  ·  out: ${path.relative(process.cwd(), OUT)}`
    )
    await cdp.send('Log.enable').catch(() => {})
    await cdp.send('Network.enable').catch(() => {})
    // console / network errors from the page, reported per shot. The app's nav
    // index swallows a failed /roots fetch and only retries 45 s later, so a
    // request that fails at boot leaves "no tracked folder" for the whole shot —
    // hence the retries below and this diagnostic trail.
    let pageErrors: string[] = []
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error') pageErrors.push(`${entry.source}: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`)
    })
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => pageErrors.push(`exception: ${d.exception?.description || d.text}`))
    const reqUrl = new Map() // requestId -> { url, at, done }
    cdp.on('Network.requestWillBeSent', (p) => reqUrl.set(p.requestId, { url: p.request?.url || '', at: Date.now(), done: false }))
    cdp.on('Network.responseReceived', (p) => {
      if (reqUrl.has(p.requestId)) reqUrl.get(p.requestId).done = true
    })
    cdp.on('Network.loadingFailed', (p) => {
      const r = reqUrl.get(p.requestId)
      if (r) r.done = true
      pageErrors.push(`network: ${p.errorText}${p.canceled ? ' (canceled)' : ''} ${r?.url || ''}`)
    })
    // /api requests sent since `since` that never got a response — the tell-tale of a stalled load
    const stalled = (since: number) =>
      [...reqUrl.values()]
        .filter((r) => r.at >= since && !r.done && r.url.includes('/api/'))
        .map((r) => `${r.url.replace(BASE, '')} (${((Date.now() - r.at) / 1000).toFixed(1)}s)`)

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
        const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: seedScript(seedsFor(fx, themeKey, argText(A.seed) || shot.seed)),
        })
        const hash = typeof shot.hash === 'function' ? shot.hash(fx) : shot.hash
        // a per-shot query string forces a full document load (a bare hash change
        // would not re-run the seed script). Up to three fresh loads: the page is
        // only "ready" once the data is in.
        const readyExpr = shot.ready ? shot.ready(fx) : 'document.readyState === "complete"'
        let ready = false
        let since = Date.now()
        n++
        for (let attempt = 0; attempt < 3 && !ready; attempt++) {
          if (attempt)
            console.log(
              `    retry ${attempt} for ${name}${stalled(since).length ? ` — unanswered: ${stalled(since).join(', ')}` : pageErrors.length ? ` after: ${pageErrors[0].slice(0, 120)}` : ''}`
            )
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
          console.warn(
            `  ! ${name}: readiness check timed out — capturing anyway\n      wanted: ${readyExpr.slice(0, 100)}…\n      page:   ${glimpse}${stalled(since).length ? `\n      unanswered: ${stalled(since).join(', ')}` : ''}`
          )
        }
        await sleep(1200) // let transitions / late fetches (usage, version) settle
        if (shot.act) {
          try {
            await shot.act(cdp, fx)
          } catch (e) {
            console.warn(`  ! ${name}: action failed: ${e instanceof Error ? e.message : String(e)}`)
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
  })

  const flagged = written.filter((w) => !w.ok)
  if (flagged.length) {
    console.warn(
      `\n${flagged.length} shot(s) flagged (!) — review them, then re-run just those:  --shots ${[...new Set(flagged.map((w) => w.shot))].join(',')}`
    )
    process.exitCode = 2
  }
}

main().catch((e) => {
  console.error(`shoot: ${e.stack || e.message}`)
  process.exit(1)
})
