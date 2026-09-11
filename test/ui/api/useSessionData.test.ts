// @vitest-environment jsdom
import React from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test, expect, vi, afterEach } from 'vitest'
import { createQueryClient } from '../../../src/api/queries.ts'
import { useSessionData } from '../../../src/api/useSessionData.ts'

let cache: QueryClient
function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: cache }, children)
}
afterEach(() => {
  cleanup()
  cache?.clear()
  vi.unstubAllGlobals()
})

function transport() {
  return vi.fn(async (address) => {
    const url = new URL(String(address), 'http://fixture.invalid'),
      route = url.pathname.split('/').at(-1)
    const id = url.searchParams.get('id'),
      root = url.searchParams.get('root')
    const values: Record<string, unknown> = {
      session: { root, slug: `project-${root}`, summary: { id, title: `${root}/${id}` }, timeline: [] },
      sessions: { sessions: [{ id: 'one', title: 'list title', childCount: 2 }] },
      projects: { projects: [] },
      usage: {},
      terminals: { terminals: [] },
      'active-sessions': { tmux: [] },
      raw: { records: [] },
      subagents: { runs: [] },
      stats: {},
    }
    return new Response(JSON.stringify(values[route || '']), { headers: { 'Content-Type': 'application/json' } })
  })
}

test('useSessionData discovers an ID-addressed project without refetching its transcript or losing list metadata', async () => {
  cache = createQueryClient()
  const send = transport()
  vi.stubGlobal('fetch', send)
  const options: Parameters<typeof useSessionData>[0] = { provider: 'codex', root: 'a', id: 'one', view: 'conversation', liveProvider: 'claude' }
  const hook = renderHook((props) => useSessionData(props), { wrapper: Wrapper, initialProps: options })
  await waitFor(() => expect(hook.result.current.sessions.isSuccess).toBe(true))
  expect(hook.result.current.ref.slug).toBe('project-a')
  expect(hook.result.current.selected).toMatchObject({ id: 'one', title: 'a/one', childCount: 2 })
  const calls = (route: string) => send.mock.calls.filter(([url]) => new URL(String(url), 'http://fixture.invalid').pathname.endsWith(`/${route}`))
  expect(calls('session')).toHaveLength(1)
  expect(calls('raw')).toHaveLength(0)
  expect(calls('stats')).toHaveLength(0)
  expect(calls('subagents')).toHaveLength(0)
  expect(calls('active-sessions')[0][0]).toBe('/api/claude/active-sessions')
  hook.rerender({ ...options, slug: 'project-a', view: 'raw' })
  await waitFor(() => expect(hook.result.current.raw.isSuccess).toBe(true))
  expect(calls('session')).toHaveLength(1)
  expect(calls('raw')).toHaveLength(1)
  hook.rerender({ ...options, root: 'b', id: 'two' })
  expect(hook.result.current.session.data).toBeUndefined()
  expect(hook.result.current.selected).toEqual({ id: 'two' })
  await waitFor(() => expect(hook.result.current.session.isSuccess).toBe(true))
  expect(hook.result.current.selected?.title).toBe('b/two')
  hook.rerender({ ...options, slug: 'project-a' })
  expect(hook.result.current.selected?.title).toBe('a/one')
  expect(calls('session')).toHaveLength(2)
})

test('useSessionData keeps hidden providers idle and gates nested agents and oversize transcripts', async () => {
  cache = createQueryClient()
  const send = transport()
  vi.stubGlobal('fetch', send)
  const options: Parameters<typeof useSessionData>[0] = {
    provider: 'claude',
    root: 'a',
    slug: 'project-a',
    id: 'one',
    nestedSubagents: true,
    active: false,
    view: 'subagents',
  }
  const hook = renderHook((props) => useSessionData(props), { wrapper: Wrapper, initialProps: options })
  expect(send).not.toHaveBeenCalled()
  hook.rerender({ ...options, active: true, oversized: true })
  await waitFor(() => expect(hook.result.current.sessions.isSuccess).toBe(true))
  const paths = () => send.mock.calls.map(([url]) => new URL(String(url), 'http://fixture.invalid').pathname)
  expect(paths()).not.toContain('/api/claude/session')
  expect(paths()).not.toContain('/api/claude/subagents')
  hook.rerender({ ...options, active: true })
  await waitFor(() => expect(hook.result.current.subagents.isSuccess).toBe(true))
  expect(paths()).toContain('/api/claude/session')
  expect(paths()).toContain('/api/claude/subagents')
})
