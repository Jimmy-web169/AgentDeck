import type { HomeData, HistoryRecord, HomeSource } from './models.ts'
import type { FolderCatalog } from './models.ts'
import type { QueryFunctionContext, UseMutationOptions } from '@tanstack/react-query'
import { queryIdentity, isProviderInventoryKey } from '../../shared/identity.ts'
import { createContext, useContext, useCallback } from 'react'
import type { TerminalEntry, HomeReport, Dashboard } from '../../shared/types.js'
import type { QueryRef } from './queryPolicy.ts'
type ProviderKind =
  | 'version'
  | 'roots'
  | 'projects'
  | 'sessions'
  | 'session'
  | 'raw'
  | 'subagents'
  | 'subagent'
  | 'stats'
  | 'usage'
  | 'terminals'
  | 'activeSessions'
  | 'memory'
  | 'resources'
  | 'resource'
  | 'plugins'
  | 'activity'
  | 'history'
type ProviderReplies = { [K in Exclude<ProviderKind, 'activeSessions'>]: Awaited<ReturnType<ProviderClient[K]>> } & { activeSessions: ActiveSessions }
type DeckKind = 'home' | 'folderCatalog' | 'dashboards' | 'dashboard'
type DeckReplies = {
  home: HomeReport
  folderCatalog: FolderCatalog
  dashboards: { dashboards: Dashboard[]; capability?: { reason?: string } }
  dashboard: Record<string, unknown>
}
interface QuerySwitch {
  enabled?: boolean
  search?: string
}
interface DeckInput {
  view?: string
  scope?: unknown
  search?: string
  id?: string
}
import { QueryClient, MutationObserver, useQuery, useQueries, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createProviderClient } from './endpoints.ts'
import { request } from './fetcher.ts'
import { providerMetadata } from '../providers/metadata.ts'
import { homeQuery } from '../lib/homeScope.ts'
import { queryKeys, matchesChange } from './queryPolicy.ts'

export const POLL_MS: Partial<Record<ProviderKind | DeckKind, number>> = Object.freeze({
  session: 15000,
  subagents: 15000,
  subagent: 15000,
  usage: 30000,
  terminals: 4000,
  activeSessions: 4000,
  folderCatalog: 30000,
  dashboards: 10000,
})
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 5000, structuralSharing: true, refetchOnWindowFocus: true, retry: 1, refetchIntervalInBackground: false } },
  })
export const QueryActivityContext = createContext(true)

// Each invocation closes over its own AbortSignal and immutable provider.
// Cancellation never changes a global client or another provider's request.
export function clientForQuery(provider: string, signal?: AbortSignal, send = request) {
  const descriptor = providerMetadata(provider)
  return createProviderClient(provider, descriptor.addressing, (url, options) => send(url, { ...options, signal }))
}

const globalProviderKinds = new Set(['roots', 'terminals', 'activeSessions'])
const sessionKinds = new Set(['session', 'raw', 'subagents', 'subagent'])
function providerKey(kind: ProviderKind, ref: QueryRef) {
  return kind === 'roots' || kind === 'terminals' || kind === 'activeSessions' ? queryKeys[kind](ref.provider) : queryKeys[kind]({ ...ref, id: ref.id || '' })
}
async function fetchProvider(kind: ProviderKind, ref: QueryRef, signal: AbortSignal) {
  return kind === 'activeSessions'
    ? request<ActiveSessions>(`/api/${ref.provider}/active-sessions`, { signal })
    : clientForQuery(ref.provider, signal)[kind](ref)
}
export function providerQueryOptions<K extends ProviderKind>(kind: K, ref: QueryRef, { enabled = true }: QuerySwitch = {}) {
  const global = globalProviderKinds.has(kind)
  const addressing = sessionKinds.has(kind) && ref.provider ? providerMetadata(ref.provider).apiAddr : null
  const needsSlug = kind === 'sessions' || (sessionKinds.has(kind) && addressing === 'slug+id')
  const valid = !!ref.provider && (global || !!ref.root) && (!sessionKinds.has(kind) || !!ref.id) && (!needsSlug || !!ref.slug)
  return {
    queryKey: providerKey(kind, ref),
    queryFn: async ({ signal }: QueryFunctionContext): Promise<ProviderReplies[K]> => {
      const result = await fetchProvider(kind, ref, signal)
      // The selected endpoint determines the result contract; generic indexed
      // access cannot retain that relationship after the active-sessions branch.
      return result as ProviderReplies[K]
    },
    enabled: enabled && valid,
    refetchInterval: POLL_MS[kind] || (false as const),
    refetchIntervalInBackground: false,
  }
}

