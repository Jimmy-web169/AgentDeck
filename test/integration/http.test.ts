import type { ChangeEvent } from '../../shared/types.d.ts'
class FakeWatcher extends EventEmitter {
  close: () => Promise<void> = async () => {}
}
function portOf(server: http.Server) {
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return address.port
}
function present<T>(value: T): NonNullable<T> {
  assert.ok(value != null)
  return value
}
// Inject transport-only events to exercise write failure isolation.
function transportEvent(type: string) {
  return { type } as Parameters<ReturnType<typeof createServer>['broadcast']>[0]
}
// HTTP integration owns protocol and host lifecycle assertions. Provider data
// parsing remains in module/spec tests; all roots here are synthetic.
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createServer, type HostOptions, type HttpProvider } from '../../server/http.ts'
import { withWatchersPaused } from '../../server/shared/watchGate.ts'
import { assertContract, specFixture } from '../helpers/fixture.ts'
import { temporaryDirectory, withConfigDir } from '../helpers/tmpConfigDir.ts'
import { SSE_PING_MS } from '../../shared/constants.ts'

const waitFor = async (predicate: () => unknown) => {
  const end = Date.now() + 2500
  while (!predicate()) {
    assert.ok(Date.now() < end, 'condition did not settle before deadline')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function fixture(options: Partial<HostOptions> = {}) {
  const log: string[] = []
  const handles: FakeWatcher[] = []
  const root = { id: 'fixture', label: 'Synthetic root', dir: path.resolve('tmp/http-fixture') }
  const provider: HttpProvider = {
    id: 'fixture',
    loadRoots: () => [root],
    watch: {
      watchDir: (dir) => dir,
      toEvent: (id, _dir, file) => ({ provider: 'fixture', root: id, id: file }),
    },
    dispatch: async () => ({ status: 200, body: { sessions: [] } }),
  }
  const watch = () => {
    const handle = new FakeWatcher()
    const id = handles.length
    log.push(`open:${id}`)
    handle.close = async () => {
      log.push(`close:${id}`)
    }
    handles.push(handle)
    return handle
  }
  const host = createServer({
    providers: { fixture: provider },
    deck: { dispatch: async () => ({ status: 200, body: { folders: [] } }), invalidate: () => {} },
    watch,
    exists: () => true,
    now: () => 123,
    log: {
      log() {},
      warn(message) {
        log.push(message)
      },
    },
    ...options,
  })
  return { host, provider, root, log, handles }
}

async function listen(t: test.TestContext, fx: ReturnType<typeof fixture>) {
  t.after(() => fx.host.close())
  fx.host.server.listen(0, '127.0.0.1')
  await once(fx.host.server, 'listening')
  await waitFor(() => fx.handles.length > 0)
  return `http://127.0.0.1:${portOf(fx.host.server)}`
}

async function oversizedUpload(t: test.TestContext, base: string) {
  // Own this connection until close: an early 413 can leave Node's pooled fetch
  // upload active after its response body has been consumed and the host closes.
  const body = 'x'.repeat(5_000_001)
  const request = http.request(`${base}/api/fixture/resource`, { method: 'POST', agent: false, headers: { 'Content-Length': Buffer.byteLength(body) } })
  t.after(() => request.destroy())
  const completed = Promise.all([
    once(request, 'close'),
    new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      request.on('error', reject)
      request.on('response', (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.on('error', reject)
        response.on('end', () => resolve({ status: response.statusCode, body }))
      })
    }),
  ])
  request.end(body)
  const [, response] = await completed
  assert.equal(request.closed, true)
  return response
}

test('HTTP host construction has no listener or watcher side effects; close is idempotent', async () => {
  const fx = fixture()
  assert.equal(fx.host.server.listening, false)
  assert.deepEqual(fx.log, [])
  const closing = fx.host.close()
  assert.equal(fx.host.close(), closing)
  await closing
  assert.deepEqual(fx.log, [])
})

