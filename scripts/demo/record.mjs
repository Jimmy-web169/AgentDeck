#!/usr/bin/env node
// record.mjs — a short, moving tour of AgentDeck for the README: tour.gif + tour.mp4.
//
// Unlike shoot.mjs (still frames), this drives a scripted tour in headless
// Chrome while Page.startScreencast streams every repaint; the frames are
// stitched with ffmpeg into an animated GIF (and an MP4 for anywhere that can
// play video). A drawn cursor glides to each control before it is clicked, so
// the recording reads like someone using the app. Same rules as shoot.mjs: the
// server must serve the demo fixture, never a real home.
//
//   node scripts/demo/make-fixture.mjs && npx vite build
//   AGENTDECK_CONFIG_DIR=tmp/demo-root AGENTDECK_PORT=47861 AGENTDECK_WEB_PORT=47862 node server/index.js &
//   node scripts/demo/record.mjs --base http://localhost:47861
//
// Usage:
//   node scripts/demo/record.mjs [--base http://localhost:47861] [--release v2.0] [--out <dir>] [--fixture tmp/demo-root]
//        [--theme graphite] [--w 1440] [--h 900] [--gif-width 1200] [--fps 12] [--dither bayer:bayer_scale=5|none]
//        [--browser exe] [--keep-frames] [--no-mp4]
//
// Needs ffmpeg on PATH. Output: <out>/tour.gif and <out>/tour.mp4 (out defaults to demo/<release>/).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO, THEME_KEYS, assertFixtureServer, currentRelease, fail, findBrowser, hasFfmpeg, launchBrowser, loadFixture, parseArgs, seedScript, seedsFor, sessionHash, sleep } from './lib.mjs'

const A = parseArgs(process.argv.slice(2), ['--keep-frames', '--no-mp4'])
if (A.help) {
  console.log('usage: node scripts/demo/record.mjs [--base http://localhost:47861] [--release v2.0] [--out <dir>] [--fixture tmp/demo-root] [--theme graphite] [--w 1440] [--h 900] [--gif-width 1280] [--fps 15] [--browser exe] [--keep-frames] [--no-mp4]')
  process.exit(0)
}
const BASE = (A.base || 'http://localhost:47861').replace(/\/+$/, '')
const RELEASE = A.release || currentRelease()
const OUT = path.resolve(A.out || path.join(REPO, 'demo', RELEASE))
const FIXTURE = path.resolve(A.fixture || path.join(REPO, 'tmp', 'demo-root'))
const THEME = A.theme || 'graphite'
if (!THEME_KEYS[THEME]) fail(`unknown theme "${THEME}" — one of ${Object.keys(THEME_KEYS).join(', ')}`)
const W = Number(A.w || 1440)
const H = Number(A.h || 900)
const GIF_W = Number(A['gif-width'] || 1200)
const FPS = Number(A.fps || 12)

const T = 'document.body.innerText'
const hasText = (s) => `${T}.includes(${JSON.stringify(s)})`
const booted = `/PROJECTS\\s*·\\s*[1-9]/.test(${T}) && !/Loading(…|\\.\\.\\.)/.test(${T}) && !${T}.includes('no tracked folder')`

// ---- a cursor the screencast can see ----------------------------------------------
// Headless Chrome paints no pointer, so the page gets a small fixed-position arrow
// that glides (CSS transition) to wherever the tour is about to click.
const CURSOR_JS = `
(() => {
  if (window.__demoCursor) return true
  const c = document.createElement('div')
  c.id = '__demo-cursor'
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(60px,60px);transition:transform 420ms cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))'
  c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l14 8.5-6.2 1.3L16 20l-2.6 1.2-3.2-7.2L5 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  document.body.appendChild(c)
  window.__demoCursor = c
  return true
})()`

