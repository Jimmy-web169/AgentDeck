import { required } from '../../helpers/assert.ts'
// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { createElement, StrictMode } from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../../src/api/queries.ts'
import { connectEvents, useEventStream } from '../../../src/api/sse.ts'
import { createLiveKeysStore, useLiveKeys } from '../../../src/store/liveKeys.ts'
import { queryKeys as qk } from '../../../src/api/queryPolicy.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
class Source {
  static instances: Source[] = []
  url: string
  closed: boolean
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  constructor(url: string) {
    this.url = url
    this.closed = false
    Source.instances.push(this)
  }
  close() {
    this.closed = true
  }
  send(message: unknown) {
    required(this.onmessage)({ data: JSON.stringify(message) })
  }
}

// Only the lifecycle callbacks are consumed; this double opens no network connection.
const EventSourceDouble = Source as unknown as typeof EventSource

test('SSE shares one connection and coalesces reconnect and changes, then cancels its pending work', async () => {
  vi.useFakeTimers()
  Source.instances = []
  const invalidateQueries = vi.fn(),
    client = { invalidateQueries }
  const live = createLiveKeysStore()
  const closeA = connectEvents(client, { EventSource: EventSourceDouble, live })
  const closeB = connectEvents(client, { EventSource: EventSourceDouble, live })
  const source = Source.instances[0]
  expect(Source.instances).toHaveLength(1)
  expect(source.url).toBe('/events')
  required(source.onopen)()
  source.send({ type: 'hello' })
  await vi.advanceTimersByTimeAsync(300)
  expect(invalidateQueries).toHaveBeenCalledTimes(1)
  expect(invalidateQueries.mock.calls[0][0].predicate({ queryKey: qk.roots('claude') })).toBe(true)
  invalidateQueries.mockClear()
  source.send({ type: 'change', changes: [{ provider: 'codex', root: 'a', slug: 's', id: 'one' }] })
  await vi.advanceTimersByTimeAsync(200)
  source.send({
    type: 'change',
    changes: [
      { provider: 'codex', root: 'a', slug: 's', id: 'one' },
      { provider: 'codex', root: 'b', slug: 't', id: 'two' },
    ],
  })
  expect(live.getSnapshot().ids.size).toBe(2)
  await vi.advanceTimersByTimeAsync(300)
  expect(invalidateQueries).toHaveBeenCalledTimes(1)
  const match = invalidateQueries.mock.calls[0][0].predicate
  expect(match({ queryKey: qk.session({ provider: 'codex', root: 'a', slug: 's', id: 'one' }) })).toBe(true)
  expect(match({ queryKey: qk.session({ provider: 'claude', root: 'a', slug: 's', id: 'one' }) })).toBe(false)
  closeA()
  closeA()
  expect(source.closed).toBe(false)
  source.send({ type: 'change', changes: [{ provider: 'codex', root: 'a', id: 'pending' }] })
  closeB()
  expect(source.closed).toBe(true)
  await vi.advanceTimersByTimeAsync(3000)
  expect(invalidateQueries).toHaveBeenCalledTimes(1)
  expect(live.getSnapshot().ids.size).toBe(0)
})

test('live ID and project indicators expire independently even when their encoded strings coincide', async () => {
  vi.useFakeTimers()
  const live = createLiveKeysStore()
  live.note([{ provider: 'claude', root: 'a', id: 'same', slug: 'same' }])
  await vi.advanceTimersByTimeAsync(4000)
  live.note([{ provider: 'claude', root: 'a', id: 'same' }])
  await vi.advanceTimersByTimeAsync(4000)
  expect(live.getSnapshot().slugs.size).toBe(0)
  expect(live.getSnapshot().ids.size).toBe(1)
  await vi.advanceTimersByTimeAsync(4000)
  expect(live.getSnapshot().ids.size).toBe(0)
  live.clear()
})

