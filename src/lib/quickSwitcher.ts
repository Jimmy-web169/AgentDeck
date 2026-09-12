import type { NavIndex, NavProject } from '../api/useNavIndex.ts'
import type { Folder, FolderSource } from '../api/models.ts'
import type { UIProvider } from '../providers/views.ts'
import type { Target, TerminalEntry } from '../../shared/types.d.ts'
import { quickProjectKey, quickSessionKey, liveProjectKey, liveSessionKey, folderItemKey } from '../../shared/identity.ts'
import { matchFields } from './fuzzy.ts'
import { fmtRelative } from './format.ts'
import { targetKey, liveTarget } from './tabs.ts'
import { pinsForMode, isFolderPin, pinKey, folderPinTarget, type Pin } from './pins.ts'
import { shortPath } from './paths.ts'
import { sessionPreviews } from './sessionPreviews.ts'
import { visibleFolderTree, type FolderFilter } from './folderTree.ts'
const MAX_PROJECTS = 6
const MAX_SESSIONS = 8
const RECENT_ROWS = 8
const RECENT_PROJECT_ROWS = 10
const LEVEL_ROWS = 80

export interface SearchTarget extends Target {
  folderId?: string
  sources?: FolderSource[]
  name?: string | null
  path?: string
  providerLabel?: string
  sessionCount?: number
  lastActivity?: number
  at?: number
  lastTs?: string | number | null
  firstPrompt?: string
  lastUserPrompt?: string
  oversized?: boolean
}
type Hits = Record<string, number[]>
export interface SearchAction {
  kind: 'home' | 'project' | 'folder-project' | 'session' | 'terminal' | 'folder' | 'new'
  key: string
  target: SearchTarget
  primary: string
  secondary?: string
  secondaryHits?: number[]
  context?: string
  meta?: string
  count?: number
  live?: boolean
  running?: boolean
  open?: boolean
  oversized?: boolean
  hits?: Hits | null
}
export type SearchRow = SearchAction | { kind: 'loading'; key: string; text?: string } | { kind: 'empty'; key: string; text: string }
export interface SearchGroup {
  title: string
  rows: SearchRow[]
}
export interface SearchInputs {
  q: string
  level: SearchTarget | null
  index: NavIndex
  recent: SearchTarget[]
  pins: Pin[]
  live: { ids: Set<string>; slugs: Set<string> }
  openTabs: Set<string>
  providers: readonly UIProvider[]
  terminals?: TerminalEntry[]
  showLatestPrompt?: boolean
  sidebarMode?: string
  pinnedFolders?: Folder[]
  folders?: Folder[]
  foldersLoading?: boolean
  foldersError?: string
  folderFilter?: FolderFilter
}
function hasMatch<T extends { m: ReturnType<typeof matchFields> }>(value: T): value is T & { m: NonNullable<T['m']> } {
  return value.m !== null
}
const byScore = (a: { m: { score: number } }, b: { m: { score: number } }) => b.m.score - a.m.score
const projectTarget = (p: NavProject): SearchTarget => ({
  provider: p.provider,
  providerLabel: p.providerLabel,
  root: p.root,
  rootLabel: p.rootLabel,
  slug: p.slug,
  cwd: p.cwd,
  name: p.name,
  path: p.path,
  sessionCount: p.sessionCount,
  lastActivity: p.lastActivity,
})

// the pin identity of a row (a project pins the project, a session the session)
export function pinTargetOf(row: SearchRow | null | undefined) {
  const t = row && 'target' in row ? row.target : null
  if (!row || !t) return null
  if (row.kind === 'folder') return t
  if (row.kind === 'folder-project') return t.folderId && t.cwd ? folderPinTarget({ id: t.folderId, cwd: t.cwd, name: t.name || undefined }) : null
  if (row.kind === 'project') return { provider: t.provider, root: t.root, rootLabel: t.rootLabel, slug: t.slug, cwd: t.cwd, project: t.name }
  if (row.kind === 'session')
    return { provider: t.provider, root: t.root, rootLabel: t.rootLabel, slug: t.slug, id: t.id, title: t.title, project: t.project, cwd: t.cwd }
  return null
}

