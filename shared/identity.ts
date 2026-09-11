export type Target = import('./types.d.ts').Target
export type QueryRef = {
  provider: string
  root: string
  slug?: string | null
  id?: string | null
  run?: string
  agent?: string
  days?: number
  scope?: string
  kind?: string
  name?: string
}
export type QueryIdentity = {
  owner: 'provider' | 'deck' | 'filesystem'
  kind: string
  provider?: string
  inventory?: boolean
  root?: unknown
  slug?: unknown
  id?: unknown
  scope?: unknown
}
import { normalizeHomeScope } from './homeScope.ts'
// These formats are existing protocols, not interchangeable encodings. Keep
// persisted bytes stable when centralizing callers or introducing query keys.

export const sourceKey = (provider: string, root: string) => `${provider}|${root}`

export const sessionKey = (provider: string, root: string, id: string) => `${sourceKey(provider, root)}|${id}`

export const liveProjectKey = (provider: string, root: string, slug: string) => sessionKey(provider, root, slug)
export const liveSessionKey = sessionKey
export const sessionVersionKey = sessionKey

export const isDeckTarget = (target: Target | null | undefined) => target?.kind === 'dashboard' && !!target.dashboardId

export function targetKey(target: Target | null | undefined) {
  if (isDeckTarget(target)) return `${target?.kind}|${target?.dashboardId}`
  if (!target?.provider) return ''
  const scope = sourceKey(target.provider, target.root || '')
  if (target.id) return `${scope}|session|${target.id}`
  if (target.terminalKey) return `${scope}|terminal|${target.terminalKey}`
  if (target.launchId) return `${scope}|launch|${target.launchId}`
  return `${scope}|${target.draft ? 'draft' : 'project'}|${target.cwd || target.slug || ''}`
}

export const terminalKey = (provider: string, root: string, { id, launchId }: { id?: string | null; launchId?: string | null }) =>
  `${sourceKey(provider, root)}|${id ? `session|${id}` : `launch|${launchId}`}`

export const legacyDraftKey = (root: string, folder: string) => `${root}|new|${folder}`

export const terminalEntryKey = (provider: string, root: string, key: string) => sessionKey(provider, root, key)

export const changeBatchKey = (event: import('./types.d.ts').ChangeEvent) => `${event.provider}:${event.root}:${event.id || ''}`

export const projectKey = (value: Target | null | undefined) => sessionKey(value?.provider || '', value?.root || '', value?.slug || '')

export const colonProjectKey = (value: { provider: string; root: string; slug?: string | null }) => `${value.provider}:${value.root}:${value.slug}`

export const projectSessionKey = (value: Target | null | undefined) => `${projectKey(value)}|${value?.id || ''}`

export const folderItemKey = (folderId: string) => JSON.stringify(['folder', folderId])

export const homeSourceKey = (value: { provider: string; root: string }) => JSON.stringify([value.provider, value.root])
// Home and folder identities use JSON tuples. They are deliberately distinct
// from the older pipe-encoded projectKey/sessionKey persisted by tabs and pins.

export const homeProjectKey = (value: { provider: string; root: string; slug?: string | null }) => JSON.stringify([value.provider, value.root, value.slug])

export const homeRecordKey = (source: { provider: string; root: string }, id: string | number | null | undefined) =>
  JSON.stringify([source.provider, source.root, id])

export const homeReportCacheKey = (base: string, view: string | null, excluded: string[], excludedRoots: string[], search: string) =>
  JSON.stringify([base, view, excluded, excludedRoots, search])

export const resourceEntryKey = (source: { provider: string; root: string }, scope: string, slug: string | undefined) =>
  JSON.stringify([source.provider, source.root, scope, slug])

export const folderNodeKey = (folder: string, provider?: string | null, root?: string | null) =>
  JSON.stringify(['folder', folder, ...(provider == null ? [] : ['provider', provider]), ...(root == null ? [] : ['root', root])])

export const draftFolderKey = (value: { provider: string; root: string; cwd: string }) => `draft:${JSON.stringify([value.provider, value.root, value.cwd])}`

export const folderProjectItemKey = (folder: string, source: { provider: string; root: string; slug?: string | null }) =>
  JSON.stringify([folder, source.provider, source.root, source.slug])

export const folderMenuKey = (section: string, workspace: string | undefined, folder: string) => JSON.stringify(['folder-menu', section, workspace, folder])

export const folderSourceActionKey = (rootKey: string, slug: string | null | undefined) => JSON.stringify([rootKey, slug])

export const historySourceKey = (value: { id: string; agent?: string | null; group?: string | null }) =>
  JSON.stringify([value.id, value.agent || null, value.group || null])

export const tmuxSourceKey = (value: { socket: string; sessionId: string }) => JSON.stringify([value.socket, value.sessionId])

export const sessionLocatorKey = (provider: string, root: string, slug: string, id: string) => `${liveProjectKey(provider, root, slug)}|${id}`

export const scopedViewKey = (view: string, provider: string, root: string) => `${view}|${sourceKey(provider, root)}`

export const quickProjectKey = (provider: string, root: string, slug: string) => `p|${liveProjectKey(provider, root, slug)}`

// Older caches and terminal aliases intentionally omit provider scope. They
// remain readable until an explicit migration replaces their persisted format.

export const legacySessionKey = (root: string, id: string) => `${root}|${id}`
export const legacyProjectKey = legacySessionKey

export const legacyProjectSessionKey = (root: string, slug: string, id: string) => `${root}|${slug}|${id}`

export const pendingOpenSignature = (target: { root: string; slug?: string; id?: string; view?: string; seq?: string | number }) =>
  `${target.root}|${target.slug}|${target.id || ''}|${target.view || ''}|${target.seq || ''}`