test('HTTP close cancels a listener whose address binding is still pending', async (t) => {
  const fx = fixture()
  t.after(() => fx.host.server.close())
  let listening = false
  fx.host.server.on('listening', () => {
    listening = true
  })
  fx.host.server.listen(0, '127.0.0.1')
  assert.equal(fx.host.server.listening, false)
  await fx.host.close()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(listening, false)
  assert.equal(fx.host.server.listening, false)
  assert.deepEqual(fx.log, [])
})

test('HTTP never dispatches an oversized upload and responds with 413', async (t) => {
  const fx = fixture()
  let dispatched = false
  fx.provider.dispatch = async () => {
    dispatched = true
    return { status: 200, body: {} }
  }
  const base = await listen(t, fx)
  const accepted = once(fx.host.server, 'request')
  const upload = oversizedUpload(t, base)
  await accepted
  const rejected = await upload
  assert.equal(rejected.status, 413)
  assert.deepEqual(JSON.parse(rejected.body), { error: 'request body too large' })
  assert.equal(dispatched, false)
  const followup = await fetch(`${base}/api/fixture/projects`)
  assert.equal(followup.status, 200)
  await followup.arrayBuffer()
})

test('HTTP watcher startup retries failed root discovery with backoff and cancels retries on close', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fx = fixture()
  t.after(() => fx.host.close())
  let attempts = 0
  fx.provider.loadRoots = () => {
    if (++attempts <= 2) throw new Error('temporary root discovery failure')
    return [fx.root]
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  fx.host.server.listen(0, '127.0.0.1')
  await once(fx.host.server, 'listening')
  await settle()
  assert.equal(attempts, 1)
  t.mock.timers.tick(999)
  await settle()
  assert.equal(attempts, 1)
  t.mock.timers.tick(1)
  await settle()
  assert.equal(attempts, 2)
  t.mock.timers.tick(1999)
  await settle()
  assert.equal(attempts, 2)
  t.mock.timers.tick(1)
  await settle()
  assert.equal(attempts, 3)
  assert.equal(fx.handles.length, 1)
  assert.equal(fx.log.filter((message) => message.includes('restart failed; retrying')).length, 2)
  await fx.host.close()
  t.mock.timers.tick(60000)
  await settle()
  assert.equal(attempts, 3)

  const failed = fixture()
  t.after(() => failed.host.close())
  let failures = 0
  failed.provider.loadRoots = () => {
    failures++
    throw new Error('still unavailable')
  }
  failed.host.server.listen(0, '127.0.0.1')
  await once(failed.host.server, 'listening')
  await settle()
  assert.equal(failures, 1)
  await failed.host.close()
  t.mock.timers.tick(60000)
  await settle()
  assert.equal(failures, 1, 'closing cancels an outstanding retry')
})

test('HTTP static files normalize injected roots and reject traversal into a sibling prefix', async (t) => {
  const dir = temporaryDirectory('http-static-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const dist = path.join(dir, 'dist')
  fs.mkdirSync(dist)
  fs.mkdirSync(path.join(dir, 'dist-neighbor'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<main>Fixture shell</main>')
  fs.writeFileSync(path.join(dist, 'app.js'), 'window.fixture = true')
  fs.writeFileSync(path.join(dir, 'dist-neighbor', 'secret.txt'), 'outside the static root')
  for (const injected of [dist, `${dist}${path.sep}`, path.relative(process.cwd(), dist)]) {
    const fx = fixture({ dist: injected })
    const base = await listen(t, fx)
    const asset = await fetch(`${base}/app.js`)
    assert.equal(asset.status, 200)
    assert.match(present(asset.headers.get('Content-Type')), /javascript/)
    assert.equal(await asset.text(), 'window.fixture = true')
    assert.equal(await (await fetch(`${base}/nested/spa-route`)).text(), '<main>Fixture shell</main>')
    const escaped = await fetch(`${base}/%2e%2e%2fdist-neighbor/secret.txt`)
    assert.equal(escaped.status, 403)
    assert.equal(await escaped.text(), 'forbidden')
    await fx.host.close()
  }
})

test('HTTP routes injected provider/deck requests and reports unknown providers', async (t) => {
  const fx = fixture()
  const base = await listen(t, fx)
  const response = await fetch(`${base}/api/fixture/sessions?root=fixture`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { sessions: [] })
  assert.deepEqual(await (await fetch(`${base}/api/deck/folders`)).json(), { folders: [] })
  const missing = await fetch(`${base}/api/missing/sessions`)
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), { error: 'unknown provider: missing' })
  fx.provider.dispatch = async () => {
    throw new Error('unexpected dispatcher failure')
  }
  const failed = await fetch(`${base}/api/fixture/sessions?root=fixture`)
  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: 'unexpected dispatcher failure' })
  assert.ok(fx.log.some((message) => message.includes('[http] GET /api/fixture/sessions?root=fixture: unexpected dispatcher failure')))
  assert.deepEqual(await (await fetch(`${base}/api/deck/folders`)).json(), { folders: [] })
})

