import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createFetcher } from '../../../src/api/fetcher.ts'

test('conditional GET retains exact opaque ETags, response identity and account isolation', async () => {
  const calls: (RequestInit & { url: RequestInfo | URL })[] = []
  const request = createFetcher({
    fetch: async (url, options) => {
      calls.push({ url, ...options })
      return new Headers(options?.headers).get('If-None-Match')
        ? new Response(null, { status: 304 })
        : new Response('{"timeline":[]}', { headers: { ETag: 'W/"private:one"' } })
    },
  })
  const params = { root: '工作|two', slug: undefined, id: 'a/b' }
  const first = await request('/api/claude/session', { params })
  assert.equal(await request('/api/claude/session', { params }), first)
  assert.equal(calls[0].url, '/api/claude/session?root=%E5%B7%A5%E4%BD%9C%7Ctwo&slug=undefined&id=a%2Fb')
  assert.equal(new Headers(calls[1].headers).get('If-None-Match') ?? undefined, 'W/"private:one"')
  assert.equal(calls[1].cache, 'no-store')
  await request('/api/codex/session', { params })
  await request('/api/claude/session', { params: { ...params, root: 'other' } })
  assert.equal(new Headers(calls[2].headers).get('If-None-Match') ?? undefined, undefined)
  assert.equal(new Headers(calls[3].headers).get('If-None-Match') ?? undefined, undefined)
})

test('304 hits refresh LRU recency and capacity evicts only the oldest URL', async () => {
  const calls: (RequestInit & { url: RequestInfo | URL })[] = []
  const request = createFetcher({
    capacity: 2,
    fetch: async (url, options) => {
      calls.push({ url, ...options })
      return new Headers(options?.headers).get('If-None-Match') ? new Response(null, { status: 304 }) : new Response('{}', { headers: { ETag: '"version"' } })
    },
  })
  await request('/a')
  await request('/b')
  await request('/a')
  await request('/c')
  await request('/a')
  await request('/b')
  assert.equal(new Headers(calls[4].headers).get('If-None-Match') ?? undefined, '"version"')
  assert.equal(new Headers(calls[5].headers).get('If-None-Match') ?? undefined, undefined)
})

test('unconditional reads neither send nor retain private ETags', async () => {
  const calls: (RequestInit & { url: RequestInfo | URL })[] = []
  const request = createFetcher({
    fetch: async (url, options) => {
      calls.push({ url, ...options })
      return new Response('{"dashboards":[]}', { headers: { ETag: '"future-tag"' } })
    },
  })
  const first = await request('/api/deck/dashboards', { revalidate: false })
  const second = await request('/api/deck/dashboards', { revalidate: false })
  assert.notEqual(first, second)
  await request('/api/deck/dashboards')
  assert.ok(calls.every((call) => (new Headers(call.headers).get('If-None-Match') ?? undefined) === undefined))
})

test('request errors retain HTTP status and JSON or text details', async () => {
  const json = createFetcher({ fetch: async () => new Response('{"error":"Unavailable root"}', { status: 404 }) })
  const text = createFetcher({ fetch: async () => new Response('Forbidden', { status: 403 }) })
  const empty = createFetcher({ fetch: async () => new Response('', { status: 500 }) })
  await assert.rejects(json('/api/projects'), { message: 'Unavailable root', status: 404 })
  await assert.rejects(text('/api/projects'), { message: 'Forbidden', status: 403 })
  await assert.rejects(empty('/api/projects'), { message: 'HTTP 500', status: 500 })
})

test('mutations serialize defined JSON bodies, retain cache policy and forward cancellation', async () => {
  const calls: (RequestInit & { url: RequestInfo | URL })[] = []
  const request = createFetcher({
    fetch: async (url, options) => {
      calls.push({ url, ...options })
      return new Response('{}')
    },
  })
  const controller = new AbortController()
  for (const body of [null, false, 0, { id: 'd', text: 'line\n2' }])
    await request('/api/deck/action', { method: 'POST', cache: 'no-store', body, signal: controller.signal })
  assert.deepEqual(
    calls.map((c) => c.body),
    ['null', 'false', '0', '{"id":"d","text":"line\\n2"}']
  )
  for (const call of calls) {
    assert.equal(new Headers(call.headers).get('Content-Type') ?? undefined, 'application/json')
    assert.equal(new Headers(call.headers).get('If-None-Match') ?? undefined, undefined)
    assert.equal(call.cache, 'no-store')
    assert.equal(call.signal, controller.signal)
  }
  const error = new DOMException('Cancelled', 'AbortError')
  await assert.rejects(
    createFetcher({
      fetch: async () => {
        throw error
      },
    })('/api/session'),
    (value) => value === error
  )
})
