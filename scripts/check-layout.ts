#!/usr/bin/env node
import type { Cdp } from './demo/lib.ts'
import type { LayoutProbe, LayoutViolation } from './demo/probe.ts'
interface LayoutRow extends LayoutProbe {
  scene: string
  theme: string
  ready: boolean
}
export interface LayoutBaseline {
  known: Record<string, unknown>
  platforms?: NodeJS.Platform[]
  exclusive?: Record<string, NodeJS.Platform[]>
}
// Structural layout checks on synthetic data; never publishes release assets.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateFixture } from './demo/make-fixture.ts'
import { findBrowser, launchBrowser, withBrowserCleanup, seedScript, seedsFor } from './demo/lib.ts'
import { getScenes, getCheckOnlyScenes } from './demo/scenes.ts'
import { probeLayout } from './demo/probe.ts'
import { normalize, withFixtureServer } from './snapshot.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'scripts/layout-baseline.json')
const clock = '2026-09-07T12:00:00.000Z'
const themes = ['midnight', 'graphite', 'light']
const widths = [1440, 1180, 900]
const scenes = [...getScenes(), ...getCheckOnlyScenes()].filter((scene) => scene.check)
export const layoutIssueKey = (row: Pick<LayoutRow, 'scene' | 'theme' | 'width'>, violation: Pick<LayoutViolation, 'rule' | 'selector'>) =>
  createHash('sha256').update(`${row.scene}|${row.theme}|${row.width}|${violation.rule}|${violation.selector}`).digest('hex')

export function knownLayoutIssue(
  baseline: LayoutBaseline,
  row: Pick<LayoutRow, 'scene' | 'theme' | 'width'>,
  violation: Pick<LayoutViolation, 'rule' | 'selector'>,
  platform = process.platform
) {
  if (violation.rule === 'scene-not-ready') return false
  if (!(baseline.platforms || ['darwin']).includes(platform)) return false
  const key = layoutIssueKey(row, violation)
  return !!baseline.known[key] && (!baseline.exclusive?.[key] || baseline.exclusive[key].includes(platform))
}

export async function waitForSettledScene(
  cdp: { waitFor: Cdp['waitFor']; eval: (expression: string) => Promise<unknown> },
  predicate: string,
  settleApi: () => Promise<boolean>
) {
  await cdp.waitFor(predicate, { timeout: 9000, every: 100 })
  const settled = await settleApi()
  // A slow response may arrive after the first predicate wait. The actual
  // settled page must satisfy that same predicate before actions or capture.
  return settled && !!(await cdp.eval(predicate))
}