test('HTTP ETag exact comparison returns 304 without mutating a cached handler result', async (t) => {
  const fx = fixture()
  const cached = { sessions: [{ id: 'one' }], _etag: 'version-1' }
  fx.provider.dispatch = async () => ({ status: 200, body: cached })
  const base = await listen(t, fx)
  const url = `${base}/api/fixture/sessions`
  const first = await fetch(url)
  assert.equal(first.headers.get('etag'), 'version-1')
  assert.deepEqual(await first.json(), { sessions: [{ id: 'one' }] })
  assert.equal(cached._etag, 'version-1')
  const matched = await fetch(url, { headers: { 'If-None-Match': 'version-1' } })
  assert.equal(matched.status, 304)
  assert.equal(await matched.text(), '')
  for (const validator of ['*', 'W/version-1', 'version-1, other']) {
    const unmatched = await fetch(url, { headers: { 'If-None-Match': validator } })
    assert.equal(unmatched.status, 200, validator)
    await unmatched.arrayBuffer()
  }
})

test('HTTP blocks cross-origin remote pages and preserves loopback preflight', async (t) => {
  const fx = fixture()
  const base = await listen(t, fx)
  const forbidden = await fetch(`${base}/api/fixture/sessions`, { headers: { Origin: 'https://evil.example' } })
  assert.equal(forbidden.status, 403)
  assert.deepEqual(await forbidden.json(), { error: 'forbidden origin' })
  const allowed = await fetch(`${base}/api/fixture/sessions`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:47852' } })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:47852')
  assert.equal(allowed.headers.get('vary'), 'Origin')
})

test('HTTP preserves array bodies carrying a private ETag', async (t) => {
  const fx = fixture()
  const cached = Object.assign([{ id: 'one' }], { _etag: 'array-1' })
  fx.provider.dispatch = async () => ({ status: 200, body: cached })
  const base = await listen(t, fx)
  const response = await fetch(`${base}/api/fixture/sessions`)
  assert.equal(response.headers.get('etag'), 'array-1')
  assert.deepEqual(await response.json(), [{ id: 'one' }])
  assert.equal(cached._etag, 'array-1')
})

test('HTTP SSE sends hello, batches latest changes per session, and closes clients', async (t) => {
  const fx = fixture()
  const base = await listen(t, fx)
  const response = await fetch(`${base}/events`)
  assert.match(present(response.headers.get('content-type')), /text\/event-stream/)
  const reader = present(response.body).getReader()
  const decoder = new TextDecoder()
  let received = decoder.decode((await reader.read()).value)
  assert.match(received, /retry: 3000/)
  assert.match(received, /"type":"hello","at":123/)
  fx.host.queueChange({ provider: 'fixture', root: 'fixture', id: 'one', version: 1 })
  fx.host.queueChange({ provider: 'fixture', root: 'fixture', id: 'one', version: 2 })
  fx.handles[0].emit('change', 'two')
  while (!received.includes('"type":"change"')) received += decoder.decode((await reader.read()).value)
  const event = received
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .find((entry) => entry.type === 'change')
  assert.deepEqual(event, {
    type: 'change',
    at: 123,
    changes: [
      { provider: 'fixture', root: 'fixture', id: 'one', version: 2 },
      { provider: 'fixture', root: 'fixture', id: 'two' },
    ],
  })
  await fx.host.close()
  assert.equal((await reader.read()).done, true)
  assert.deepEqual(fx.log, ['open:0', 'close:0'])
})