class Tour {
  constructor(cdp) {
    this.cdp = cdp
  }
  async cursor() {
    await this.cdp.eval(CURSOR_JS)
  }
  // centre of the first element matching `expr` (a JS expression returning an Element)
  async rectOf(expr) {
    return this.cdp.eval(`(() => { const el = (${expr}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } })()`)
  }
  async moveTo(x, y, settle = 480) {
    await this.cdp.eval(`(() => { const c = window.__demoCursor; if (c) c.style.transform = 'translate(' + ${Math.round(x)} + 'px,' + ${Math.round(y)} + 'px)'; return true })()`)
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(settle)
  }
  async click(expr, { settle = 480, after = 600 } = {}) {
    const r = await this.rectOf(expr)
    if (!r) {
      console.warn(`  ! nothing to click for ${expr.slice(0, 80)}`)
      return false
    }
    await this.moveTo(r.x, r.y, settle)
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(after)
    return true
  }
  async type(text, perChar = 110) {
    for (const ch of text) {
      await this.cdp.send('Input.insertText', { text: ch })
      await sleep(perChar)
    }
  }
  async key(key, code) {
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0 })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0 })
  }
  async wheel(x, y, deltaY, steps = 4, gap = 260) {
    await this.moveTo(x, y, 200)
    for (let i = 0; i < steps; i++) {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
      await sleep(gap)
    }
  }
  async wait(expr, timeout = 8000) {
    const ok = await this.cdp.waitFor(expr, { timeout })
    if (!ok) console.warn(`  ! timed out waiting for ${expr.slice(0, 90)}`)
    return ok
  }
}

// ---- the tour ----------------------------------------------------------------------
// Each step is a beat a viewer can follow: land on Home, jump with Ctrl+K,
// open a session, unfold a sub-agent thread, scroll, come back Home for Stats
// and Insights, open the workspace in the sidebar, pick a colour. ~35 s.
async function tour(t, fx, cdp) {
  const byText = (tag, text) => `[...document.querySelectorAll(${JSON.stringify(tag)})].find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)})`
  await t.wait(`${booted} && ${hasText('LATEST SESSIONS')}`)
  await t.cursor()
  await sleep(1600)

  // Ctrl+K, type, pick the first hit
  await t.moveTo(W * 0.5, H * 0.45, 500)
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); true`)
  await t.wait(`!!document.querySelector('input[placeholder*="Jump to"]')`, 4000)
  await sleep(500)
  await t.type((fx.shared?.name || 'orbit').slice(0, 5))
  await sleep(900)
  await t.key('Enter', 'Enter')
  await t.wait(`/\\d+ prompts?/.test(${T})`, 8000)
  await sleep(1400)

  // the seeded tab of the session that has sub-agents: load the whole
  // conversation, open the first inline thread, scroll it into view
  if (fx.claudeStar) {
    const tabTitle = `${fx.claudeStar.project} · ${(fx.claudeStar.title || '').slice(0, 18)}`
    // the tab element carries `title="<project> · <session title>\n<cwd>"` (TabStrip); it is not a <button>
    await t.click(`[...document.querySelectorAll('[title]')].find((el) => (el.getAttribute('title') || '').startsWith(${JSON.stringify(tabTitle)}))`, { after: 1200 })
    await t.wait(`/\\d+ prompts?/.test(${T})`, 8000)
    await t.click(`document.querySelector('button[title^="Only the latest messages"]')`, { after: 900 })
    const thread = `[...document.querySelectorAll('button')].find((x) => /show thread/.test(x.textContent || ''))`
    if (await t.wait(`!!(${thread})`, 4000)) {
      await t.click(thread, { after: 900 })
      await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /hide thread/.test(x.textContent || '')); const block = b && b.closest('div.my-2'); const call = block && block.previousElementSibling; (call || block || b)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true })()`)
      await sleep(1600)
    }
  }
  await t.wheel(W * 0.6, H * 0.6, 260, 5, 240)
  await sleep(900)

  // back Home: Stats, then Insights
  await t.click(`document.querySelector('button[title="Home"]')`, { after: 900 })
  await t.wait(`${hasText('LATEST SESSIONS')}`, 5000)
  await sleep(600)
  await t.click(byText('button', 'Stats'), { after: 1200 })
  await t.wait(hasText('tokens'), 5000)
  await sleep(1200)
  await t.click(byText('button', 'Insights'), { after: 1200 })
  await t.wait(hasText('Your last 30 days'), 6000)
  await sleep(900)
  await t.wheel(W * 0.6, H * 0.6, 300, 4, 260)
  await sleep(900)

  // the workspace in the sidebar: expand it, see the projects grouped inside
  const wsBtn = `(() => { const s = document.querySelector('span[title=${JSON.stringify(fx.shared?.name || '')}]'); return s && s.closest('button') })()`
  await t.click(wsBtn, { after: 1500 })

  // Preferences: pick a different accent for the first provider
  await t.click(`document.querySelector('button[title="Preferences"]')`, { after: 900 })
  await t.wait(`/colours/i.test(${T})`, 3000) // innerText carries the CSS uppercase
  await t.click(`document.querySelector('button[title="Violet"]') || document.querySelector('button[title="Teal"]')`, { after: 1400 })
  await t.key('Escape', 'Escape')
  await sleep(1200)
  await t.moveTo(W * 0.55, H * 0.5, 600)
  await sleep(600)
}

