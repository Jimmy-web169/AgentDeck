import { required } from '../helpers/assert.ts'
// @vitest-environment jsdom
import React from 'react'
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createQueryClient } from '../../src/api/queries.ts'
import SessionApp from '../../src/SessionApp.tsx'
import claude from '../../src/providers/claude.tsx'
import codex from '../../src/providers/codex.tsx'
import antigravity from '../../src/providers/antigravity.tsx'
let cache: QueryClient, send: ReturnType<typeof vi.fn<typeof fetch>>
const providers: import('../../src/providers/views.ts').UIProvider[] = [claude, codex, antigravity]
function Transcript({ data, onFork }: import('../../src/components/shared/Conversation.tsx').ConversationProps) {
  return React.createElement(
    'div',
    null,
    React.createElement('p', null, data.summary.title),
    onFork && React.createElement('button', { type: 'button', onClick: () => onFork(data.timeline[1]) }, 'Fork reply')
  )
}
function Resource({ root, slug }: import('../../src/api/models.ts').ResourceScopeProps) {
  return React.createElement('p', null, `Configuration ${root}/${slug}`)
}
function Memory({ slug, cwd }: { slug?: string | null; cwd?: string | null }) {
  return React.createElement('p', null, `Memory ${slug || cwd}`)
}
const Blank = () => null
function config(id: string): import('../../src/SessionApp.tsx').SessionProvider {
  const provider = providers.find((item) => item.id === id)
  if (!provider) throw new Error(`Unknown fixture provider: ${id}`)
  return {
    ...provider,
    components: {
      Conversation: Transcript,
      ResourcesView: Resource,
      MemoryView: Memory,
      SubagentsView: Blank,
      TerminalPanel: Blank,
      RateLimitsBar: Blank,
      Stats: Blank,
    },
  }
}
const mount = (props: React.ComponentProps<typeof SessionApp>) =>
  React.createElement(QueryClientProvider, { client: cache }, React.createElement(SessionApp, props))
beforeEach(() => {
  cache = createQueryClient()
  send = vi.fn<typeof fetch>(async (address, _options = {}) => {
    const url = new URL(String(address), 'http://fixture.invalid'),
      route = url.pathname.split('/').at(-1),
      provider = url.pathname.split('/')[2]
    const values: Record<string, unknown> = {
      roots: { roots: [{ id: 'a', label: 'A', dir: '/fixture/a' }], default: 'a' },
      projects: { projects: [] },
      sessions: { sessions: [{ id: 'one', title: `${provider} transcript`, hasSubagents: false }] },
      session: {
        root: 'a',
        slug: 'project-a',
        summary: { id: 'one', title: `${provider} transcript` },
        timeline: [
          { kind: 'user', uuid: 'first' },
          { kind: 'assistant', text: 'Reply' },
          { kind: 'user', uuid: 'next' },
        ],
      },
      usage: {},
      terminals: { terminals: [] },
      'active-sessions': { tmux: [] },
      raw: { records: [] },
      fork: { id: 'forked', title: 'Forked transcript' },
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

test('one SessionApp renders each provider and preserves Memory/Config navigation without a new EventSource', async () => {
  const source = vi.fn()
  vi.stubGlobal('EventSource', source)
  for (const provider of providers) {
    const cfg = config(provider.id),
      onConsumed = vi.fn(),
      onNavigate = vi.fn()
    const view = render(
      mount({ provider: cfg, providers, pendingOpen: { root: 'a', slug: 'project-a', id: 'one', seq: 1 }, onConsumedPending: onConsumed, onNavigate })
    )
    await waitFor(() => expect(view.getByText(`${provider.id} transcript`)).toBeTruthy())
    expect(onConsumed).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('button', { name: 'Config' }))
    expect(view.getByText('Configuration a/project-a')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: required(cfg.sessionTabs.find((tab: { k: string }) => tab.k === 'memory')).label }))
    expect(view.getByText('Memory project-a')).toBeTruthy()
    expect(source).not.toHaveBeenCalled()
    view.unmount()
  }
})

test('SessionApp uses provider-owned fork cut semantics and opens the resulting session', async () => {
  for (const id of ['claude', 'codex']) {
    const onOpen = vi.fn(),
      view = render(mount({ provider: config(id), providers, pendingOpen: { root: 'a', slug: 'project-a', id: 'one', seq: 1 }, onOpenSession: onOpen }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Fork reply' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'Fork reply' }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(id, expect.objectContaining({ root: 'a', id: 'forked' }), { newTab: true }))
    const request = send.mock.calls.find(([url]) => url === `/api/${id}/fork`)
    expect(request).toBeDefined()
    const body = JSON.parse(String(required(request)[1]?.body))
    expect(body).toMatchObject({ root: 'a', id: 'one', cut: id === 'claude' ? 'next' : 2 })
    view.unmount()
  }
})

test('real provider descriptors retain all six tabs, project-only Memory/Artifacts and supported fork policies', () => {
  for (const provider of providers) {
    expect(provider.sessionTabs.map((tab) => tab.k)).toEqual(['conversation', 'subagents', 'raw', 'stats', 'memory', 'config'])
    expect(required(provider.sessionTabs.find((tab) => tab.k === 'subagents')).need).toBe('subagents')
    expect(provider.sessionTabs.find((tab) => tab.k === 'memory')).toEqual({
      k: 'memory',
      need: 'project',
      label: provider.id === 'antigravity' ? 'Artifacts' : 'Memory',
    })
    expect(provider.components.TerminalPanel).toBeTypeOf('function')
    expect(provider.components.Stats).toBeTypeOf('function')
    expect(provider.components.ResourcesView).toBeTypeOf('function')
    expect(provider.forkCut ? 'supported' : 'unsupported').toBe(provider.id === 'antigravity' ? 'unsupported' : 'supported')
  }
})

test('SessionApp retains Claude list-derived subagent availability when transcript summary has no flag', async () => {
  const original = send.getMockImplementation()
  send.mockImplementation(async (address, options) =>
    String(address).includes('/sessions?')
      ? new Response(JSON.stringify({ sessions: [{ id: 'one', title: 'claude transcript', hasSubagents: true }] }))
      : required(original)(address, options)
  )
  const view = render(mount({ provider: config('claude'), providers, pendingOpen: { root: 'a', slug: 'project-a', id: 'one', seq: 1 } }))
  await waitFor(() => expect(view.getByText('claude transcript')).toBeTruthy())
  expect((view.getByRole('button', { name: 'Sub-agents' }) as HTMLButtonElement).disabled).toBe(false)
})

test('SessionApp shows the parse-limit explanation for oversized transcripts without a loading placeholder or transcript request', async () => {
  const original = send.getMockImplementation()
  send.mockImplementation(async (address, options) =>
    String(address).includes('/sessions?')
      ? new Response(JSON.stringify({ sessions: [{ id: 'large', title: 'Large transcript', oversized: true }] }))
      : required(original)(address, options)
  )
  const view = render(
    mount({
      provider: config('claude'),
      providers,
      pendingOpen: { root: 'a', slug: 'project-a', id: 'large', seq: 1 },
      navigationTarget: { provider: 'claude', root: 'a', slug: 'project-a', id: 'large' },
    })
  )
  await waitFor(() => expect(view.getByText("This transcript exceeds the parse limit, so it can't be displayed. Other sessions are unaffected.")).toBeTruthy())
  expect(view.getByText('Large transcript')).toBeTruthy()
  expect(view.queryByText('Loading session…')).toBeNull()
  expect(send.mock.calls.some(([address]) => new URL(String(address), 'http://fixture.invalid').pathname.endsWith('/session'))).toBe(false)
})