test('HTTP roots updates await old watcher handles before replacement; close cancels deferred probes', async (t) => {
  let probes = 0
  const fx = fixture({
    onRootsChanged: () => {
      probes++
    },
  })
  const base = await listen(t, fx)
  let releaseClose!: () => void
  fx.handles[0].close = async () => {
    fx.log.push('closing:0')
    await new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    fx.log.push('closed:0')
  }
  const update = fetch(`${base}/api/fixture/roots`, { method: 'POST', body: '{}' })
  await waitFor(() => releaseClose)
  assert.deepEqual(fx.log, ['open:0', 'closing:0'])
  t.mock.timers.enable({ apis: ['setTimeout'] })
  releaseClose()
  assert.equal((await update).status, 200)
  assert.deepEqual(fx.log, ['open:0', 'closing:0', 'closed:0', 'open:1'])
  await fx.host.close()
  t.mock.timers.tick(520)
  assert.equal(probes, 0)
  assert.equal(fx.log.at(-1), 'close:1')
})

test('HTTP request pause gates remain isolated across concurrent hosts', async (t) => {
  const a = fixture()
  const b = fixture()
  const baseA = await listen(t, a)
  const baseB = await listen(t, b)
  let release!: () => void
  a.provider.dispatch = async () => {
    await withWatchersPaused(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    return { status: 200, body: {} }
  }
  const paused = fetch(`${baseA}/api/fixture/delete`, { method: 'POST', body: '{}' })
  await waitFor(() => release)
  try {
    assert.deepEqual(a.log, ['open:0', 'close:0'])
    assert.deepEqual(b.log, ['open:0'])
    const updateB = await fetch(`${baseB}/api/fixture/roots`, { method: 'POST', body: '{}' })
    assert.equal(updateB.status, 200)
    assert.deepEqual(b.log, ['open:0', 'close:0', 'open:1'])
    assert.deepEqual(a.log, ['open:0', 'close:0'])
  } finally {
    release()
    await paused
  }
  assert.deepEqual(a.log, ['open:0', 'close:0', 'open:1'])
})

test('HTTP close releases incomplete uploads without dispatching a mutation', { timeout: 3000 }, async (t) => {
  const fx = fixture()
  let dispatched = false
  fx.provider.dispatch = async () => {
    dispatched = true
    return { status: 200, body: {} }
  }
  const base = await listen(t, fx)
  const request = http.request(`${base}/api/fixture/roots`, { method: 'POST', headers: { 'Content-Length': 100 } })
  request.on('error', () => {}) // connection reset is the expected shutdown result
  t.after(() => request.destroy())
  const accepted = once(fx.host.server, 'request')
  request.write('{')
  await accepted
  await fx.host.close()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(dispatched, false)
  assert.equal(fx.host.server.listening, false)
  assert.equal(fx.log.at(-1), 'close:0')
})

test('HTTP rejects a completed upload with 503 when its transport survives the shutdown race', { timeout: 3000 }, async (t) => {
  const fx = fixture()
  let request!: http.ClientRequest
  let dispatched = false
  const forceClose = fx.host.server.closeAllConnections.bind(fx.host.server)
  t.after(() => {
    request?.destroy()
    forceClose()
  })
  fx.provider.dispatch = async () => {
    dispatched = true
    return { status: 200, body: {} }
  }
  const base = await listen(t, fx)
  // Keep this one transport alive to exercise the post-body shutdown branch;
  // the preceding regression separately checks normal forced connection close.
  t.mock.method(fx.host.server, 'closeAllConnections', () => {})
  const accepted = once(fx.host.server, 'request')
  const completed = new Promise<http.IncomingMessage>((resolve, reject) => {
    request = http.request(`${base}/api/fixture/roots`, { method: 'POST' }, (response) => {
      response.resume()
      response.on('end', () => resolve(response))
      response.on('error', reject)
    })
    request.on('error', reject)
  })
  request.write('{')
  await accepted
  const closing = fx.host.close()
  request.end('}')
  const response = await completed
  assert.equal(response.statusCode, 503)
  assert.equal(response.headers.connection, 'close')
  await closing
  assert.equal(dispatched, false)
})

test('HTTP roots update restores monitoring after a memoized watcher close rejection', async (t) => {
  const fx = fixture()
  const base = await listen(t, fx)
  let attempts = 0
  let failedClose: Promise<never> | undefined
  fx.handles[0].close = () => {
    attempts++
    failedClose ||= Promise.reject(new Error('memoized close failure'))
    return failedClose
  }
  const response = await fetch(`${base}/api/fixture/roots`, { method: 'POST', body: '{}' })
  assert.equal(response.status, 200, 'the roots mutation already committed')
  assert.equal(fx.handles.length, 2, 'a rejected close must not disable every root indefinitely')
  assert.equal(attempts, 1)
  assert.ok(fx.log.some((message) => message.includes('memoized close failure')))
})

test('HTTP SSE isolates a disconnected client write failure from other clients', async (t) => {
  const fx = fixture()
  const base = await listen(t, fx)
  let brokenResponse!: http.ServerResponse
  let failedWrites = 0
  fx.host.server.on('request', (req, res) => {
    if (req.url?.includes('broken=1')) {
      brokenResponse = res
      res.write = () => {
        failedWrites++
        throw new Error('disconnected test client')
      }
    }
  })
  const broken = await fetch(`${base}/events?broken=1`)
  t.after(() =>
    present(broken.body)
      .cancel()
      .catch(() => {})
  )
  const response = await fetch(`${base}/events`)
  const reader = present(response.body).getReader()
  await reader.read()
  assert.doesNotThrow(() => fx.host.broadcast(transportEvent('test-event')))
  assert.match(new TextDecoder().decode((await reader.read()).value), /test-event/)
  assert.ok(fx.log.some((message) => message.includes('disconnected test client')))
  assert.equal(brokenResponse.destroyed, true)
  fx.host.broadcast(transportEvent('second-event'))
  assert.equal(failedWrites, 1, 'the disconnected response is removed before later broadcasts')
  assert.match(new TextDecoder().decode((await reader.read()).value), /second-event/)
  await fx.host.close()
})

test('HTTP delete retains best-effort behavior and live updates after a memoized close rejection', async (t) => {
  const changes: ChangeEvent[] = []
  const fx = fixture({ onChange: (batch) => changes.push(...batch) })
  const base = await listen(t, fx)
  let attempts = 0
  let deleted = false
  let failedClose: Promise<never> | undefined
  fx.handles[0].close = () => {
    attempts++
    failedClose ||= Promise.reject(new Error('memoized pause close failure'))
    return failedClose
  }
  fx.provider.dispatch = () =>
    withWatchersPaused(async () => {
      deleted = true
      return { status: 200, body: { ok: true } }
    })
  const response = await fetch(`${base}/api/fixture/session`, { method: 'DELETE' })
  assert.equal(response.status, 200)
  assert.equal(deleted, true, 'HEAD also attempts the filesystem operation after an async close rejection')
  assert.equal(fx.handles.length, 2)
  assert.equal(attempts, 1)
  fx.handles[0].emit('change', 'retired')
  fx.handles[1].emit('change', 'resumed')
  await waitFor(() => changes.some((change) => change.id === 'resumed'))
  assert.equal(
    changes.some((change) => change.id === 'retired'),
    false
  )
})

test('HTTP SSE ping failures remove disconnected clients while other pings continue', async (t) => {
  // Node 22.18 MockTimers requeues an interval cleared inside its own callback.
  // Drive the registered callbacks explicitly, retaining real cancellable handles.
  const intervals = new Map<ReturnType<typeof setInterval>, () => void>()
  t.after(() => {
    for (const timer of intervals.keys()) clearTimeout(timer)
  })
  t.mock.method(globalThis, 'setInterval', (callback: () => void, delay?: number) => {
    assert.equal(delay, SSE_PING_MS)
    const timer = setTimeout(() => {}, 2 ** 31 - 1).unref()
    intervals.set(timer, callback)
    return timer
  })
  t.mock.method(globalThis, 'clearInterval', (timer: Parameters<typeof clearInterval>[0]) => {
    if (timer && typeof timer === 'object') intervals.delete(timer)
    clearTimeout(timer)
  })
  const ping = () => {
    for (const [timer, callback] of [...intervals]) if (intervals.has(timer)) callback()
  }
  const fx = fixture()
  const base = await listen(t, fx)
  let brokenResponse!: http.ServerResponse
  let failedWrites = 0
  fx.host.server.on('request', (req, res) => {
    if (req.url?.includes('broken=1')) {
      brokenResponse = res
      res.write = () => {
        failedWrites++
        throw new Error('disconnected ping client')
      }
    }
  })
  const broken = await fetch(`${base}/events?broken=1`)
  t.after(() =>
    present(broken.body)
      .cancel()
      .catch(() => {})
  )
  const response = await fetch(`${base}/events`)
  const reader = present(response.body).getReader()
  await reader.read()
  assert.equal(intervals.size, 2)
  ping()
  assert.equal(brokenResponse.destroyed, true)
  assert.equal(intervals.size, 1)
  assert.match(new TextDecoder().decode((await reader.read()).value), /: ping/)
  ping()
  assert.equal(failedWrites, 1)
  assert.match(new TextDecoder().decode((await reader.read()).value), /: ping/)
  assert.ok(fx.log.some((message) => message.includes('disconnected ping client')))
  await fx.host.close()
  assert.equal(intervals.size, 0)
})

test('HTTP SSE cleans callback and response error failures exactly once', async (t) => {
  const fx = fixture()
  const base = await listen(t, fx)
  const responses: http.ServerResponse[] = []
  fx.host.server.on('request', (_req, res) => responses.push(res))
  const callbackClient = await fetch(`${base}/events`)
  const errorClient = await fetch(`${base}/events`)
  t.after(() =>
    Promise.all([
      present(callbackClient.body)
        .cancel()
        .catch(() => {}),
      present(errorClient.body)
        .cancel()
        .catch(() => {}),
    ])
  )
  let writes = 0
  responses[0].write = (
    _payload: unknown,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ) => {
    writes++
    queueMicrotask(() => (typeof encodingOrCallback === 'function' ? encodingOrCallback : callback)?.(new Error('async write failure')))
    return false
  }
  fx.host.broadcast(transportEvent('callback-test'))
  await waitFor(() => responses[0].destroyed)
  responses[0].emit('error', new Error('duplicate error signal'))
  responses[1].emit('error', new Error('response error signal'))
  assert.ok(responses[1].destroyed)
  fx.host.broadcast(transportEvent('after-error'))
  assert.equal(writes, 1)
  assert.equal(fx.log.filter((message) => message.includes('[sse]')).length, 2)
})

test('HTTP SSE releases a real canceled socket and continues healthy broadcasts and pings', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const fx = fixture()
  const base = await listen(t, fx)
  let canceledResponse!: http.ServerResponse
  let closed = false
  fx.host.server.on('request', (req, res) => {
    if (req.url?.includes('cancel=1')) {
      canceledResponse = res
      res.on('close', () => {
        closed = true
      })
    }
  })
  const canceled = await fetch(`${base}/events?cancel=1`)
  const healthy = await fetch(`${base}/events`)
  const reader = present(healthy.body).getReader()
  t.after(() => reader.cancel().catch(() => {}))
  await reader.read()
  await present(canceled.body).cancel()
  await waitFor(() => closed)
  assert.ok(canceledResponse.destroyed)
  // If the closed response were still in the client set, this write after
  // close would report ERR_STREAM_DESTROYED through the real Node callback.
  const warningsBefore = fx.log.filter((message) => message.includes('[sse]')).length
  fx.host.broadcast(transportEvent('surviving-client'))
  assert.match(new TextDecoder().decode((await reader.read()).value), /surviving-client/)
  t.mock.timers.tick(SSE_PING_MS)
  assert.match(new TextDecoder().decode((await reader.read()).value), /: ping/)
  assert.equal(fx.log.filter((message) => message.includes('[sse]')).length, warningsBefore)
})