export const conversationBoundaryKey = (root: string, id: string, slug?: string) =>
  `conv|${slug === undefined ? legacySessionKey(root, id) : legacyProjectSessionKey(root, slug, id)}`

export const viewBoundaryKey = (view: string) => `view|${view}`

export const claudeSubagentKey = (ctx: { root: string; slug: string; id: string }, item: { runId?: string; agentId?: string }) =>
  `claude|${legacyProjectSessionKey(ctx.root, ctx.slug, ctx.id)}|${item.runId || ''}|${item.agentId || ''}`

export const sidebarItemKey = (prefix: string, id: string) => `${prefix}|${id}`

export const sidebarFolderKey = (kind: 'folder' | 'folder-project', section: string, id: string) => `${kind}|${section}|${id}`

export const insightProjectKey = (slug: string, cwd: string) => `${slug}|${cwd}`

export const homeViewKey = (view: string, scope: string) => `${view}|${scope}`

export const quickSessionKey = (target: Target) => `s|${targetKey(target)}`

export const handoffNonceInput = (key: string, timestamp: number, random: number) => `${key}|${timestamp}|${random}`

// Structured query keys preserve scope; views share their transcript cache.

const queryScopeKey = (kind: string, ref: QueryRef) => ['provider', ref.provider, ref.root, kind]

const querySessionKey = (kind: string, ref: QueryRef) => [...queryScopeKey(kind, ref), ref.slug || '', ref.id]

const queryHomeKey = (view: string, scope: unknown, search: string = '') => ['deck', 'home', view, normalizeHomeScope(scope), search]
export const queryKeys = {
  providers: () => ['providers'],

  browse: (provider: string, path: string) => ['filesystem', provider, path],

  roots: (provider: string) => ['provider', provider, 'roots'],

  projects: (ref: QueryRef) => queryScopeKey('projects', ref),

  version: (ref: QueryRef) => queryScopeKey('version', ref),

  sessions: (ref: QueryRef) => [...queryScopeKey('sessions', ref), ref.slug || ''],

  session: (ref: QueryRef) => querySessionKey('session', ref),

  raw: (ref: QueryRef) => querySessionKey('raw', ref),

  subagents: (ref: QueryRef) => querySessionKey('subagents', ref),

  subagent: (ref: QueryRef) => [...querySessionKey('subagent', ref), ref.run || '', ref.agent || ''],

  stats: (ref: QueryRef) => queryScopeKey('stats', ref),

  usage: (ref: QueryRef) => queryScopeKey('usage', ref),

  activity: (ref: QueryRef) => [...queryScopeKey('activity', ref), ref.days],

  history: (ref: QueryRef) => queryScopeKey('history', ref),

  memory: (ref: QueryRef) => [...queryScopeKey('memory', ref), ref.slug || ''],

  plugins: (ref: QueryRef) => queryScopeKey('plugins', ref),

  resources: (ref: QueryRef) => [...queryScopeKey('resources', ref), ref.scope || 'user', ref.slug || ''],

  resource: (ref: QueryRef) => [...queryScopeKey('resource', ref), ref.slug || '', ref.kind, ref.name],

  terminals: (provider: string) => ['provider', provider, 'terminals'],

  activeSessions: (provider: string) => ['provider', provider, 'active-sessions'],
  home: queryHomeKey,

  homePages: (view: string, scope: unknown, search: string = '') => [...queryHomeKey(view, scope, search), 'pages'],
  folderCatalog: () => ['deck', 'folders'],
  dashboards: () => ['deck', 'dashboards'],
  handoffDestinations: () => ['deck', 'handoff-destinations'],

  handoffStatus: (id: string) => ['deck', 'handoff-status', id],

  dashboardAttachment: (id: string) => ['deck', 'dashboard-attachment', id],

  dashboard: (id: string) => ['deck', 'dashboard', id],
}

export const quickResultKeys = (keys: string[]) => keys.join('|')

// Provider response fingerprints retain their existing byte protocol.

export const fingerprintParts = (parts: string[]) => parts.join('|')

export const childFingerprintParts = (children: { id: string; mtimeMs?: number }[], separator: string = '|') =>
  children.map((child) => `${child.id}:${child.mtimeMs}`).join(separator)

/** The inverse of queryKeys. Tuple positions must not leak into consumers.
 * @param {readonly unknown[]} key
 * @returns {QueryIdentity|null}
 */
export function queryIdentity(key: readonly unknown[]): QueryIdentity | null {
  const [owner, providerOrKind, rootOrView, kindOrScope, scopeOrSlug, id] = key
  if (owner === 'filesystem' && typeof providerOrKind === 'string') return { owner, provider: providerOrKind, kind: 'browse' }
  if (owner === 'deck' && typeof providerOrKind === 'string') return { owner, kind: providerOrKind, scope: kindOrScope }
  if (owner !== 'provider' || typeof providerOrKind !== 'string') return null
  if (key.length === 3 && typeof rootOrView === 'string') return { owner, provider: providerOrKind, kind: rootOrView, inventory: true }
  if (typeof kindOrScope !== 'string') return null
  return {
    owner,
    provider: providerOrKind,
    kind: kindOrScope,
    inventory: false,
    root: rootOrView,
    slug: kindOrScope === 'resources' ? id : scopeOrSlug,
    id,
    scope: kindOrScope === 'resources' ? scopeOrSlug : undefined,
  }
}

export const isProviderInventoryKey = (key: readonly unknown[], kind: string) => {
  const ref = queryIdentity(key)
  return ref?.owner === 'provider' && ref.inventory === true && ref.kind === kind
}
