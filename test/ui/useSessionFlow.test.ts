// @vitest-environment jsdom
import React from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createQueryClient } from '../../src/api/queries.ts'
import { useSessionFlow } from '../../src/lib/useSessionFlow.ts'
let cache: QueryClient, send: ReturnType<typeof vi.fn<typeof fetch>>
function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: cache }, children)
}
beforeEach(() => {
  cache = createQueryClient()
  send = vi.fn<typeof fetch>(async (address) => {
    const url = new URL(String(address), 'http://fixture.invalid'),
      route = url.pathname.split('/').at(-1)
    const root = url.searchParams.get('root'),
      id = url.searchParams.get('id')
    const values: Record<string, unknown> = {
      roots: {
        roots: [
          { id: 'a', label: 'A', dir: '/fixture/a' },
          { id: 'b', label: 'B', dir: '/fixture/b' },
        ],
        default: 'a',
      },
      projects: { projects: [] },
      sessions: {
        sessions: [
          { id: 'one', title: 'Listed', oversized: false },
          { id: 'large', title: 'Too large', oversized: true },
        ],
      },
      session: { root, slug: `project-${root}`, summary: { id, title: `${root}/${id}`, cwd: `/fixture/${root}` }, timeline: [] },
      usage: {},
      terminals: { terminals: [] },
      'active-sessions': { tmux: [] },
      raw: { records: [] },
    }
    return new Response(JSON.stringify(values[route || '']), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', send)
})
afterEach(() => {
  cleanup()
  cache.clear()
  vi.unstubAllGlobals()
})
const defaults = { provider: 'codex', addressing: 'id' as const, active: true, views: ['conversation', 'raw', 'config', 'memory'], liveProvider: 'claude' }

test('session flow discovers metadata once, isolates account changes, and reuses cached transcripts', async () => {
  const options: Parameters<typeof useSessionFlow>[0] = { ...defaults, pending: { root: 'a', id: 'one', seq: 1 }, onConsumed: vi.fn(), onNavigate: vi.fn() }
  const hook = renderHook((props) => useSessionFlow(props), { wrapper: Wrapper, initialProps: options })
  await waitFor(() => expect(hook.result.current.nav.selection.title).toBe('a/one'))
  expect(hook.result.current.nav.selection.slug).toBe('project-a')
  expect(hook.result.current.nav.selection).toMatchObject({ project: 'a', rootLabel: 'A' })
  expect(options.onNavigate).toHaveBeenLastCalledWith('codex', expect.objectContaining({ project: 'a', rootLabel: 'A' }))
  const transcripts = () => send.mock.calls.filter(([url]) => new URL(String(url), 'http://fixture.invalid').pathname.endsWith('/session'))
  expect(transcripts()).toHaveLength(1)
  hook.rerender({ ...options, pending: { root: 'b', id: 'one', seq: 2 } })
  expect(hook.result.current.data.session.data).toBeUndefined()
  await waitFor(() => expect(hook.result.current.nav.selection.title).toBe('b/one'))
  hook.rerender({ ...options, pending: { root: 'a', id: 'one', seq: 3 } })
  await waitFor(() => expect(hook.result.current.nav.selection.title).toBe('a/one'))
  expect(transcripts()).toHaveLength(2)
  expect(options.onConsumed).toHaveBeenCalledTimes(3)
})

test('session flow resolves Claude oversized list entries without requesting their transcript', async () => {
  const options: Parameters<typeof useSessionFlow>[0] = {
    ...defaults,
    provider: 'claude',
    addressing: 'slug+id' as const,
    pending: { root: 'a', slug: 'project-a', id: 'large', seq: 1 },
    onConsumed: vi.fn(),
  }
  const hook = renderHook((props) => useSessionFlow(props), { wrapper: Wrapper, initialProps: options })
  await waitFor(() => expect(options.onConsumed).toHaveBeenCalledTimes(1))
  expect(hook.result.current.oversized).toBe(true)
  expect(hook.result.current.data.selected).toMatchObject({ id: 'large', title: 'Too large' })
  expect(send.mock.calls.some(([url]) => new URL(String(url), 'http://fixture.invalid').pathname.endsWith('/session'))).toBe(false)
})

test('session flow leaves hidden providers idle and reports a new draft exactly once', () => {
  const options: Parameters<typeof useSessionFlow>[0] = {
    ...defaults,
    active: false,
    pending: { root: 'a', cwd: '/fixture/project', newConversation: true, launchId: 'launch-1', seq: 1 },
    onNavigate: vi.fn(),
    onConsumed: vi.fn(),
  }
  const hook = renderHook((props) => useSessionFlow(props), { wrapper: Wrapper, initialProps: options })
  expect(send).not.toHaveBeenCalled()
  hook.rerender({ ...options, active: true })
  expect(options.onNavigate).toHaveBeenCalledTimes(1)
  expect(options.onNavigate).toHaveBeenCalledWith('codex', expect.objectContaining({ launchId: 'launch-1', draft: true, view: 'conversation' }))
  hook.rerender({ ...options, active: true })
  expect(options.onNavigate).toHaveBeenCalledTimes(1)
})