function useProviderQuery<K extends ProviderKind>(kind: K, ref: QueryRef, options: QuerySwitch = {}) {
  const visible = useContext(QueryActivityContext)
  return useQuery(providerQueryOptions(kind, ref, { ...options, enabled: visible && options.enabled !== false }))
}
export function useProviderVersions(providers: readonly { id: string }[], roots: Record<string, { id: string; exists?: boolean }[]>, { enabled = true } = {}) {
  const visible = useContext(QueryActivityContext)
  const replies = useQueries({
    queries: providers.map((provider) => {
      const root = (roots[provider.id] || []).find((root) => root.exists !== false)?.id || ''
      return providerQueryOptions('version', { provider: provider.id, root }, { enabled: enabled && visible && !!root })
    }),
  })
  return Object.fromEntries(providers.map((provider, index) => [provider.id, replies[index].data?.version || null]))
}
export const stopTerminal = (provider: string, key: string) => clientForQuery(provider).terminalStop({ key })
export const useRoots = (provider: string, options?: QuerySwitch) => useProviderQuery('roots', { provider, root: '' }, options)
export const useProjects = (provider: string, root: string | null, options?: QuerySwitch) =>
  useProviderQuery('projects', { provider, root: root || '' }, options)
export const useSessions = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('sessions', ref, options)
export const useSession = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('session', ref, options)
export const useRaw = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('raw', ref, options)
export const useSubagents = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('subagents', ref, options)
export const useSubagent = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('subagent', ref, options)
export function useThreadTranscript(target: { kind: 'session' | 'subagent'; ref: QueryRef }, { enabled = true, done = false } = {}) {
  const visible = useContext(QueryActivityContext)
  return useQuery({ ...providerQueryOptions(target.kind, target.ref, { enabled: enabled && visible }), staleTime: done ? Infinity : 0 })
}
export const useStats = (provider: string, root: string | null, options?: QuerySwitch) => useProviderQuery('stats', { provider, root: root || '' }, options)
export const useUsage = (provider: string, root: string | null, options?: QuerySwitch) => useProviderQuery('usage', { provider, root: root || '' }, options)
export const useTerminals = (provider: string, options?: QuerySwitch) => useProviderQuery('terminals', { provider, root: '' }, options)
export const useActiveSessions = (provider: string, options?: QuerySwitch) => useProviderQuery('activeSessions', { provider, root: '' }, options)
export const useMemory = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('memory', ref, options)
export function useResources<T = Record<string, unknown>>(ref: QueryRef, options: QuerySwitch = {}) {
  const visible = useContext(QueryActivityContext)
  const query = providerQueryOptions('resources', ref, { ...options, enabled: visible && options.enabled !== false })
  return useQuery({
    ...query,
    // The provider view selects its inventory contract at the HTTP boundary.
    queryFn: async (context) => (await query.queryFn(context)) as T,
    // User config belongs to the same root when only the surrounding project
    // changes. Keep its controls mounted during that harmless refresh. Never
    // carry config across roots, providers or project-owned resource scopes.
    placeholderData: (previous, query) => {
      const identity = query ? queryIdentity(query.queryKey) : null
      return ref.scope === 'user' && identity?.provider === ref.provider && identity.root === ref.root && identity.scope === 'user' ? previous : undefined
    },
  })
}
export const useResource = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('resource', ref, options)
export function useResourceLoader(provider: string) {
  const client = useQueryClient()
  return (ref: Omit<QueryRef, 'provider'>) => client.fetchQuery({ ...providerQueryOptions('resource', { ...ref, provider }), staleTime: 0 })
}
export const usePlugins = (provider: string, root: string | null, options?: QuerySwitch) => useProviderQuery('plugins', { provider, root: root || '' }, options)
export const useActivity = (ref: QueryRef, options?: QuerySwitch) => useProviderQuery('activity', ref, options)
export const useHistory = (provider: string, root: string | null, options?: QuerySwitch) => useProviderQuery('history', { provider, root: root || '' }, options)