test('HTTP serves real registered providers from spec fixtures and revalidates repeated session reads', async (t) => {
  const fx = specFixture(t)
  await withConfigDir(fx.dir, async () => {
    let host: ReturnType<typeof createServer> | undefined
    const warnings: unknown[] = []
    try {
      const { PROVIDERS } = await import('../../server/registry.ts')
      host = createServer({
        providers: PROVIDERS,
        watch: () => Object.assign(new EventEmitter(), { close: async () => {} }),
        log: {
          log() {},
          warn(message) {
            warnings.push(message)
          },
        },
      })
      host.server.listen(0, '127.0.0.1')
      await once(host.server, 'listening')
      const base = `http://127.0.0.1:${portOf(host.server)}`
      await Promise.all(
        Object.entries(fx.cases).map(async ([provider, entry]) => {
          const roots = await (await fetch(`${base}/api/${provider}/roots`)).json()
          assert.equal(roots.roots.length, 1)
          assert.equal(roots.roots[0].dir, path.join(fx.dir, provider))
          roots.roots.forEach((root: unknown) => {
            assertContract('Root', root)
          })
          const projects = await (await fetch(`${base}/api/${provider}/projects?root=${provider}`)).json()
          assert.ok(projects.projects.length > 0, provider)
          projects.projects.forEach((project: unknown) => {
            assertContract('Project', project)
          })
          const query = new URLSearchParams({ root: provider, slug: projects.projects[0].slug, id: entry.id })
          const sessions = await fetch(`${base}/api/${provider}/sessions?${query}`)
          assert.equal(sessions.status, 200, provider)
          const sessionList = (await sessions.json()).sessions
          assert.ok(
            sessionList.some((session: { id: string }) => session.id === entry.id),
            provider
          )
          sessionList.forEach((session: unknown) => {
            assertContract('SessionSummary', session)
          })
          const url = `${base}/api/${provider}/session?${query}`
          const first = await fetch(url)
          assert.equal(first.status, 200, provider)
          const body = await first.json()
          assertContract('SessionSummary', body.summary)
          body.timeline.forEach((event: unknown) => {
            assertContract('TimelineEvent', event)
          })
          assert.equal(body.summary.id, entry.id)
          assert.ok(body.timeline.length > 0)
          const etag = first.headers.get('etag')
          assert.ok(etag, provider)
          for (let i = 0; i < 2; i++) {
            const cached: Response = await fetch(url, { headers: { 'If-None-Match': etag } })
            assert.equal(cached.status, 304, `${provider}: repeated read ${i}`)
            assert.equal(await cached.text(), '')
          }
        })
      )
      assert.deepEqual(warnings, [])
    } finally {
      await host?.close()
    }
  })
})

