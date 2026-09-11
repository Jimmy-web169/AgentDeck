import { required } from '../../helpers/assert.ts'
// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { createElement, useState } from 'react'
import { render, renderHook, act, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient, useSessions } from '../../../src/api/queries.ts'
import useNavIndex from '../../../src/api/useNavIndex.ts'
import { queryKeys } from '../../../shared/identity.ts'
const providers = [{ id: 'codex', label: 'Codex' }]
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.unstubAllGlobals()
})
function setup(body: import('react').ReactNode) {
  const client = createQueryClient()
  clients.push(client)
  client.setDefaultOptions({ queries: { retry: false, staleTime: 5000 } })
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(url, 'http://fixture').pathname
      calls.push(path)
      const data = path.endsWith('/roots')
        ? { roots: [{ id: 'a', label: 'Fixture', dir: '/fixture', exists: true }] }
        : path.endsWith('/projects')
          ? { projects: [{ slug: 's', cwd: '/fixture/project', sessionCount: 2, lastActivity: 9 }] }
          : path.endsWith('/sessions')
            ? {
                sessions: [
                  { id: 'one', title: 'Shared session', lastUserPrompt: 'Latest prompt' },
                  { id: 'child', title: 'Child', isSubagent: true },
                ],
              }
            : null
      if (!data) throw new Error(`Unexpected route ${url}`)
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    })
  )
  render(createElement(QueryClientProvider, { client }, body))
  return { client, calls }
}
function ExpandedRow({ index }: { index: ReturnType<typeof useNavIndex> }) {
  const [expanded, setExpanded] = useState(false)
  const list = expanded ? index.sessionsFor('codex', 'a', 's') : null
  return createElement(
    'section',
    null,
    createElement('button', { type: 'button', onClick: () => setExpanded(true) }, 'Expand'),
    expanded ? createElement('output', null, list ? list.map((row) => row.title).join(',') : 'Loading') : null
  )
}
function NavProbe() {
  const index = useNavIndex(providers)
  return createElement('main', null, createElement('p', null, index.projects.map((project) => project.name).join(',')), createElement(ExpandedRow, { index }))
}
function SessionProbe() {
  const query = useSessions({ provider: 'codex', root: 'a', slug: 's' })
  return createElement('aside', null, query.data?.sessions[0]?.lastUserPrompt || 'Waiting')
}
test('child-only expansion lazily observes Query sessions and excludes nested agents from the index', async () => {
  const { calls } = setup(createElement(NavProbe))
  await screen.findByText('project')
  expect(calls.filter((path) => path.endsWith('/sessions'))).toHaveLength(0)
  fireEvent.click(screen.getByText('Expand'))
  await screen.findByText('Shared session')
  expect(screen.queryByText('Child')).toBeNull()
  expect(calls.filter((path) => path.endsWith('/sessions'))).toHaveLength(1)
})
test('navigation and session observers reuse one session request and both react to invalidation', async () => {
  const { client, calls } = setup(createElement('div', null, createElement(NavProbe), createElement(SessionProbe)))
  await screen.findByText('Latest prompt')
  fireEvent.click(screen.getByText('Expand'))
  await screen.findByText('Shared session')
  expect(calls.filter((path) => path.endsWith('/sessions'))).toHaveLength(1)
  await client.invalidateQueries({ predicate: (query) => query.queryKey[3] === 'sessions' })
  await waitFor(() => expect(calls.filter((path) => path.endsWith('/sessions'))).toHaveLength(2))
})

test('initial roots and projects publish together even when one provider answers first', async () => {
  const client = createQueryClient()
  clients.push(client)
  const pending = new Map<string, (response: Response) => void>()
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => new Promise<Response>((resolve) => pending.set(String(url), resolve)))
  )
  const registered = [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
  ]
  const wrapper = ({ children }: { children: import('react').ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => useNavIndex(registered), { wrapper })
  const respond = async (
    provider: string,
    route: string,
    body: {
      roots?: { id: string; dir: string; label: string }[] | { id: string; dir: string; label: string }[]
      projects?: { slug: string; cwd: string; lastActivity: number }[] | { slug: string; cwd: string; lastActivity: number }[]
    }
  ) => {
    const find = () => [...pending.keys()].find((url) => new URL(url, 'http://fixture').pathname === `/api/${provider}/${route}`)
    await waitFor(() => expect(find()).toBeTruthy())
    await act(async () => required(pending.get(required(find())))(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })))
  }
  await respond('claude', 'roots', { roots: [{ id: 'a', dir: '/fixture/a', label: 'A' }] })
  await respond('claude', 'projects', { projects: [{ slug: 'one', cwd: '/fixture/one', lastActivity: 1 }] })
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.projects).toEqual([])
  expect(hook.result.current.scopes).toEqual([])
  expect(hook.result.current.roots).toEqual({})
  await respond('codex', 'roots', { roots: [{ id: 'b', dir: '/fixture/b', label: 'B' }] })
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.projects).toEqual([])
  await respond('codex', 'projects', { projects: [{ slug: 'two', cwd: '/fixture/two', lastActivity: 2 }] })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(hook.result.current.projects.map((project) => project.provider)).toEqual(['codex', 'claude'])
  expect(hook.result.current.scopes.map((scope) => scope.provider)).toEqual(['claude', 'codex'])
})

test('adding a root retains published chips and projects while the new inventory loads', async () => {
  const client = createQueryClient()
  clients.push(client)
  let answerNew: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (value) => {
      const url = new URL(value, 'http://fixture')
      if (url.pathname.endsWith('/projects') && url.searchParams.get('root') === 'b')
        return new Promise<Response>((resolve) => {
          answerNew = resolve
        })
      return new Response(
        JSON.stringify(
          url.pathname.endsWith('/roots') ? { roots: [{ id: 'a', label: 'A', dir: '/fixture/a' }] } : { projects: [{ slug: 'one', cwd: '/fixture/one' }] }
        )
      )
    })
  )
  const wrapper = ({ children }: { children: import('react').ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => useNavIndex(providers), { wrapper })
  await waitFor(() => expect(hook.result.current.projects).toHaveLength(1))
  act(() =>
    client.setQueryData(queryKeys.roots('codex'), {
      roots: [
        { id: 'a', label: 'A', dir: '/fixture/a' },
        { id: 'b', label: 'B', dir: '/fixture/b' },
      ],
    })
  )
  await waitFor(() => expect(answerNew).toBeTypeOf('function'))
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.projects.map((project) => project.slug)).toEqual(['one'])
  expect(hook.result.current.scopes.map((scope) => scope.root)).toEqual(['a', 'b'])
  expect(hook.result.current.roots.codex).toHaveLength(2)
  await act(async () => answerNew(new Response(JSON.stringify({ projects: [{ slug: 'two', cwd: '/fixture/two' }] }))))
  await waitFor(() => expect(hook.result.current.projects).toHaveLength(2))
})