export function deckQueryOptions<K extends DeckKind>(kind: K, input: DeckInput = {}, { enabled = true }: QuerySwitch = {}) {
  const keys = {
    home: () => queryKeys.home(input.view || 'activity', input.scope, input.search),
    folderCatalog: queryKeys.folderCatalog,
    dashboards: queryKeys.dashboards,
    dashboard: () => queryKeys.dashboard(input.id || ''),
  }
  const routes = {
    home: () => `home?${homeQuery(input.view || 'activity', input.scope, { search: input.search })}`,
    folderCatalog: () => 'folders?fresh=1',
    dashboards: () => 'dashboards',
    dashboard: () => `dashboard?id=${encodeURIComponent(input.id || '')}`,
  }
  return {
    queryKey: keys[kind](),
    queryFn: ({ signal }: QueryFunctionContext) => request<DeckReplies[K]>(`/api/deck/${routes[kind]()}`, { signal, cache: 'no-store', revalidate: false }),
    enabled: enabled && (kind !== 'dashboard' || !!input.id),
    refetchInterval: POLL_MS[kind] || (false as const),
    refetchIntervalInBackground: false,
  }
}
function useDeckQuery<K extends DeckKind>(kind: K, input: DeckInput, options: QuerySwitch = {}) {
  const visible = useContext(QueryActivityContext)
  return useQuery(deckQueryOptions(kind, input, { ...options, enabled: visible && options.enabled !== false }))
}
export const useHome = (view: string, scope: unknown, options: QuerySwitch = {}) => useDeckQuery('home', { view, scope, search: options.search }, options)
export const useFolderCatalog = (options?: QuerySwitch) => useDeckQuery('folderCatalog', {}, options)
export const useDashboards = (options?: QuerySwitch) => useDeckQuery('dashboards', {}, options)
export const useDashboard = (id: string, options?: QuerySwitch) => useDeckQuery('dashboard', { id }, options)

type HomePage = HomeData & { history?: (HistoryRecord & HomeSource & { key: string })[] }
export function homeInfiniteOptions(view: string, scope: unknown, { enabled = true, search = '', fresh = false }: QuerySwitch & { fresh?: boolean } = {}) {
  return {
    queryKey: queryKeys.homePages(view, scope, search),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }: { signal: AbortSignal; pageParam: string | undefined }) => {
      const query = homeQuery(view, scope, { search })
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : fresh ? '&fresh=1' : ''
      return request<HomePage>(`/api/deck/home?${query}${cursor}`, { signal, cache: 'no-store', revalidate: false })
    },
    getNextPageParam: (lastPage: HomePage) => lastPage.nextCursor || undefined,
    enabled,
    refetchIntervalInBackground: false,
  }
}
export function useHomePages(view: string, scope: unknown, options: QuerySwitch = {}) {
  const visible = useContext(QueryActivityContext)
  return useInfiniteQuery(homeInfiniteOptions(view, scope, { ...options, enabled: visible && options.enabled !== false }))
}
export function mergeHomePages(pages: HomePage[]) {
  const last = pages.at(-1)
  return last ? { ...last, history: pages.flatMap((page) => page.history || []) } : null
}
export async function refreshHomePages(queryClient: QueryClient, view: string, scope: unknown, search = '') {
  const options = homeInfiniteOptions(view, scope, { search, fresh: true })
  await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
  // Old cursors belong to an expiring server snapshot. A manual refresh starts
  // at page one and must not replay the old chain or refresh another scope.
  return queryClient.fetchInfiniteQuery({ ...options, staleTime: 0, pages: 1 })
}

