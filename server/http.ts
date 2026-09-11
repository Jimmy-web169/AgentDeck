import { readJsonBody } from './shared/validate.ts'
import { changeBatchKey } from '../shared/identity.ts'
import { SSE_BATCH_MS, SSE_PING_MS } from '../shared/constants.ts'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { ChangeEvent } from '../shared/types.d.ts'
import type { makeDispatch } from './shared/dispatch.ts'
import { jsonRecord } from './shared/json.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedOrigin } from './shared/origin.ts'
import { createWatchers } from './shared/watchers.ts'
import { createWatchGate, runWithWatchGate } from './shared/watchGate.ts'
import { createDeckApi } from './deck/api.ts'

type Dispatch = ReturnType<typeof makeDispatch>
type Watchers = Parameters<typeof createWatchers>
export type HttpProvider = Watchers[0][string] & { dispatch: Dispatch }
interface DeckApi {
  dispatch: Dispatch
  invalidate(): void
}
export interface HostOptions {
  providers: Record<string, HttpProvider>
  dist?: string
  devUiPort?: number
  now?: () => number
  deck?: DeckApi
  watch?: NonNullable<Watchers[2]>['watch']
  exists?: NonNullable<Watchers[2]>['exists']
  log?: Pick<Console, 'log' | 'warn'>
  onChange?: (changes: ChangeEvent[]) => void
  onRootsChanged?: () => unknown
}
interface Client {
  res: ServerResponse
  ping: ReturnType<typeof setInterval> | null
}
type ServerEvent = { type: 'change'; changes: ChangeEvent[]; at: number } | { type: 'hello'; at: number }
const API_RE = /^\/api\/([a-z0-9-]+)\/(.+)$/