// ---- main ---------------------------------------------------------------------------

async function main() {
  if (!hasFfmpeg()) fail('ffmpeg is not on PATH — install it (winget install Gyan.FFmpeg / brew install ffmpeg) and re-run')
  const browser = findBrowser(A.browser)
  if (!browser) fail('no Chrome/Edge found — pass --browser <path> or set CHROME_PATH')
  const fx = loadFixture(FIXTURE)
  await assertFixtureServer(BASE, fx)
  fs.mkdirSync(OUT, { recursive: true })
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-tour-'))

  const { cdp, close, version } = await launchBrowser({ browser, width: W, height: H })
  const frames = [] // { file, ts }
  try {
    console.log(`browser: ${version}  ·  server: ${BASE}  ·  fixture: ${path.relative(process.cwd(), FIXTURE) || '.'} (${fx.manifest.scenario})  ·  out: ${path.relative(process.cwd(), OUT)}`)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(seedsFor(fx, THEME_KEYS[THEME], 'full')) })
    let n = 0
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(framesDir, `${String(n++).padStart(5, '0')}.png`)
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      frames.push({ file, ts: metadata.timestamp })
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    // the screencast is started on the blank tab and survives the navigation —
    // starting it mid-navigation fails with "Not attached to an active page"
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 })
    const t0 = Date.now()
    await cdp.send('Page.navigate', { url: `${BASE}/?tour=1#/` })
    await cdp.waitFor('document.readyState === "complete"', { timeout: 10000 })
    await tour(new Tour(cdp), fx, cdp)
    await sleep(800)
    await cdp.send('Page.stopScreencast')
    console.log(`  captured ${frames.length} frames over ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  } finally {
    await close()
  }
  if (frames.length < 2) fail('no frames captured')

  // Frames arrive only when the screen changes, so give each one the time until
  // the next (clamped) — a concat list ffmpeg turns into a constant-fps stream.
  const list = path.join(framesDir, 'frames.txt')
  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1]?.ts ?? frames[i].ts + 0.8
    const dur = Math.min(2.5, Math.max(1 / 60, next - frames[i].ts))
    lines.push(`file '${frames[i].file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`, `duration ${dur.toFixed(4)}`)
  }
  lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`)
  fs.writeFileSync(list, lines.join('\n') + '\n')

  const gif = path.join(OUT, 'tour.gif')
  const mp4 = path.join(OUT, 'tour.mp4')
  // Two passes on purpose. The MP4 comes straight from the frames (h264, crf 20
  // — near-lossless for a UI, ~1 MB for 30 s). The GIF is then made FROM the
  // MP4, not from the raw frames: the codec's smoothing is what keeps a
  // 256-colour, 12 fps, 1200 px GIF around 3 MB — the same clip from raw PNG
  // frames with error-diffusion dithering came out at 160 MB.
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1)
  let r = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=30,scale=${W}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', mp4], { encoding: 'utf8' })
  if (r.status !== 0) fail(`ffmpeg (mp4) failed: ${(r.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ')}`)
  console.log(`  ✓ ${path.relative(process.cwd(), mp4)}  (${mb(mp4)} MB, ${W}px, 30 fps)`)
  const dither = A.dither || 'bayer:bayer_scale=5' // 'none' is crisper on flat UI, bayer is safer on gradients; both stay small
  r = spawnSync('ffmpeg', ['-y', '-i', mp4, '-vf', `fps=${FPS},scale=${GIF_W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`, '-loop', '0', gif], { encoding: 'utf8' })
  if (r.status !== 0) fail(`ffmpeg (gif) failed: ${(r.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ')}`)
  console.log(`  ✓ ${path.relative(process.cwd(), gif)}  (${mb(gif)} MB, ${GIF_W}px, ${FPS} fps, dither ${dither})`)
  if (A['no-mp4']) fs.rmSync(mp4, { force: true })
  if (!A['keep-frames']) fs.rmSync(framesDir, { recursive: true, force: true })
  else console.log(`  frames kept in ${framesDir}`)
}

main().catch((e) => {
  console.error(`record: ${e.stack || e.message}`)
  process.exit(1)
})