export function buildGroups({
  q,
  level,
  index,
  recent,
  pins,
  live,
  openTabs,
  providers,
  terminals = [],
  showLatestPrompt = true,
  sidebarMode = 'source',
  pinnedFolders = [],
  folders = [],
  foldersLoading = false,
  foldersError = '',
  folderFilter = {},
}: SearchInputs) {
  pins = pinsForMode(pins, sidebarMode)
  const folderMode = sidebarMode === 'folder'
  const visibleFolders = visibleFolderTree(folders, folderFilter)
  const matchesSource = (target: Target, source: FolderSource) =>
    target.provider === source.provider &&
    target.root === source.root &&
    ((source.slug != null && target.slug === source.slug) || (!!source.cwd && target.cwd === source.cwd))
  const allowed = (target: Target) => !folderMode || visibleFolders.some((folder) => folder.sources.some((source) => matchesSource(target, source)))
  const sources = level?.sources ? visibleFolders.find((folder) => folder.id === level.folderId)?.sources || [] : null
  const isLiveS = (t: Target) => live.ids.has(liveSessionKey(t.provider || '', t.root || '', t.id || ''))
  const isLiveP = (p: Target) => live.slugs.has(liveProjectKey(p.provider || '', p.root || '', p.slug || ''))
  const plabel = (id: string | null | undefined) => providers.find((p) => p.id === id)?.label || id
  const projRow = (p: NavProject, hits?: Hits | null): SearchAction => ({
    kind: 'project',
    key: quickProjectKey(p.provider || '', p.root || '', p.slug || ''),
    target: projectTarget(p),
    primary: p.name,
    secondary: `${p.providerLabel || plabel(p.provider)} · ${p.rootLabel || ''} · ${p.path || ''}`,
    meta: p.lastActivity ? fmtRelative(p.lastActivity) : '',
    count: p.sessionCount,
    live: isLiveP(p),
    hits,
  })
  const sessRow = (s: SearchTarget, hits?: Hits | null, project?: string | null, metaTs?: string | number | null): SearchAction => {
    const preview = sessionPreviews(s, { showLatestPrompt })[0]
    return {
      kind: 'session',
      key: quickSessionKey(s),
      target: {
        provider: s.provider,
        root: s.root,
        rootLabel: index.labelOf(s.provider || '', s.root || '', s.rootLabel || ''),
        slug: s.slug,
        id: s.id,
        title: s.title,
        project: project || s.project || null,
        cwd: s.cwd || null,
      },
      primary: s.title || String(s.id || '').slice(0, 8),
      secondary: preview?.text || '',
      secondaryHits: preview ? hits?.[preview.hitField] : undefined,
      context: [project || s.project, plabel(s.provider), folderMode ? index.labelOf(s.provider || '', s.root || '', s.rootLabel || '') : null]
        .filter(Boolean)
        .join(' · '),
      meta: metaTs ? fmtRelative(metaTs) : '',
      live: isLiveS(s),
      open: openTabs.has(targetKey(s)),
      oversized: !!s.oversized,
      hits,
    }
  }
  const findProject = (t: Target) => index.projects.find((p) => p.provider === t.provider && p.root === t.root && p.slug === t.slug)
  const pinProjRow = (p: Pin): SearchAction => {
    const hit = findProject(p)
    if (hit) return projRow(hit)
    return {
      kind: 'project',
      key: quickProjectKey(p.provider || '', p.root || '', p.slug || ''),
      target: {
        provider: p.provider,
        root: p.root,
        rootLabel: p.rootLabel,
        slug: p.slug,
        cwd: p.cwd,
        name: p.project || p.slug || '',
        providerLabel: plabel(p.provider) || undefined,
      },
      primary: p.project || p.slug || '',
      secondary: `${plabel(p.provider)} · ${p.rootLabel || ''}`,
      meta: '',
    }
  }
  const groups: SearchGroup[] = []
  const homeMatch = q && 'home'.startsWith(q.toLowerCase()) ? matchFields(q, { title: 'Home' }) : null
  if (!level && (!q || homeMatch))
    groups.push({
      title: 'Navigation',
      rows: [
        {
          kind: 'home',
          key: 'home',
          target: { provider: null, view: 'activity' },
          primary: 'Home',
          secondary: 'Cross-provider overview',
          hits: homeMatch?.hits,
        },
      ],
    })
  const folderProjectRow = (folder: Folder, hits?: Hits | null): SearchAction => ({
    kind: 'folder-project',
    key: folderItemKey(folder.id),
    target: { kind: 'folder', folderId: folder.id, cwd: folder.cwd, name: folder.name, sources: folder.sources },
    primary: folder.name,
    secondary: folder.cwd || undefined,
    context: [...new Set(folder.sources.map((source) => plabel(source.provider)))].join(' · '),
    count: folder.sessionCount,
    hits,
  })
  const writing: SearchAction[] = []
  if (!level && !q && live.ids.size) {
    // Demand only projects with observed writes; use the existing Query-backed
    // index, including sessions not yet opened or added to recent history.
    const demanded = index.projects.filter(isLiveP).flatMap((project) => index.sessionsFor(project.provider, project.root, project.slug) || [])
    const candidates: SearchTarget[] = [
      ...(index.cachedSessions?.() || []),
      ...demanded,
      ...recent,
      ...terminals.filter((terminal) => terminal.id).map((terminal) => ({ ...liveTarget(terminal), at: Number(terminal.startedAt) || 0 })),
    ]
    const unique = new Map<string, SearchTarget>()
    for (const session of candidates) {
      const key = quickSessionKey(session)
      if (session.id && session.provider && session.root && isLiveS(session) && !unique.has(key)) unique.set(key, session)
    }
    writing.push(
      ...[...unique.values()]
        .sort((a, b) => (Number(b.at) || new Date(b.lastTs || 0).getTime() || 0) - (Number(a.at) || new Date(a.lastTs || 0).getTime() || 0))
        .map((session) => {
          const row = sessRow(session, null, session.project, session.lastTs || session.at)
          const terminal = terminals.find((entry) => entry.key && entry.id && quickSessionKey(entry) === row.key)
          return terminal ? { ...row, running: true, target: { ...liveTarget(terminal), ...row.target } } : row
        })
    )
    if (writing.length) groups.push({ title: 'Being written', rows: writing })
  }
  if (folderMode && (foldersError || foldersLoading))
    groups.push({
      title: 'Folder catalog',
      rows: [foldersError ? { kind: 'empty', key: 'folder-error', text: foldersError } : { kind: 'loading', key: 'folder-loading', text: 'Loading folders…' }],
    })
  const writingKeys = new Set(writing.map((row) => row.key))
  const running = terminals
    .filter(
      (t) =>
        t.provider &&
        t.root &&
        t.key &&
        (!t.id || !writingKeys.has(quickSessionKey(t))) &&
        (!level ||
          (sources
            ? sources.some((source) => matchesSource(t, source))
            : t.provider === level.provider && t.root === level.root && (t.slug === level.slug || (level.cwd && t.cwd === level.cwd))))
    )
    .map((t): SearchAction & { match: boolean; at: number } => {
      const target = liveTarget(t)
      const primary = t.title || (t.id ? t.id.slice(0, 8) : 'New conversation')
      const m = q ? matchFields(q, { title: primary, path: t.cwd || t.slug || '', provider: plabel(t.provider) }) : null
      return {
        kind: 'terminal',
        key: 't|' + t.key,
        target,
        primary,
        secondary: [plabel(t.provider), t.cwd || t.slug].filter(Boolean).join(' · '),
        open: openTabs.has(targetKey(target)),
        running: true,
        hits: m?.hits,
        match: !q || !!m,
        at: Number(t.startedAt) || 0,
      }
    })
    .filter((r) => r.match)
    .sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
  if (running.length) groups.push({ title: 'Running terminals', rows: running })
  const runningKeys = new Set(running.map((r) => targetKey(r.target)))

  if (level) {
    const lists = sources
      ? sources.filter((source) => source.slug != null).map((source) => index.sessionsFor(source.provider, source.root, source.slug || ''))
      : [index.sessionsFor(level.provider || '', level.root || '', level.slug || '')]
    const loading = lists.some((list) => list === null) || (!!sources && foldersLoading)
    const list = lists.flatMap((list) => list || []).filter((session) => !runningKeys.has(targetKey(session)))
    if (sources)
      list.sort((a, b) => (new Date(b.lastTs || 0).getTime() || 0) - (new Date(a.lastTs || 0).getTime() || 0) || targetKey(a).localeCompare(targetKey(b)))
    const rows: SearchRow[] = []
    if (loading) rows.push({ kind: 'loading', key: 'loading' })
    {
      let items: SearchRow[]
      if (q) {
        items = list
          .map((s) => ({ s, m: matchFields(q, { title: s.title, latest: s.lastUserPrompt || '', prompt: s.firstPrompt }) }))
          .filter(hasMatch)
          .sort(byScore)
          .map((x) => sessRow(x.s, x.m.hits, level.name, x.s.lastTs))
      } else items = list.map((s) => sessRow(s, null, level.name, s.lastTs))
      rows.push(...items.slice(0, LEVEL_ROWS))
      if (!loading && !items.length && !running.length)
        rows.push({
          kind: 'empty',
          key: 'empty',
          text: sources && !sources.length ? 'No sources match the current folder filters' : q ? 'No matching sessions' : 'No sessions yet',
        })
    }
    if (sources) {
      for (const source of sources)
        rows.push({
          kind: 'new',
          key: quickProjectKey(source.provider, source.root, source.slug || ''),
          target: { ...source, name: level.name, cwd: source.cwd || level.cwd },
          primary: `New conversation · ${plabel(source.provider)}`,
          secondary: source.rootLabel,
        })
    } else rows.push({ kind: 'new', key: 'new', target: level, primary: `New conversation in ${level.name}` })
    groups.push({
      title: sources
        ? `${level.name} · ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`
        : `${level.name} · ${level.providerLabel || plabel(level.provider)} · ${level.rootLabel || ''}`,
      rows,
    })
    return groups
  }

  if (!q) {
    const pinned = pins
      .filter((p) => isFolderPin(p) || (!runningKeys.has(targetKey(p)) && !writingKeys.has(quickSessionKey(p))))
      .map((p) => (isFolderPin(p) ? folderRow(p) : p.id ? sessRow(p, null, p.project, null) : pinProjRow(p)))
    const pinnedKeys = new Set(pinned.map((r) => r.key))
    // recent = sessions only (projects have their own list right below)
    const rec = recent
      .filter((t) => t.id && !runningKeys.has(targetKey(t)) && !writingKeys.has(quickSessionKey(t)))
      .map((t) => sessRow(t, null, t.project, t.at))
      .filter((r) => !pinnedKeys.has(r.key))
      .slice(0, RECENT_ROWS)
    if (rec.length) groups.push({ title: 'Recent sessions', rows: rec })
    if (pinned.length) groups.push({ title: 'Pinned', rows: pinned })
    const projs = folderMode
      ? visibleFolders
          .map((folder) => folderProjectRow(folder))
          .filter((row) => !pinnedKeys.has(row.key))
          .slice(0, RECENT_PROJECT_ROWS)
      : index.projects.slice(0, RECENT_PROJECT_ROWS).map((p) => projRow(p))
    if (projs.length) groups.push({ title: folderMode ? 'Folders' : 'Projects', rows: projs })
    if (!rec.length && !projs.length && !running.length && !writing.length && (!folderMode || (!pinned.length && !foldersError && !foldersLoading)))
      groups.push({
        title: folderMode ? 'Folders' : 'Projects',
        rows: [
          {
            kind: 'empty',
            key: 'empty',
            text: folderMode ? 'No folders match the current filters' : index.loading ? 'Loading projects…' : 'No projects found',
          },
        ],
      })
    return groups
  }

  const folderMatches = pins
    .filter(isFolderPin)
    .map((p) => ({ p, m: matchFields(q, { name: shortPath(p.cwd), path: p.cwd }) }))
    .filter(hasMatch)
    .sort(byScore)
  if (folderMatches.length) groups.push({ title: 'Pinned folders', rows: folderMatches.map(({ p, m }) => ({ ...folderRow(p), hits: m.hits })) })
  const pinnedFolderKeys = new Set(folderMatches.map(({ p }) => pinKey(p)))
  const pm = index.projects
    .filter(allowed)
    .map((p) => ({ p, m: matchFields(q, { name: p.name, path: p.path, root: p.rootLabel, provider: p.providerLabel }) }))
    .filter(hasMatch)
    .sort(byScore)
    .slice(0, MAX_PROJECTS)
  const fm = folderMode
    ? visibleFolders
        .filter((folder) => !pinnedFolderKeys.has(folderItemKey(folder.id)))
        .map((folder) => ({
          folder,
          m: matchFields(q, {
            name: folder.name,
            path: folder.cwd || '',
            provider: folder.sources.map((source) => plabel(source.provider)).join(' '),
            root: folder.sources.map((source) => source.rootLabel).join(' '),
          }),
        }))
        .filter(hasMatch)
        .sort(byScore)
        .slice(0, MAX_PROJECTS)
    : []
  if (folderMode && fm.length) groups.push({ title: 'Folders', rows: fm.map(({ folder, m }) => folderProjectRow(folder, m.hits)) })
  else if (!folderMode && pm.length) groups.push({ title: 'Projects', rows: pm.map((x) => projRow(x.p, x.m.hits)) })

  // session candidates: recent ones + the lists of the best-matching projects
  // (fetched lazily; the switcher re-renders when they land)
  const cands = new Map<string, { s: SearchTarget; project?: string | null; ts?: string | number | null }>()
  for (const t of recent) if (t.id) cands.set(targetKey(t), { s: t, project: t.project, ts: t.at })
  // Search already-loaded lists even when the question does not match a project
  // name. This is not a full-history scan and must not trigger one per keystroke.
  for (const s of index.cachedSessions?.() || []) {
    const p = findProject(s)
    cands.set(targetKey(s), { s: { ...s, rootLabel: p?.rootLabel }, project: p?.name, ts: s.lastTs })
  }
  for (const { p } of pm.slice(0, 3)) {
    const list = index.sessionsFor(p.provider, p.root, p.slug)
    if (!list) continue
    for (const s of list) if (!cands.has(targetKey(s))) cands.set(targetKey(s), { s: { ...s, rootLabel: p.rootLabel }, project: p.name, ts: s.lastTs })
  }
  const sm = [...cands.values()]
    .filter((c) => !runningKeys.has(targetKey(c.s)))
    .map((c) => ({ ...c, m: matchFields(q, { title: c.s.title, latest: c.s.lastUserPrompt || '', prompt: c.s.firstPrompt || '', project: c.project || '' }) }))
    .filter(hasMatch)
    .sort(byScore)
    .slice(0, MAX_SESSIONS)
  if (sm.length) groups.push({ title: 'Sessions', rows: sm.map((x) => sessRow(x.s, x.m.hits, x.project, x.ts)) })
  if (
    !(folderMode ? fm.length : pm.length) &&
    !sm.length &&
    !running.length &&
    !folderMatches.length &&
    !homeMatch &&
    (!folderMode || (!foldersError && !foldersLoading))
  )
    groups.push({ title: 'Results', rows: [{ kind: 'empty', key: 'empty', text: 'Nothing matches' }] })
  return groups

  function folderRow(p: Pin): SearchRow {
    if (foldersLoading) return { kind: 'loading', key: pinKey(p), text: 'Loading pinned folder…' }
    const f = pinnedFolders.find((f) => f.id === p.folderId)
    if (f?.sources.length) return folderProjectRow(f)
    return { kind: 'folder', key: pinKey(p), target: p, primary: shortPath(p.cwd), secondary: p.cwd || undefined, context: f?.pinStatus || 'Show in sidebar' }
  }
}