export function useHomeReport(view: string, scope: unknown, { enabled = true, search = '' }: QuerySwitch = {}) {
  const client = useQueryClient()
  const pages = useHomePages(view, scope, { enabled, search })
  const refresh = useMutation({ mutationKey: queryKeys.homePages(view, scope, search), mutationFn: () => refreshHomePages(client, view, scope, search) })
  return {
    data: refresh.isPending ? null : mergeHomePages(pages.data?.pages || []),
    busy: refresh.isPending || (pages.isFetching && !pages.isFetchingNextPage),
    moreBusy: pages.isFetchingNextPage,
    error: pages.error?.message || refresh.error?.message || '',
    refresh: () => refresh.mutate(),
    loadMore: () => pages.fetchNextPage(),
  }
}

type ProviderClient = ReturnType<typeof createProviderClient>
type MutationKind =
  | 'skillRun'
  | 'fork'
  | 'deleteSession'
  | 'saveResource'
  | 'createResource'
  | 'deleteResource'
  | 'saveMemory'
  | 'deleteMemory'
  | 'addRoot'
  | 'relabelRoot'
  | 'removeRoot'
  | 'probeRun'
  | 'probeAccept'
type MutationInputs = { [K in MutationKind]: { ref: Parameters<ProviderClient[K]>[0] } } & {
  fork: { cut?: Parameters<ProviderClient['fork']>[1] }
}
type MutationInput<K extends MutationKind> = MutationInputs[K]
type MutationResult<K extends MutationKind> = Awaited<ReturnType<ProviderClient[K]>>
type MutationOptions<K extends MutationKind> = Omit<UseMutationOptions<MutationResult<K>, Error, MutationInput<K>>, 'mutationFn'>