test('HTTP rejects malformed JSON before dispatch, preserves split Unicode and answers oversized bodies', async (t) => {
  const fx = fixture()
  let calls = 0
  fx.provider.dispatch = async (_method, _path, _query, body) => {
    calls++
    return { status: 200, body }
  }
  const base = await listen(t, fx)
  const malformed = await fetch(base + '/api/fixture/resource', { method: 'POST', body: '{' })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: 'invalid JSON body' })
  assert.equal(calls, 0)
  const bytes = Buffer.from(JSON.stringify({ content: '繁體中文 🌱' }))
  const split = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/fixture/resource', { method: 'POST' }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    for (const byte of bytes) req.write(Buffer.from([byte]))
    req.end()
  })
  assert.deepEqual(split, { status: 200, body: { content: '繁體中文 🌱' } })
  assert.equal(calls, 1)
  const oversized = await oversizedUpload(t, base)
  assert.equal(oversized.status, 413)
  assert.deepEqual(JSON.parse(oversized.body), { error: 'request body too large' })
  assert.equal(calls, 1)
  const healthy = await fetch(base + '/api/fixture/resource', { method: 'POST', body: '{}' })
  assert.equal(healthy.status, 200)
  await healthy.arrayBuffer()
  assert.equal(calls, 2)
})