// Construction owns no listener or filesystem watchers. The listening event
// starts this host's watchers; close() releases only resources owned here.
export function createServer({
  providers,
  dist = fileURLToPath(new URL('../dist', import.meta.url)),
  devUiPort = 47842,
  now = Date.now,
  deck = createDeckApi(providers),
  watch,
  exists,
  log = console,
  onChange = () => {},
  onRootsChanged = () => {},
}: HostOptions) {
  // Normalize caller-supplied and default roots identically. Include the path
  // separator in containment checks so dist-neighbor is never inside dist.
  dist = path.resolve(dist)
  const clients = new Set<Client>()
  const pending = new Map<string, ChangeEvent>()
  const rootTimers = new Set<ReturnType<typeof setTimeout>>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 1000
  let closed = false
  let closing: Promise<void> | null = null
  function disconnectClient(client: Client, error?: unknown) {
    if (!clients.delete(client)) return
    clearInterval(client.ping ?? undefined)
    client.res.destroy()
    if (error) log.warn(`[sse] client disconnected: ${jsonRecord(error).message}`)
  }
  function writeClient(client: Client, payload: string) {
    try {
      client.res.write(payload, (error) => {
        if (error) disconnectClient(client, error)
      })
    } catch (error) {
      disconnectClient(client, error)
    }
  }
  function broadcast(event: ServerEvent) {
    if (closed) return
    if (event.type === 'change') {
      onChange(event.changes || [])
      deck.invalidate()
    }
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of clients) writeClient(client, payload)
  }
  function queueChange(event: ChangeEvent) {
    if (closed) return
    pending.set(changeBatchKey(event), event)
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        const changes = [...pending.values()]
        pending.clear()
        broadcast({ type: 'change', changes, at: now() })
      }, SSE_BATCH_MS)
    }
  }
  const watchers = createWatchers(providers, queueChange, { watch, exists, log })
  function broadcastRefresh() {
    const changes = Object.values(providers).flatMap((provider) =>
      provider.watch ? provider.loadRoots().map((root) => ({ provider: provider.id, root: root.id, slug: null, id: null })) : []
    )
    broadcast({ type: 'change', changes, at: now() })
  }
  const gate = createWatchGate(watchers.stop, startWatchers, broadcastRefresh, log)
  async function startWatchers() {
    try {
      await watchers.start()
      clearTimeout(retryTimer)
      retryTimer = undefined
      retryDelay = 1000
    } catch (error) {
      log.warn(`[watch] restart failed; retrying: ${jsonRecord(error).message}`)
      if (!closed && !retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          void rearmWatchers()
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30000)
        retryTimer.unref()
      }
    }
  }
  const rearmWatchers = () => gate.restart()
  function deferRootsChanged() {
    if (closed) return
    const timer = setTimeout(() => {
      rootTimers.delete(timer)
      Promise.resolve()
        .then(onRootsChanged)
        .catch((error) => log.warn(`[roots] refresh failed: ${jsonRecord(error).message}`))
    }, 500)
    rootTimers.add(timer)
  }

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }
  function serveStatic(req: IncomingMessage, res: ServerResponse) {
    if (!fs.existsSync(dist)) {
      res.statusCode = 404
      res.end(`In dev, open the Vite server at http://localhost:${devUiPort}`)
      return
    }
    let file = path.join(dist, decodeURIComponent(new URL(req.url || '/', 'http://x').pathname))
    if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
    try {
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
      res.end(fs.readFileSync(file))
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
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
    const url = new URL(req.url || '/', 'http://localhost')

    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      const client: Client = { res, ping: null }
      clients.add(client)
      res.on('error', (error) => disconnectClient(client, error))
      res.on('close', () => disconnectClient(client))
      req.on('close', () => disconnectClient(client))
      client.ping = setInterval(() => writeClient(client, `: ping\n\n`), SSE_PING_MS)
      writeClient(client, `retry: 3000\n\n`)
      if (clients.has(client)) writeClient(client, `data: ${JSON.stringify({ type: 'hello', at: now() })}\n\n`)
      return
    }

    const m = url.pathname.match(API_RE)
    if (m) {
      const provider = m[1] === 'deck' ? deck : providers[m[1]]
      if (!provider) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: `unknown provider: ${m[1]}` }))
        return
      }
      const apiPath = `/api/${m[2]}`
      const body = req.method === 'POST' || req.method === 'DELETE' ? await readJsonBody(req) : null
      if (res.destroyed) return
      if (closed) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' })
        res.end(JSON.stringify({ error: 'Server is shutting down' }))
        return
      }
      const result = await runWithWatchGate(gate, () => provider.dispatch(req.method || 'GET', apiPath, url.searchParams, body))
      const { status } = result
      let out = result.body
      // tracked-folder changes -> re-arm watchers so live updates cover new roots
      // (via the gate: deferred if a delete currently holds the watchers paused)
      if (apiPath === '/api/roots' && req.method !== 'GET' && status < 400) {
        deck.invalidate()
        await rearmWatchers()
        deferRootsChanged() // a newly tracked folder gets its baseline right away
      }
      // handlers may attach _etag (a content fingerprint) to a GET body: echo it
      // as an ETag and answer a matching If-None-Match with an empty 304, so
      // pollers pay nothing when nothing changed. The client sends no-store and
      // revalidates manually, so the browser's own HTTP cache stays out of it.
      if (req.method === 'GET' && status === 200 && out && typeof out === 'object' && '_etag' in out && typeof out._etag === 'string') {
        const etag = out._etag
        if (Array.isArray(out)) out = [...out]
        else {
          out = { ...out }
          delete (out as Record<string, unknown>)._etag
        }
        res.setHeader('ETag', etag)
        // Deliberately a private protocol between src/api.js and this server,
        // not full RFC 9110 semantics: exact string comparison only — no weak
        // (`W/`) validators, no comma-separated lists, no `*`. Our own client is
        // the only caller that sends If-None-Match; anything else just gets 200s.
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304
          res.end()
          return
        }
      }
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(out))
      return
    }

    serveStatic(req, res)
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.destroyed) return
      const status = error.status === 400 || error.status === 413 ? error.status : 500
      if (status === 500) log.warn(`[http] ${req.method} ${req.url}: ${jsonRecord(error).message}`)
      // Defensive fallback for future handlers that reject after sending headers.
      if (res.headersSent) res.destroy(error)
      else {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: error.message }))
      }
    })
  })
  server.once('listening', () => {
    rearmWatchers().catch((error) => log.warn(`[watch] startup failed: ${jsonRecord(error).message}`))
  })
  function close() {
    if (closing) return closing
    closed = true
    clearTimeout(flushTimer)
    clearTimeout(retryTimer)
    pending.clear()
    for (const timer of rootTimers) clearTimeout(timer)
    rootTimers.clear()
    for (const client of clients) {
      clearInterval(client.ping ?? undefined)
      client.res.end()
    }
    clients.clear()
    const stopHttp = new Promise<void>((resolve, reject) => {
      // close() also cancels a listen() whose asynchronous bind is still pending.
      server.close((error) => (error && jsonRecord(error).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()))
      // Shutdown must also release clients stalled halfway through a body.
      server.closeAllConnections()
    })
    closing = Promise.allSettled([stopHttp, watchers.close()]).then((results) => {
      const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
      if (failures.length) throw new AggregateError(failures, 'Failed to close HTTP host')
    })
    return closing
  }
  return { server, broadcast, queueChange, close }
}
