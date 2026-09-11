import { required } from '../../helpers/assert.ts'
import { createFetcher, type RequestOptions } from '../../../src/api/fetcher.ts'
// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { QueryObserver, MutationObserver, InfiniteQueryObserver, type QueryClient } from '@tanstack/react-query'
import {
  createQueryClient,
  providerQueryOptions,
  clientForQuery,
  deckQueryOptions,
  updateLiveTerminal,
  providerMutationOptions,
  homeInfiniteOptions,
  mergeHomePages,
  refreshHomePages,
} from '../../../src/api/queries.ts'
import { queryKeys } from '../../../src/api/queryPolicy.ts'
import { createElement } from 'react'
import { screen, waitFor, cleanup } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/query.ts'
import { QueryActivityContext, useSession, useHomePages } from '../../../src/api/index.ts'

const clients: QueryClient[] = []
const client = () => {
  const value = createQueryClient()
  clients.push(value)
  return value
}
afterEach(() => {
  cleanup()
  for (const value of clients.splice(0)) value.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function ActivityFixture() {
  const session = useSession({ provider: 'codex', root: 'r', id: 's' })
  const home = useHomePages('history', {})
  return createElement(
    'output',
    null,
    (session.data as { title?: string } | undefined)?.title || (home.data?.pages[0] as { title?: string } | undefined)?.title || 'empty'
  )
}
test('mounted provider and Deck views defer reads until their visibility context becomes active', async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ title: 'loaded', history: [] }), { headers: { 'Content-Type': 'application/json' } })
  )
  vi.stubGlobal('fetch', send)
  const view = (active: boolean) => createElement(QueryActivityContext.Provider, { value: active }, createElement(ActivityFixture))
  const { rerender, queryClient } = renderWithQuery(view(false))
  expect(send).not.toHaveBeenCalled()
  rerender(view(true))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  await screen.findByText('loaded')
  rerender(view(false))
  await queryClient.invalidateQueries()
  expect(send).toHaveBeenCalledTimes(2)
  expect(screen.getByText('loaded')).toBeTruthy()
  rerender(view(true))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(4))
})

test('inactive query observers keep cached data and fetch changes only when reactivated', async () => {
  vi.useFakeTimers()
  const cache = client(),
    queryFn = vi.fn(async () => ({ title: `version ${queryFn.mock.calls.length}` }))
  const options = { ...providerQueryOptions('session', { provider: 'codex', root: 'a', id: 'one' }), queryFn }
  const observer = new QueryObserver(cache, { ...options, enabled: false })
  const unsubscribe = observer.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(queryFn).not.toHaveBeenCalled()
  observer.setOptions(options)
  await vi.advanceTimersByTimeAsync(0)
  expect(required(observer.getCurrentResult().data).title).toBe('version 1')
  observer.setOptions({ ...options, enabled: false })
  await cache.invalidateQueries({ queryKey: options.queryKey })
  await vi.advanceTimersByTimeAsync(1000)
  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(required(observer.getCurrentResult().data).title).toBe('version 1')
  observer.setOptions(options)
  await vi.advanceTimersByTimeAsync(0)
  expect(queryFn).toHaveBeenCalledTimes(2)
  unsubscribe()
  const reused = new QueryObserver(cache, options)
  const close = reused.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(queryFn).toHaveBeenCalledTimes(2)
  close()
})

test('terminal recovery polls at four seconds and stops while its app is inactive', async () => {
  vi.useFakeTimers()
  const cache = client(),
    queryFn = vi.fn(async () => ({ terminals: [] }))
  const options = { ...providerQueryOptions('terminals', { provider: 'claude', root: '' }), queryFn }
  const observer = new QueryObserver(cache, options)
  const close = observer.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(3999)
  expect(queryFn).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(queryFn).toHaveBeenCalledTimes(2)
  observer.setOptions({ ...options, enabled: false })
  await vi.advanceTimersByTimeAsync(8000)
  expect(queryFn).toHaveBeenCalledTimes(2)
  expect(providerQueryOptions('session', { provider: 'claude', root: 'a', id: 'one' }).refetchInterval).toBe(15000)
  close()
})