test('HTTP forks native Claude and Codex transcripts into immediately readable sessions without changing their source', async (t) => {
  const fx = specFixture(t)
  await withConfigDir(fx.dir, async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const host = createServer({ providers: PROVIDERS, watch: () => Object.assign(new EventEmitter(), { close: async () => {} }) })
    try {
      host.server.listen(0, '127.0.0.1')
      await once(host.server, 'listening')
      const base = `http://127.0.0.1:${portOf(host.server)}`
      for (const provider of ['claude', 'codex'] as const) {
        const entry = fx.cases[provider]
        const file = path.join(fx.dir, provider, entry.relative)
        const original = fs.readFileSync(file)
        const projects = await (await fetch(`${base}/api/${provider}/projects?root=${provider}`)).json()
        const ref = { root: provider, slug: projects.projects[0].slug, id: entry.id }
        const read = async (target: string | URLSearchParams | string[][] | Record<string, string> | undefined) =>
          (await fetch(`${base}/api/${provider}/session?${new URLSearchParams(target)}`)).json()
        const before = await read(ref)
        const users = before.timeline.filter((event: { kind: string }) => event.kind === 'user')
        assert.ok(users.length >= 2, `${provider} fixture has a cut point`)
        const post = (body: unknown) =>
          fetch(`${base}/api/${provider}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        for (const cut of [null, provider === 'claude' ? users[1].uuid : 2]) {
          const response = await post({ ...ref, cut })
          const fork = await response.json()
          assert.equal(response.status, 200, JSON.stringify(fork))
          assert.notEqual(fork.id, ref.id)
          const copied = await read({ ...ref, id: fork.id })
          assert.equal(copied.summary.id, fork.id)
          assert.equal(copied.timeline.filter((event: { kind: string }) => event.kind === 'user').length, cut === null ? users.length : 1)
          const list = await (await fetch(`${base}/api/${provider}/sessions?${new URLSearchParams(ref)}`)).json()
          assert.ok(list.sessions.some((session: { id: string }) => session.id === fork.id))
        }
        const filesBeforeReject = fs.readdirSync(path.dirname(file)).sort()
        for (const cut of [false, {}, -1, provider === 'claude' ? 2 : 'uuid', provider === 'claude' ? 'missing-uuid' : 100000]) {
          assert.equal((await post({ ...ref, cut })).status, 400, `${provider}: rejects ${JSON.stringify(cut)}`)
        }
        assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), filesBeforeReject)
        assert.deepEqual(fs.readFileSync(file), original)
        assert.deepEqual(await read(ref), before)
      }
    } finally {
      await host.close()
    }
  })
})

test('HTTP rejects malformed provider and Deck mutation inputs before filesystem or terminal work', async (t) => {
  const fx = specFixture(t)
  await withConfigDir(fx.dir, async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const host = createServer({ providers: PROVIDERS, watch: () => Object.assign(new EventEmitter(), { close: async () => {} }) })
    try {
      host.server.listen(0, '127.0.0.1')
      await once(host.server, 'listening')
      const base = `http://127.0.0.1:${portOf(host.server)}`
      for (const [route, body] of [
        ['claude/roots', { path: [] }],
        ['codex/roots/label', { id: {}, label: 'x' }],
        ['antigravity/probe/run', { root: [] }],
        ['claude/terminal', { root: 'claude', cwd: {} }],
        ['codex/open', { root: 'codex', what: 'editor', cwd: [] }],
        ['claude/resource', { root: 'claude', kind: 'agents', name: 'x', content: {} }],
        ['deck/dashboard/create', { keys: [7] }],
        ['deck/dashboard/attach', { id: [] }],
        ['deck/dashboard/control', { id: 'x' }],
        ['deck/handoff/export', []],
        ['deck/handoff/export', { source: { provider: 'claude', root: 'claude', id: 'x' }, task: {} }],
        ['deck/handoff/send', null],
        ['deck/handoff/send', { target: { provider: 'claude', root: 'claude' } }],
        ['deck/handoff/send', { id: {}, target: {} }],
      ]) {
        const response = await fetch(`${base}/api/${route}`, { method: 'POST', body: JSON.stringify(body) })
        assert.equal(response.status, 400, `${route}: ${await response.text()}`)
      }
    } finally {
      await host.close()
    }
  })
})