export function providerMutationOptions<K extends MutationKind>(
  queryClient: QueryClient,
  provider: string,
  kind: K,
  options: MutationOptions<K> = {}
): UseMutationOptions<MutationResult<K>, Error, MutationInput<K>> {
  const client = clientForQuery(provider)
  const actions: { [M in MutationKind]: (input: MutationInput<M>) => Promise<MutationResult<M>> } = {
    skillRun: ({ ref }: MutationInput<'skillRun'>) => client.skillRun(ref),
    fork: ({ ref, cut }: MutationInput<'fork'>) => client.fork(ref, cut),
    deleteSession: ({ ref }: MutationInput<'deleteSession'>) => client.deleteSession(ref),
    saveResource: ({ ref }: MutationInput<'saveResource'>) => client.saveResource(ref),
    createResource: ({ ref }: MutationInput<'createResource'>) => client.createResource(ref),
    deleteResource: ({ ref }: MutationInput<'deleteResource'>) => client.deleteResource(ref),
    saveMemory: ({ ref }: MutationInput<'saveMemory'>) => client.saveMemory(ref),
    deleteMemory: ({ ref }: MutationInput<'deleteMemory'>) => client.deleteMemory(ref),
    addRoot: ({ ref }: MutationInput<'addRoot'>) => client.addRoot(ref),
    relabelRoot: ({ ref }: MutationInput<'relabelRoot'>) => client.relabelRoot(ref),
    removeRoot: ({ ref }: MutationInput<'removeRoot'>) => client.removeRoot(ref),
    probeRun: ({ ref }: MutationInput<'probeRun'>) => client.probeRun(ref),
    probeAccept: ({ ref }: MutationInput<'probeAccept'>) => client.probeAccept(ref),
  }
  return {
    ...options,
    // The registry binds each command to its own named input. Widen the indexed
    // callable only to that same selected key, never to arbitrary API methods.
    mutationFn: actions[kind],
    onSuccess: async (data, variables, ...rest) => {
      const root = 'root' in variables.ref ? variables.ref.root : undefined
      await queryClient.invalidateQueries({
        predicate: (query) => {
          // Root-list mutations have no configured root in their input, and may
          // add/delete the entire scope. Refresh provider inventory and Deck views.
          if (query.meta?.manualOnly) return false
          if (typeof root !== 'string') {
            const identity = queryIdentity(query.queryKey)
            return identity?.owner === 'deck' || (identity?.owner === 'provider' && identity.provider === provider)
          }
          return matchesChange(query.queryKey, { provider, root, ...variables.ref })
        },
      })
      return options.onSuccess?.(data, variables, ...rest)
    },
  }
}
export function useProviderMutation<K extends MutationKind>(provider: string, kind: K, options?: MutationOptions<K>) {
  return useMutation(providerMutationOptions(useQueryClient(), provider, kind, options))
}
export function useProviderCommand() {
  const client = useQueryClient()
  return useCallback(
    <K extends MutationKind>(provider: string, kind: K, input: MutationInput<K>) =>
      new MutationObserver(client, providerMutationOptions(client, provider, kind)).mutate(input),
    [client]
  )
}
export const useFork = (provider: string, options?: MutationOptions<'fork'>) => useProviderMutation(provider, 'fork', options)
export const useDeleteSession = (provider: string, options?: MutationOptions<'deleteSession'>) => useProviderMutation(provider, 'deleteSession', options)
export const useSaveResource = (provider: string, options?: MutationOptions<'saveResource'>) => useProviderMutation(provider, 'saveResource', options)
export const useCreateResource = (provider: string, options?: MutationOptions<'createResource'>) => useProviderMutation(provider, 'createResource', options)
export const useDeleteResource = (provider: string, options?: MutationOptions<'deleteResource'>) => useProviderMutation(provider, 'deleteResource', options)
export const useSaveMemory = (provider: string, options?: MutationOptions<'saveMemory'>) => useProviderMutation(provider, 'saveMemory', options)
export const useDeleteMemory = (provider: string, options?: MutationOptions<'deleteMemory'>) => useProviderMutation(provider, 'deleteMemory', options)
export const useAddRoot = (provider: string, options?: MutationOptions<'addRoot'>) => useProviderMutation(provider, 'addRoot', options)
export const useRelabelRoot = (provider: string, options?: MutationOptions<'relabelRoot'>) => useProviderMutation(provider, 'relabelRoot', options)
export const useRemoveRoot = (provider: string, options?: MutationOptions<'removeRoot'>) => useProviderMutation(provider, 'removeRoot', options)
export const useProbeRun = (provider: string, options?: MutationOptions<'probeRun'>) => useProviderMutation(provider, 'probeRun', options)
export const useProbeAccept = (provider: string, options?: MutationOptions<'probeAccept'>) => useProviderMutation(provider, 'probeAccept', options)

interface ActiveSessions {
  tmux: TerminalEntry[]
  sdk?: unknown[]
  [key: string]: unknown
}
type TerminalUpdate = Partial<TerminalEntry> & { key: string; requestedTarget?: unknown }
export async function updateLiveTerminal(queryClient: QueryClient, entry: TerminalUpdate, { remove = false } = {}) {
  if (!entry?.key || (!remove && (!entry.provider || !entry.root))) return
  const predicate = (query: { queryKey: readonly unknown[] }) => isProviderInventoryKey(query.queryKey, 'active-sessions')
  await queryClient.cancelQueries({ predicate })
  queryClient.setQueriesData<ActiveSessions>({ predicate }, (previous) => {
    if (!previous) return previous
    const tmux = previous.tmux || []
    const old = tmux.find((item) => item.key === entry.key)
    const { requestedTarget, ...persistent } = entry
    const next = { ...old, ...persistent }
    // The server and optimistic producers share the same mandatory identity.
    if (!remove && (!next.provider || !next.root)) return previous
    return { ...previous, tmux: [...tmux.filter((item) => item.key !== entry.key), ...(remove ? [] : [next])] }
  })
  await queryClient.invalidateQueries({ predicate, refetchType: 'none' })
}
