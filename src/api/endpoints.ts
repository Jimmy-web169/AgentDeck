import type { PluginsReport, HistoryReport } from './models.ts'
import type { ActivityReport, StatsReport } from './models.ts'
import type { ConversationData, SubagentIndex } from './models.ts'
import type { MemoryReply } from './models.ts'
export type Ref = import('../providers/addressing.ts').Ref
export type ResourceRef = import('../providers/addressing.ts').ResourceRef
export type Addressing = import('../providers/addressing.ts').Addressing
export type Params = import('../providers/addressing.ts').Params
export type Cut = import('../providers/addressing.ts').Cut
export type OpenOptions = import('../providers/addressing.ts').OpenOptions
export type RequestOptions = import('./fetcher.ts').RequestOptions
export type RootRef = { root: string }
export type Reply = Record<string, unknown>
export type Root = import('./models.ts').RootInfo
export type Project = import('../../shared/types.d.ts').Project
export type SessionSummary = import('./models.ts').SessionDetails
export type TimelineEvent = import('../../shared/types.d.ts').TimelineEvent
export type TerminalEntry = import('../../shared/types.d.ts').TerminalEntry
export type Usage = import('./models.ts').UsageReport
import { request as defaultRequest } from './fetcher.ts'

// Each API instance closes over its provider id, so a background request
// that finishes after a provider switch cannot send its refetch to the
// other provider. Never select the request provider from mutable UI state.

export function createProviderClient(provider: string, addressing: Addressing, request: typeof defaultRequest = defaultRequest) {
  const send = <T = Reply>(route: string, options: RequestOptions = {}): Promise<T> =>
    request(`/api/${provider}/${route}`, { ...options, body: options.body || undefined })

  const get = <T = Reply>(route: string, params?: Params): Promise<T> => send(route, { params })

  const sessionRequest = <T = Reply>(route: string, ref: Ref, method: string = 'GET'): Promise<T> => send(route, { method, params: addressing.session(ref) })
  return Object.freeze({
    provider,

    roots: (): Promise<{ roots: Root[]; default: string | null }> => get('roots'),

    version: ({ root }: RootRef): Promise<{ version: string | null }> => get('version', { root }),

    probeRun: ({ root }: RootRef) => send('probe/run', { method: 'POST', body: { root } }),

    probeAccept: ({ root }: RootRef) => send('probe/accept', { method: 'POST', body: { root } }),

    addRoot: ({ path, label }: { path: string; label?: string }) => send('roots', { method: 'POST', body: { path, label } }),

    relabelRoot: ({ id, label }: { id: string; label: string }) => send('roots/label', { method: 'POST', body: { id, label } }),

    removeRoot: ({ id }: { id: string }) => send('roots', { method: 'DELETE', params: { id } }),

    projects: ({ root }: RootRef): Promise<{ projects: Project[] }> => get('projects', { root }),

    sessions: ({ root, slug }: Ref): Promise<{ sessions: SessionSummary[] }> => get('sessions', { root, slug }),

    stats: ({ root }: RootRef) => get<StatsReport>('stats', { root }),

    activity: ({ root, days }: RootRef & { days?: number }) => get<ActivityReport>('activity', { root, days }),

    history: ({ root }: RootRef) => get<HistoryReport>('history', { root }),

    usage: ({ root }: RootRef): Promise<Usage> => get('usage', { root }),

    plugins: ({ root }: RootRef) => get<PluginsReport>('plugins', { root }),

    skillRun: (body: Reply) => send<{ ok: boolean; code: number | null; output: string }>('skill-run', { method: 'POST', body }),

    browse: ({ path }: { path?: string } = {}) => get('browse', path ? { path } : {}),
    pickFolder: () => get<{ ok?: boolean; path?: string; cancelled?: boolean }>('pick-folder'),

    terminal: (body: Reply) => send<TerminalEntry & { canBindSession?: boolean; reused?: boolean; brief?: string }>('terminal', { method: 'POST', body }),

    terminals: (): Promise<{ terminals: TerminalEntry[] }> => get('terminals'),

    terminalStop: ({ key }: { key: string }) => send('terminal', { method: 'DELETE', params: { key } }),

    session: (ref: Ref): Promise<ConversationData> => sessionRequest('session', ref),

    raw: (ref: Ref): Promise<{ records: unknown[] }> => sessionRequest('raw', ref),

    subagents: (ref: Ref) => sessionRequest<SubagentIndex>('subagents', ref),

    subagent: ({ root, slug, id, run, agent }: Ref & { run?: string; agent?: string }) =>
      get<ConversationData>('subagent', run ? { root, slug, session: id, run, agent } : { root, slug, session: id, agent }),

    memory: ({ root, slug }: Ref) => get<MemoryReply>('memory', slug !== undefined ? { root, slug } : { root }),

    fork: (ref: Ref, cut?: Cut) => send('fork', { method: 'POST', body: addressing.fork(ref, cut) }),

    deleteSession: (ref: Ref) => sessionRequest('session', ref, 'DELETE'),

    saveMemory: ({ root, slug, name, content }: Ref & { name: string; content: string }) =>
      send('memory', { method: 'POST', body: { root, slug, name, content } }),

    deleteMemory: ({ root, slug, name }: Ref & { name: string }) => send('memory', { method: 'DELETE', params: { root, slug, name } }),

    resources: (ref: ResourceRef) => get('resources', addressing.resources(ref)),

    resource: ({ root, kind, name, slug }: ResourceRef) =>
      get<{ kind: string; name: string; content: string }>('resource', slug ? { root, kind, name, slug } : { root, kind, name }),

    saveResource: ({ root, kind, name, content, slug }: ResourceRef & { content: string }) =>
      send('resource', { method: 'POST', body: slug ? { root, kind, name, content, slug } : { root, kind, name, content } }),

    createResource: (body: Reply) => send('resource', { method: 'POST', body }),

    deleteResource: (ref: ResourceRef) => send('resource', { method: 'DELETE', params: addressing.deleteResource(ref) }),

    open: (ref: Ref, options: OpenOptions) => send('open', { method: 'POST', body: addressing.open(ref, options) }),
  })
}

// Deck retains its unconditional reads even if a future handler emits an ETag.

export const deckApi = <T = Reply>(route: string, body?: unknown): Promise<T> =>
  defaultRequest(`/api/deck/${route}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', revalidate: false, body })