test('request cancellation is bound to one provider and does not change another in-flight client', async () => {
  const first = new AbortController(),
    second = new AbortController()
  const sent: { url: string; signal: AbortSignal | undefined; params: RequestOptions['params'] }[] = []
  const transport = createFetcher({ fetch: async () => new Response('{}') })
  const send = async <T>(url: string, options: RequestOptions = {}): Promise<T> => {
    sent.push({ url, signal: options.signal, params: options.params })
    return transport<T>(url, options)
  }
  const claude = clientForQuery('claude', first.signal, send),
    codex = clientForQuery('codex', second.signal, send)
  await Promise.all([claude.session({ root: 'a', slug: 'project', id: 'one' }), codex.session({ root: 'a', id: 'one' })])
  const [a, b] = sent
  expect(a.url).toBe('/api/claude/session')
  expect(a.params).toEqual({ root: 'a', slug: 'project', id: 'one' })
  expect(b.url).toBe('/api/codex/session')
  expect(b.params).toEqual({ root: 'a', id: 'one' })
  first.abort()
  expect(required(a.signal).aborted).toBe(true)
  expect(required(b.signal).aborted).toBe(false)
})

test('canceling a query aborts its actual fetch and retains the previously rendered data', async () => {
  const cache = client()
  const options = providerQueryOptions('session', { provider: 'codex', root: 'a', id: 'cancel' })
  const previous = { timeline: [], title: 'previous' }
  cache.setQueryData(options.queryKey, previous)
  let signal!: AbortSignal
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((_url, options = {}) => {
      signal = required(options.signal)
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
  )
  const pending = cache.fetchQuery({ ...options, staleTime: 0 }).catch((error) => error)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(signal.aborted).toBe(false)
  await cache.cancelQueries({ queryKey: options.queryKey })
  await pending
  expect(signal.aborted).toBe(true)
  expect(cache.getQueryData(options.queryKey)).toBe(previous)
})

test('a stale global tmux poll cannot undo terminal-ready or terminal-ended identities', async () => {
  const cache = client(),
    key = ['provider', 'claude', 'active-sessions']
  const draft = { provider: 'codex', root: 'r', key: 'terminal-key', launchId: 'draft' }
  cache.setQueryData(key, { tmux: [draft], diagnostic: 'retained' })
  let resolveOld!: (value: unknown) => void
  const pending = cache
    .fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    })
    .catch((error) => error)
  await updateLiveTerminal(cache, { ...draft, id: 'persisted', requestedTarget: { id: 'private-transient' } })
  resolveOld({ tmux: [draft] })
  await pending
  expect(cache.getQueryData(key)).toEqual({ tmux: [{ ...draft, id: 'persisted' }], diagnostic: 'retained' })
  expect(required(cache.getQueryState(key)).isInvalidated).toBe(true)
  await updateLiveTerminal(cache, { key: draft.key }, { remove: true })
  expect(required(cache.getQueryData<{ tmux: unknown[] }>(key)).tmux).toEqual([])
})

test('incomplete session addresses never fetch, while ID-addressed sessions need no slug', async () => {
  const cache = client(),
    send = vi.fn(async () => ({ timeline: [] }))
  vi.stubGlobal('fetch', send)
  const observers = [
    providerQueryOptions('sessions', { provider: 'codex', root: 'a' }),
    providerQueryOptions('session', { provider: 'claude', root: 'a', id: 'one' }),
    providerQueryOptions('session', { provider: 'codex', root: 'a' }),
  ].map((options) => new QueryObserver<unknown>(cache, options))
  const close = observers.map((observer) => observer.subscribe(() => {}))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(send).not.toHaveBeenCalled()
  expect(providerQueryOptions('session', { provider: 'codex', root: 'a', id: 'one' }).enabled).toBe(true)
  expect(providerQueryOptions('session', { provider: 'claude', root: 'a', slug: 'repo', id: 'one' }).enabled).toBe(true)
  close.forEach((unsubscribe) => {
    unsubscribe()
  })
})