test('SSE continuous bursts cannot postpone invalidation beyond two seconds', async () => {
  vi.useFakeTimers()
  const invalidateQueries = vi.fn()
  const close = connectEvents({ invalidateQueries }, { EventSource: EventSourceDouble, live: createLiveKeysStore() })
  const source = required(Source.instances.at(-1))
  for (let i = 0; i < 10; i++) {
    source.send({ type: 'change', changes: [{ provider: 'codex', root: 'a', id: 'one', at: i }] })
    await vi.advanceTimersByTimeAsync(200)
  }
  expect(invalidateQueries).toHaveBeenCalledTimes(1)
  close()
})

test('malformed SSE payloads cannot poison keys or prevent subsequent valid changes', async () => {
  vi.useFakeTimers()
  const invalidateQueries = vi.fn(),
    warn = vi.fn(),
    live = createLiveKeysStore()
  const close = connectEvents({ invalidateQueries }, { EventSource: EventSourceDouble, live, log: { warn } })
  const source = required(Source.instances.at(-1))
  required(source.onmessage)({ data: '{broken' })
  source.send(null)
  source.send({
    type: 'change',
    changes: [null, {}, { provider: 9, root: 'a' }, { provider: 'codex', root: 'a', parentId: {} }, { provider: 'codex', root: 'a', id: 'valid' }],
  })
  await vi.advanceTimersByTimeAsync(299)
  expect(invalidateQueries).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(invalidateQueries).toHaveBeenCalledTimes(1)
  expect(warn).toHaveBeenCalledTimes(1)
  expect([...live.getSnapshot().ids]).toEqual(['codex|a|valid'])
  close()
})

test('shared SSE keeps connection status and last-change time per provider through reconnects', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const live = createLiveKeysStore()
  const close = connectEvents({ invalidateQueries: vi.fn() }, { EventSource: EventSourceDouble, live })
  const source = required(Source.instances.at(-1))
  expect(live.getSnapshot().connection).toBe('connecting')
  required(source.onopen)()
  expect(live.getSnapshot().connection).toBe('live')
  source.send({ type: 'change', changes: [{ provider: 'codex', root: 'a', id: 'one' }] })
  vi.setSystemTime(2000)
  source.send({ type: 'change', changes: [{ provider: 'claude', root: 'b', id: 'two' }] })
  expect(live.getSnapshot().lastEvents).toEqual({ codex: 1000, claude: 2000 })
  required(source.onerror)()
  expect(live.getSnapshot().connection).toBe('reconnecting')
  expect(live.getSnapshot().ids.size).toBe(2)
  source.send({ type: 'hello' })
  expect(live.getSnapshot().connection).toBe('live')
  expect(live.getSnapshot().lastEvents).toEqual({ codex: 1000, claude: 2000 })
  close()
  expect(source.onopen).toBeNull()
  expect(source.onmessage).toBeNull()
  expect(source.onerror).toBeNull()
  expect(live.getSnapshot()).toEqual({ ids: new Set(), slugs: new Set(), connection: 'connecting', lastEvents: {} })
})

function LiveProbe() {
  useEventStream()
  const live = useLiveKeys()
  return createElement('output', null, `${live.connection}:${live.ids.size}`)
}

test('React StrictMode and multiple consumers leave exactly one live EventSource and release it on unmount', async () => {
  vi.useFakeTimers()
  Source.instances = []
  vi.stubGlobal('EventSource', Source)
  const cache = createQueryClient()
  const tree = render(
    createElement(StrictMode, null, createElement(QueryClientProvider, { client: cache }, createElement(LiveProbe), createElement(LiveProbe)))
  )
  const liveSources = Source.instances.filter((source) => !source.closed)
  expect(liveSources).toHaveLength(1)
  const source = liveSources[0]
  await act(async () => {
    required(source.onopen)()
    source.send({ type: 'change', changes: [{ provider: 'codex', root: 'r', id: 'live' }] })
  })
  expect(screen.getAllByText('live:1')).toHaveLength(2)
  await act(async () => required(source.onerror)())
  expect(screen.getAllByText('reconnecting:1')).toHaveLength(2)
  tree.unmount()
  expect(Source.instances.every((source) => source.closed)).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  cache.clear()
})
