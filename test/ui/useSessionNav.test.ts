// @vitest-environment jsdom
import React from 'react'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createQueryClient } from '../../src/api/queries.ts'
import { queryKeys } from '../../src/api/queryPolicy.ts'
import { useSessionNav } from '../../src/lib/useSessionNav.ts'
let cache: QueryClient
function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: cache }, children)
}
const listKey = (root: string, slug: string) => queryKeys.sessions({ provider: 'claude', root, slug })
beforeEach(() => {
  cache = createQueryClient()
  for (const provider of ['claude', 'codex'])
    cache.setQueryData(queryKeys.roots(provider), {
      roots: [
        { id: 'a', label: 'A', dir: '/fixture/a' },
        { id: 'b', label: 'B', dir: '/fixture/b' },
      ],
      default: 'a',
    })
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
  )
})
afterEach(() => {
  cleanup()
  cache.clear()
  vi.unstubAllGlobals()
})
const base = () => ({
  provider: 'claude',
  addressing: 'slug+id' as const,
  active: true,
  views: ['conversation', 'raw', 'config', 'memory'],
  onConsumed: vi.fn(),
  onNavigate: vi.fn(),
})

test('navigation waits for the matching account/project list and consumes a pending open once', async () => {
  const options: Parameters<typeof useSessionNav>[0] = { ...base(), pending: { root: 'b', slug: 'project-b', id: 'one', view: 'raw', seq: 1 } }
  const hook = renderHook((props) => useSessionNav(props), { wrapper: Wrapper, initialProps: options })
  expect(hook.result.current.selection).toMatchObject({ root: 'b', slug: 'project-b', id: null })
  expect(options.onConsumed).not.toHaveBeenCalled()
  act(() => cache.setQueryData(listKey('a', 'project-b'), { sessions: [{ id: 'one' }] }))
  expect(options.onConsumed).not.toHaveBeenCalled()
  act(() => cache.setQueryData(listKey('b', 'project-b'), { sessions: [{ id: 'one', title: 'Correct account' }] }))
  await waitFor(() => expect(options.onConsumed).toHaveBeenCalledTimes(1))
  expect(hook.result.current.selection).toMatchObject({ root: 'b', id: 'one', view: 'raw', title: 'Correct account' })
  expect(options.onConsumed).toHaveBeenCalledTimes(1)
  act(() => cache.setQueryData(listKey('b', 'project-b'), { sessions: [{ id: 'one', title: 'Updated list' }] }))
  await waitFor(() => expect(hook.result.current.sessions.data?.sessions[0].title).toBe('Updated list'))
  expect(options.onConsumed).toHaveBeenCalledTimes(1)
})

test('a missing Claude session reports an error, while a validated terminal binding may precede its list', () => {
  cache.setQueryData(listKey('a', 'project-a'), { sessions: [] })
  const options: Parameters<typeof useSessionNav>[0] = { ...base(), pending: { root: 'a', slug: 'project-a', id: 'gone', seq: 1 } }
  const hook = renderHook((props) => useSessionNav(props), { wrapper: Wrapper, initialProps: options })
  expect(hook.result.current.error).toContain('is no longer in this project')
  expect(hook.result.current.selection.id).toBeNull()
  hook.rerender({ ...options, pending: { ...options.pending, id: 'bound', terminalKey: 'validated-key', seq: 2 } })
  expect(hook.result.current.error).toBeNull()
  expect(hook.result.current.selection.id).toBe('bound')
})

test('hidden ID providers wait, then open without a list and preserve draft launch identity', () => {
  const options: Parameters<typeof useSessionNav>[0] = {
    ...base(),
    provider: 'codex',
    addressing: 'id' as const,
    active: false,
    pending: { root: 'a', id: 'one', view: 'raw', seq: 1 },
  }
  const hook = renderHook((props) => useSessionNav(props), { wrapper: Wrapper, initialProps: options })
  expect(options.onConsumed).not.toHaveBeenCalled()
  hook.rerender({ ...options, active: true })
  expect(hook.result.current.selection).toMatchObject({ root: 'a', id: 'one', view: 'raw' })
  const draft = { root: 'a', cwd: '/fixture/project', draft: true, launchId: 'launch-1', terminalKey: 'term-1', seq: 2 }
  hook.rerender({ ...options, active: true, pending: draft })
  expect(hook.result.current.selection).toMatchObject({ ...draft, id: null, view: 'conversation' })
  act(() => hook.result.current.changeView('config'))
  expect(options.onNavigate).toHaveBeenLastCalledWith('codex', expect.objectContaining({ launchId: 'launch-1', view: 'config' }))
})
