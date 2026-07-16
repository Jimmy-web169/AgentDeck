import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import { PROVIDERS } from './registry.js'
import { isAllowedOrigin } from './shared/origin.js'
import { stopAllTerminals } from './shared/terminal.js'
import { registerWatchControl, restartWatchers } from './shared/watchGate.js'


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.AGENTDECK_PORT || 47841)
const DEV_UI_PORT = Number(process.env.AGENTDECK_WEB_PORT || 47842)

// Route shape: /api/<provider>/<rest>  →  PROVIDERS[provider].dispatch('GET','/api/<rest>',…)
const API_RE = /^\/api\/([a-z0-9-]+)\/(.+)$/

// ---- SSE ----
const clients = new Set()
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const c of clients) {
    try {
      c.res.write(payload)
    } catch {}
  }
}

// ---- file watching (per provider, per root) ----
let watchers = []
const pending = new Map()
let flushTimer = null
function queue(event) {
  pending.set(`${event.provider}:${event.root}:${event.id || ''}`, event)
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      const batch = [...pending.values()]
      pending.clear()
      broadcast({ type: 'change', changes: batch, at: Date.now() })
    }, 250)
  }
}
// Closing is async (chokidar returns a promise); await it wherever the old
// generation's handles must actually be released — on Windows a still-open
// directory handle blocks deleting that directory.
async function stopWatchers() {
  const closing = watchers.map((w) => Promise.resolve(w.close()).catch(() => {}))
  watchers = []
  await Promise.all(closing)
}

async function startWatchers() {
  // re-arm: fully release the old generation's handles first, or two watcher
  // generations coexist and the old one keeps directories locked on Windows
  await stopWatchers()
  for (const p of Object.values(PROVIDERS)) {
    if (!p.watch) continue
    for (const root of p.loadRoots()) {
      const dir = p.watch.watchDir(root.dir)
      if (!fs.existsSync(dir)) continue
      try {
        const w = chokidar.watch(dir, { ignoreInitial: true, persistent: true, ignorePermissionErrors: true })
        const onEvt = (absPath) => {
          const ev = p.watch.toEvent(root.id, root.dir, absPath)
          if (ev) queue(ev)
        }
        w.on('add', onEvt).on('change', onEvt).on('unlink', onEvt)
        watchers.push(w)
        console.log(`[watch] ${p.id}:${root.label} -> ${dir}`)
      } catch (e) {
        console.warn(`[watch] failed for ${dir}: ${e.message}`)
      }
    }
  }
}

// After a pause window (session delete) clients may have missed fs events —
// nudge them with one synthetic change per watched root so lists refetch.
function broadcastRefresh() {
  const changes = []
  for (const p of Object.values(PROVIDERS)) {
    if (!p.watch) continue
    for (const root of p.loadRoots()) changes.push({ provider: p.id, root: root.id, slug: null, id: null })
  }
  broadcast({ type: 'change', changes, at: Date.now() })
}

// Register at module init — a delete arriving before the listen callback must
// still find the stop/start pair, or the gate silently skips pausing.
registerWatchControl(stopWatchers, startWatchers, broadcastRefresh)

// ---- static ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) {
    res.statusCode = 404
    res.end(`In dev, open the Vite server at http://localhost:${DEV_UI_PORT}`)
    return
  }
  let file = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(DIST)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  try {
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
    res.end(fs.readFileSync(file))
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 5_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (!isAllowedOrigin(origin, req.headers.host)) {
    res.statusCode = 403
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'forbidden origin' }))
    return
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`retry: 3000\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`)
    const client = { res }
    clients.add(client)
    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`)
      } catch {}
    }, 25000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(client)
    })
    return
  }

  const m = url.pathname.match(API_RE)
  if (m) {
    const provider = PROVIDERS[m[1]]
    if (!provider) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: `unknown provider: ${m[1]}` }))
      return
    }
    const apiPath = `/api/${m[2]}`
    const body = req.method === 'POST' || req.method === 'DELETE' ? await readBody(req) : null
    const { status, body: out } = await provider.dispatch(req.method, apiPath, url.searchParams, body)
    // tracked-folder changes -> re-arm watchers so live updates cover new roots
    // (via the gate: deferred if a delete currently holds the watchers paused)
    if (apiPath === '/api/roots' && req.method !== 'GET' && status < 400) await restartWatchers()
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(out))
    return
  }

  serveStatic(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AgentDeck API  →  http://localhost:${PORT}  (127.0.0.1 only)`)
  console.log(`  providers: ${Object.keys(PROVIDERS).join(', ')}`)
  console.log(`  dev UI: http://localhost:${DEV_UI_PORT}\n`)
  void startWatchers()
})

// Route /chat/<provider> WebSocket upgrades to each provider's noServer wss, so
// multiple chat engines coexist on one server. Origin is checked here.
server.on('upgrade', (req, socket, head) => {
  if (!isAllowedOrigin(req.headers.origin, req.headers.host)) return socket.destroy()
  const u = new URL(req.url, 'http://localhost')
  const m = u.pathname.match(/^\/chat\/([a-z0-9-]+)$/)
  const p = m && PROVIDERS[m[1]]
  if (!p?.chatWss) return socket.destroy()
  p.chatWss.handleUpgrade(req, socket, head, (ws) => p.chatWss.emit('connection', ws, req))
})

process.on('exit', () => stopAllTerminals())
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopAllTerminals()
    process.exit(0)
  })
}