test('resource mutation invalidates its account and integrated reports only after success', async () => {
  const cache = client()
  const ref = { provider: 'codex', root: 'a', scope: 'user', kind: 'config', name: 'config.toml', content: 'model = "fixture"' }
  const affected = [queryKeys.resources(ref), queryKeys.home('resources', {}), queryKeys.folderCatalog()]
  const unaffected = [
    queryKeys.resources({ ...ref, root: 'b' }),
    queryKeys.resources({ ...ref, provider: 'claude' }),
    queryKeys.home('resources', { excluded: ['codex'] }),
  ]
  for (const key of [...affected, ...unaffected]) cache.setQueryData(key, { old: true })
  let fail = true
  const send = vi.fn<typeof fetch>(
    async (_url, _options) =>
      new Response(JSON.stringify(fail ? { error: 'fixture refused' } : { saved: true }), {
        status: fail ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', send)
  const onSuccess = vi.fn()
  const mutation = new MutationObserver(cache, providerMutationOptions(cache, 'codex', 'saveResource', { onSuccess }))
  await expect(mutation.mutate({ ref })).rejects.toThrow('fixture refused')
  for (const key of [...affected, ...unaffected]) expect(required(cache.getQueryState(key)).isInvalidated).toBe(false)
  expect(onSuccess).not.toHaveBeenCalled()
  fail = false
  await mutation.mutate({ ref })
  expect(send.mock.calls[1][0]).toBe('/api/codex/resource')
  expect(JSON.parse(String(required(send.mock.calls[1][1]).body))).toEqual({ root: 'a', kind: 'config', name: 'config.toml', content: 'model = "fixture"' })
  for (const key of affected) expect(required(cache.getQueryState(key)).isInvalidated).toBe(true)
  for (const key of unaffected) expect(required(cache.getQueryState(key)).isInvalidated).toBe(false)
  expect(onSuccess).toHaveBeenCalledTimes(1)
})

test('root mutations refresh provider inventory and Deck scopes only after a successful write', async () => {
  const cache = client()
  const affected = [
    queryKeys.roots('codex'),
    queryKeys.projects({ provider: 'codex', root: 'a' }),
    queryKeys.folderCatalog(),
    queryKeys.home('resources', { excluded: ['codex'] }),
  ]
  const unaffected = [queryKeys.roots('claude'), queryKeys.projects({ provider: 'claude', root: 'a' })]
  for (const key of [...affected, ...unaffected]) cache.setQueryData(key, { old: true })
  let fail = true
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(fail ? { error: 'root refused' } : { removed: true }), {
        status: fail ? 409 : 200,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', send)
  const mutation = new MutationObserver(cache, providerMutationOptions(cache, 'codex', 'removeRoot'))
  await expect(mutation.mutate({ ref: { id: 'a' } })).rejects.toThrow('root refused')
  for (const key of [...affected, ...unaffected]) expect(required(cache.getQueryState(key)).isInvalidated).toBe(false)
  fail = false
  await mutation.mutate({ ref: { id: 'a' } })
  expect(send.mock.calls[1][0]).toBe('/api/codex/roots?id=a')
  expect(required(send.mock.calls[1][1]).method).toBe('DELETE')
  for (const key of affected) expect(required(cache.getQueryState(key)).isInvalidated).toBe(true)
  for (const key of unaffected) expect(required(cache.getQueryState(key)).isInvalidated).toBe(false)
})

test('memory and resource writes keep their own root and exact provider-specific addresses', async () => {
  const cache = client(),
    ref = { provider: 'claude', root: 'a', slug: 'project' }
  const affected = queryKeys.memory(ref),
    unaffected = queryKeys.memory({ ...ref, root: 'b' })
  cache.setQueryData(affected, { old: true })
  cache.setQueryData(unaffected, { old: true })
  const send = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ saved: true }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', send)
  const save = new MutationObserver(cache, providerMutationOptions(cache, 'claude', 'saveMemory'))
  await save.mutate({ ref: { root: 'a', slug: 'project', name: 'MEMORY.md', content: 'synthetic' } })
  expect(send.mock.calls[0][0]).toBe('/api/claude/memory')
  expect(JSON.parse(String(required(send.mock.calls[0][1]).body))).toEqual({ root: 'a', slug: 'project', name: 'MEMORY.md', content: 'synthetic' })
  expect(required(cache.getQueryState(affected)).isInvalidated).toBe(true)
  expect(required(cache.getQueryState(unaffected)).isInvalidated).toBe(false)
  const remove = new MutationObserver(cache, providerMutationOptions(cache, 'codex', 'deleteResource'))
  await remove.mutate({ ref: { root: 'a', scope: 'project', slug: 'folder /one', kind: 'skill', name: 'a b' } })
  const url = new URL(String(send.mock.calls[1][0]), 'http://fixture.invalid')
  expect(url.pathname).toBe('/api/codex/resource')
  expect(Object.fromEntries(url.searchParams)).toEqual({ root: 'a', slug: 'folder /one', scope: 'project', kind: 'skill', name: 'a b' })
  expect(required(send.mock.calls[1][1]).method).toBe('DELETE')
})

test('deck queries keep no-store requests, exact filters and cancellation without a second transport cache', async () => {
  const signal = new AbortController().signal
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ sources: [], partial: true, errors: [{ message: 'fixture unavailable' }] }), {
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', send)
  const options = deckQueryOptions('home', { view: 'history', scope: { excluded: ['codex'] }, search: 'two words' })
  const result = await options.queryFn({ signal, client: client(), queryKey: options.queryKey, meta: undefined })
  const [url, init] = send.mock.calls[0]
  const parsed = new URL(String(url), 'http://fixture.invalid')
  expect(parsed.pathname).toBe('/api/deck/home')
  expect(parsed.searchParams.get('view')).toBe('history')
  expect(parsed.searchParams.get('excluded')).toBe('["codex"]')
  expect(parsed.searchParams.get('search')).toBe('two words')
  expect(required(init).signal).toBe(signal)
  expect(required(init).cache).toBe('no-store')
  expect(result.partial).toBe(true)
  expect(result.errors[0].message).toBe('fixture unavailable')
})

test('fork mutation carries its named cut and immutable provider address through the real transport', async () => {
  const cache = client()
  const send = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'forked' }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', send)
  const mutation = new MutationObserver(cache, providerMutationOptions(cache, 'claude', 'fork'))
  await mutation.mutate({ ref: { root: 'a', slug: 'repo', id: 'one' }, cut: 'turn-one' })
  expect(send.mock.calls[0][0]).toBe('/api/claude/fork')
  expect(JSON.parse(String(required(send.mock.calls[0][1]).body))).toEqual({ root: 'a', slug: 'repo', id: 'one', cut: 'turn-one' })
})

test('Home pagination preserves cursor bytes, filters, page order and partial errors without sharing a regular query cache', async () => {
  const cache = client(),
    cursor = 'opaque+/= cursor'
  const pages = [
    { history: [{ id: 'new' }], nextCursor: cursor, partial: false, errors: [] },
    { history: [{ id: 'older' }], nextCursor: null, partial: true, errors: [{ message: 'one provider unavailable' }] },
  ]
  const send = vi.fn<typeof fetch>(
    async (): Promise<Response> => new Response(JSON.stringify(pages[send.mock.calls.length - 1]), { headers: { 'Content-Type': 'application/json' } })
  )
  vi.stubGlobal('fetch', send)
  const scope = { excluded: ['codex'] },
    options = homeInfiniteOptions('history', scope, { search: 'two words' })
  const regularKey = queryKeys.home('history', scope, 'two words')
  cache.setQueryData(regularKey, { regular: true })
  const observer = new InfiniteQueryObserver(cache, options)
  await observer.refetch()
  expect(observer.getCurrentResult().hasNextPage).toBe(true)
  await observer.fetchNextPage()
  const result = observer.getCurrentResult()
  expect(result.hasNextPage).toBe(false)
  expect(mergeHomePages(required(result.data).pages)).toEqual({
    history: [{ id: 'new' }, { id: 'older' }],
    nextCursor: null,
    partial: true,
    errors: [{ message: 'one provider unavailable' }],
  })
  const urls = send.mock.calls.map(([url]) => new URL(String(url), 'http://fixture.invalid'))
  expect(urls[0].searchParams.has('cursor')).toBe(false)
  expect(urls[1].searchParams.get('cursor')).toBe(cursor)
  expect(urls[1].searchParams.get('excluded')).toBe('["codex"]')
  expect(urls[1].searchParams.get('search')).toBe('two words')
  expect(send.mock.calls.every(([, init]) => required(init).cache === 'no-store' && required(init).signal)).toBe(true)
  expect(cache.getQueryData(regularKey)).toEqual({ regular: true })
})

test('changing Home scope or search resets pagination and a canceled next page retains the loaded page', async () => {
  const cache = client()
  const options = homeInfiniteOptions('history', {}, { search: 'first' })
  let signal!: AbortSignal
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    if (send.mock.calls.length === 1)
      return new Response(JSON.stringify({ history: [{ id: 'loaded' }], nextCursor: 'next' }), { headers: { 'Content-Type': 'application/json' } })
    signal = required(required(init).signal)
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  })
  vi.stubGlobal('fetch', send)
  const observer = new InfiniteQueryObserver(cache, options)
  await observer.refetch()
  const previous = observer.getCurrentResult().data
  const pending = observer.fetchNextPage()
  await cache.cancelQueries({ queryKey: options.queryKey })
  await pending
  expect(signal.aborted).toBe(true)
  expect(cache.getQueryData(options.queryKey)).toBe(previous)
  observer.setOptions(homeInfiniteOptions('history', { excluded: ['codex'] }, { search: 'first', enabled: false }))
  expect(observer.getCurrentResult().data).toBeUndefined()
  observer.setOptions(homeInfiniteOptions('history', {}, { search: 'second', enabled: false }))
  expect(observer.getCurrentResult().data).toBeUndefined()
  expect(send).toHaveBeenCalledTimes(2)
})