export async function captureLayout({
  fast = false,
  out = path.join(ROOT, 'tmp', 'layout-check'),
  sheet = false,
  only = null,
}: {
  fast?: boolean
  out?: string
  sheet?: boolean
  only?: string[] | null
} = {}) {
  const started = performance.now()
  out = path.resolve(out)
  assert.ok(out.startsWith(`${path.join(ROOT, 'tmp')}${path.sep}`), 'layout evidence belongs under tmp/')
  if (only)
    for (const name of only)
      assert.ok(
        scenes.some((scene) => scene.name === name),
        `unknown layout scene: ${name}`
      )
  for (const dir of ['layout', 'text', 'shots', 'crops']) fs.mkdirSync(path.join(out, dir), { recursive: true })
  const browser = findBrowser()
  assert.ok(browser, 'Chrome/Edge is required for layout verification')
  const instance = await launchBrowser({ browser, width: 1440, height: 900 })
  const { cdp } = instance
  const rows: LayoutRow[] = []
  const baseline: LayoutBaseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { known: {} }
  let sequence = 0
  await withBrowserCleanup(instance.close, async () => {
    await cdp.send('Network.enable')
    const pendingApi = new Map()
    let lastApi = performance.now()
    cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
      if (new URL(request.url).pathname.startsWith('/api/')) {
        pendingApi.set(requestId, request.url)
        lastApi = performance.now()
      }
    })
    const finished = ({ requestId }: { requestId: string }) => {
      if (pendingApi.delete(requestId)) lastApi = performance.now()
    }
    cdp.on('Network.loadingFinished', finished)
    cdp.on('Network.loadingFailed', finished)
    async function settleApi() {
      const deadline = performance.now() + 9000
      while (pendingApi.size || performance.now() - lastApi < 100) {
        if (performance.now() > deadline) {
          console.warn(`layout API readiness timed out: ${JSON.stringify([...pendingApi.values()])}`)
          return false
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return true
    }
    for (const scenario of ['v2-highlights', 'empty', 'error', 'stress', 'folders']) {
      const selected = scenes.filter((scene) => (scene.scenario || 'v2-highlights') === scenario && (!only || only.includes(scene.name)))
      if (!selected.length) continue
      const fixture = path.join(ROOT, 'tmp', `layout-fixture-${scenario}`)
      if (!fs.existsSync(path.join(fixture, 'manifest.json'))) generateFixture({ out: fixture, scenario, now: clock })
      await withFixtureServer(
        fixture,
        async (fx, base) => {
          for (const theme of fast ? ['midnight'] : themes) {
            for (const width of fast ? [1440] : widths) {
              for (const scene of selected) {
                const height = scene.h || 900
                await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
                const seeds = seedsFor(fx, theme, scene.seed)
                if (scene.prefs) seeds.agentdeck_prefs = { ...seeds.agentdeck_prefs, ...scene.prefs }
                if (scenario === 'stress' && scene.seed !== 'base') seeds.agentdeck_workspaces = fx.manifest.workspaces
                const dateScript = `const OriginalDate = Date; globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [${JSON.stringify(clock)}])); } static now() { return OriginalDate.parse(${JSON.stringify(clock)}); } };`
                const motionScript = `document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = '*,:before,:after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(style); }, { once: true });`
                const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
                  source: `try { localStorage.clear() } catch {}\n${seedScript(seeds)}\n${dateScript}\n${motionScript}`,
                })
                const hash = typeof scene.hash === 'function' ? scene.hash(fx) : scene.hash
                await cdp.send('Page.navigate', { url: 'about:blank' })
                pendingApi.clear()
                await cdp.send('Page.navigate', { url: `${base}/?check=${++sequence}${hash}` })
                let ready = await waitForSettledScene(cdp, scene.ready(fx), settleApi)
                await cdp.eval('document.fonts.ready')
                await cdp.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                if (scene.act && ready) await scene.act(cdp, fx)
                ready = (await settleApi()) && ready
                // The legacy Claude app reports its tab label before its
                // project lookup can finish. Re-select the visible pane as a
                // user would, after data settles. WP-4 owns that startup race.
                if (ready && ['session-conversation', 'long-conversation'].includes(scene.name)) {
                  const selected = await cdp.eval<boolean>(`(() => {
                    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Conversation');
                    button?.click(); return !!button;
                  })()`)
                  ready = selected && ready
                }
                await cdp.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                const result = await cdp.eval<LayoutProbe>(`(${probeLayout.toString()})()`)
                assert.ok(result && Array.isArray(result.violations), 'layout probe must return its full result')
                const row = { scene: scene.name, theme, ready, ...result }
                if (!ready)
                  row.violations.push({
                    rule: 'scene-not-ready',
                    selector: 'body',
                    actual: { predicate: scene.ready(fx), text: result.text.slice(0, 200) },
                    rect: { x: 0, y: 0, width, height },
                    reportOnly: false,
                  })
                const name = `${scene.name}-${theme}-${width}`
                fs.writeFileSync(path.join(out, 'layout', `${name}.json`), `${JSON.stringify(normalize({ ...row, text: undefined }, { fixture }), null, 2)}\n`)
                fs.writeFileSync(path.join(out, 'text', `${name}.txt`), `${normalize(row.text, { fixture })}\n`)
                if (!fast || sheet || row.violations.some((v) => !v.reportOnly && !baseline.known[layoutIssueKey(row, v)])) {
                  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
                  fs.writeFileSync(path.join(out, 'shots', `${name}.png`), Buffer.from(shot.data, 'base64'))
                  // Crop the single captured frame in one page-side batch; repeated
                  // DevTools screenshots are slow and could capture different ticks.
                  const crops = await cdp.eval<(string | null)[]>(`(async () => {
                  const image = new Image(); image.src = 'data:image/png;base64,${shot.data}'; await image.decode();
                  return ${JSON.stringify(row.violations.map((v) => v.rect))}.map(r => {
                    const x = Math.max(0, r.x), y = Math.max(0, r.y);
                    const w = Math.min(image.width - x, r.width), h = Math.min(image.height - y, r.height);
                    if (w <= 0 || h <= 0) return null;
                    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(image, x, y, w, h, 0, 0, w, h);
                    return canvas.toDataURL('image/png').split(',')[1];
                  });
                })()`)
                  for (const [i, crop] of crops.entries()) if (crop) fs.writeFileSync(path.join(out, 'crops', `${name}-${i}.png`), Buffer.from(crop, 'base64'))
                }
                rows.push(row)
                await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
                console.log(`layout ${name}: ${row.violations.length} violations${ready ? '' : ' (NOT READY)'}`)
              }
            }
          }
          await cdp.send('Page.navigate', { url: 'about:blank' })
        },
        { port: 47871 }
      )
    }
    if (sheet) {
      const tiles = rows
        .map((row) => {
          const name = `${row.scene}-${row.theme}-${row.width}`
          const png = fs.readFileSync(path.join(out, 'shots', `${name}.png`)).toString('base64')
          return `<figure><figcaption>${name}</figcaption><img src="data:image/png;base64,${png}"></figure>`
        })
        .join('')
      const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#ddd;font:12px sans-serif;display:grid;grid-template-columns:repeat(3,320px)}figure{margin:4px}img{width:312px;display:block}figcaption{padding:4px}</style>${tiles}`
      fs.writeFileSync(path.join(out, 'contact-sheet.html'), html)
      const navigation = await cdp.send('Page.navigate', { url: pathToFileURL(path.join(out, 'contact-sheet.html')).href })
      assert.ok(!navigation.errorText, `contact sheet navigation failed: ${navigation.errorText}`)
      assert.ok(
        await cdp.waitFor('document.images.length > 0 && [...document.images].every(i => i.complete && i.naturalWidth > 0)'),
        'contact sheet images did not load'
      )
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 900, deviceScaleFactor: 1, mobile: false })
      const height = await cdp.eval('document.documentElement.scrollHeight')
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 960, height, scale: 1 }, captureBeyondViewport: true })
      fs.writeFileSync(path.join(out, 'contact-sheet.png'), Buffer.from(shot.data, 'base64'))
    }
  })
  const unexpected = rows.flatMap((row) =>
    row.violations
      .filter((v) => !v.reportOnly && !knownLayoutIssue(baseline, row, v))
      .map((v) => ({ ...v, scene: row.scene, theme: row.theme, width: row.width }))
  )
  const summary = {
    platform: process.platform,
    arch: process.arch,
    durationMs: Math.round(performance.now() - started),
    scenes: rows.length,
    themes: [...new Set(rows.map((r) => r.theme))],
    widths: [...new Set(rows.map((r) => r.width))],
    violations: rows.reduce((n, r) => n + r.violations.length, 0),
    unexpected,
    rows: rows.map(({ geometry, text, ...row }) => row),
  }
  fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`check:layout: ${rows.length} scenes; ${summary.violations} violations; ${unexpected.length} new hard violations`)
  return summary
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
  try {
    const summary = await captureLayout({
      fast: args.includes('--fast'),
      sheet: args.includes('--sheet'),
      out: value('--out'),
      only: value('--scenes')?.split(','),
    })
    process.exitCode = summary.unexpected.length ? 1 : 0
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  }
}
