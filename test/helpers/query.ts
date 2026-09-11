import type { SidebarRowsContext } from '../../src/components/shared/sidebar/rows.tsx'
import type { NavIndex, NavSession } from '../../src/api/useNavIndex.ts'
import type { UIProvider } from '../../src/providers/views.ts'
import { PROVIDERS } from '../../src/providers/index.ts'
import { createProviderClient } from '../../src/api/endpoints.ts'
import type { ProviderClient } from '../../src/api/providerApi.ts'
import { providerMetadata } from '../../src/providers/metadata.ts'
import { createElement, type JSX, type ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach } from 'vitest'
import { createQueryClient } from '../../src/api/index.ts'

const clients = new Set<ReturnType<typeof createQueryClient>>()
afterEach(() => {
  for (const client of clients) client.clear()
  clients.clear()
})

// Match the production provider boundary, with retries disabled for failures
// that tests need to observe directly. Each render starts with an isolated cache.
export function renderWithQuery(element: JSX.Element, options?: RenderOptions) {
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { retry: false, staleTime: 5000, gcTime: Infinity } })
  clients.add(client)
  const wrap = (child: ReactNode) => createElement(QueryClientProvider, { client }, child)
  const result = render(wrap(element), options)
  return { ...result, rerender: (child: ReactNode) => result.rerender(wrap(child)), queryClient: client }
}

export function renderStaticWithQuery(element: ReactNode) {
  const client = createQueryClient()
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, element))
  } finally {
    client.clear()
  }
}

// A complete client with explicit per-test overrides. Unexpected API calls fail
// locally rather than reaching the maintainer's server or relying on missing methods.
export function mockProviderApi<T extends Partial<ProviderClient>>(provider: string, overrides: T) {
  return {
    ...createProviderClient(provider, providerMetadata(provider).addressing, async () => {
      throw new Error('Unexpected fixture API call')
    }),
    ...overrides,
  }
}

export function mockNavIndex(overrides: Partial<NavIndex> = {}): NavIndex {
  return {
    projects: [],
    roots: {},
    scopes: [],
    loading: false,
    refresh: async () => {},
    loadSessions: async () => [],
    sessionsFor: () => [],
    cachedSessions: () => [],
    invalidate: async () => {},
    labelOf: () => 'account',
    ...overrides,
  }
}
export function mockNavSession(overrides: Partial<NavSession>): NavSession {
  return {
    provider: 'codex',
    root: 'r',
    slug: '/fixture',
    id: 'fixture',
    title: 'Fixture',
    firstPrompt: '',
    lastUserPrompt: '',
    lastUserPromptTs: null,
    firstTs: null,
    lastTs: null,
    userTurns: 0,
    assistantTurns: 0,
    toolCalls: 0,
    models: [],
    toolCounts: {},
    tokens: { input: 0, output: 0, cacheRead: 0, total: 0 },
    oversized: false,
    isSubagent: false,
    agentRole: null,
    childCount: 0,
    hasSubagents: false,
    ...overrides,
  }
}
export function mockProvider(id: string, label = id): UIProvider {
  return { ...PROVIDERS.codex, id, label }
}

export function mockSidebarContext(overrides: Omit<Partial<SidebarRowsContext>, 'index'> & { index?: Partial<NavIndex> } = {}): SidebarRowsContext {
  const { index, ...rest } = overrides
  return {
    providers: [],
    index: mockNavIndex(index),
    dotFor: () => null,
    isActive: () => false,
    isRecent: () => false,
    selected: new Set(),
    toggleSelected: () => {},
    onOpenTarget: () => {},
    askTrash: async () => {},
    menuFor: null,
    setMenuFor: () => {},
    workspaces: [],
    openKeys: new Set(),
    toggleKey: () => {},
    hidePinned: false,
    hideGrouped: false,
    drafts: [],
    activeTarget: null,
    newConversationItems: () => [],
    projectHidden: () => false,
    folderPins: [],
    folderFocus: null,
    onFolderWorkspaceChange: () => {},
    ...rest,
  }
}

export function mockHomeData<T extends object>(data: T) {
  return { scope: { sources: [] }, sources: [], errors: [], notices: [], capturedAt: 0, ...data }
}