test('manual Home refresh starts one fresh first page instead of replaying expired cursors', async () => {
  const cache = client(),
    scope = { excluded: ['codex'] },
    search = 'query'
  const options = homeInfiniteOptions('history', scope, { search })
  const old = {
    pages: [
      { history: [{ id: 'one' }], nextCursor: 'expired' },
      { history: [{ id: 'two' }], nextCursor: null },
    ],
    pageParams: [undefined, 'expired'],
  }
  cache.setQueryData(options.queryKey, old)
  const unrelated = queryKeys.homePages('history', {}, search)
  cache.setQueryData(unrelated, old)
  const send = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ history: [{ id: 'fresh' }], nextCursor: 'new-chain' }), { headers: { 'Content-Type': 'application/json' } })
  )
  vi.stubGlobal('fetch', send)
  await refreshHomePages(cache, 'history', scope, search)
  expect(send).toHaveBeenCalledTimes(1)
  const url = new URL(String(send.mock.calls[0][0]), 'http://fixture.invalid')
  expect(url.searchParams.get('fresh')).toBe('1')
  expect(url.searchParams.has('cursor')).toBe(false)
  expect(url.searchParams.get('search')).toBe(search)
  expect(cache.getQueryData(options.queryKey)).toEqual({ pages: [{ history: [{ id: 'fresh' }], nextCursor: 'new-chain' }], pageParams: [undefined] })
  expect(cache.getQueryData(unrelated)).toBe(old)
})
