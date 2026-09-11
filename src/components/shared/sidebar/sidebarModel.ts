import type { Workspace, WorkspaceItem } from '../../../lib/workspaces.ts'
import type { FolderCatalog } from '../../../api/models.ts'
import type { SidebarSession } from './rows.tsx'
import type { MenuItem } from '../RowMenu.tsx'
import { shortPath } from '../../../lib/paths.ts'
import { standaloneWorkspaceItems, projectKey, normCwd, sourceKey, rememberAdoption } from '../../../lib/workspaces.ts'
import { providerLabel, providerColor } from '../../../lib/providerColors.ts'
import type { Target } from '../../../../shared/types.js'
import type useNavIndex from '../../../api/useNavIndex.ts'
import type { ShellProvider } from '../../../lib/useShellNavigation.ts'

type Source = WorkspaceItem
type Member = WorkspaceItem
type NavIndex = ReturnType<typeof useNavIndex>
interface Row {
  s: SidebarSession
  item: Member
}
interface Group {
  key: string
  src: Source
  item: Member
  partial: boolean
  rows: Row[]
  seen: Set<string>
  latest?: string | number
}

export function workspaceNames({ workspaces }: { workspaces: Workspace[] }) {
  const count = new Map<string, number>()
  for (const w of workspaces) count.set(w.name, (count.get(w.name) || 0) + 1)
  const out = new Map<string, string>()
  for (const w of workspaces) {
    const cwds = new Set(
      w.items
        .map((it) =>
          String(it.cwd || '')
            .replace(/[\\/]+$/, '')
            .toLowerCase()
        )
        .filter(Boolean)
    )
    const only = cwds.size === 1 ? w.items.find((it) => it.cwd)?.cwd : null
    out.set(w.id, (count.get(w.name) || 0) > 1 && only ? shortPath(only, 2) : w.name)
  }
  return out
}

export function workspaceGroups(
  w: Workspace,
  { folderCatalog, index, srcL }: { folderCatalog: Pick<FolderCatalog, 'folders'>; index: NavIndex; srcL: (item: Member) => Source }
) {
  const members: Member[] = standaloneWorkspaceItems(w, folderCatalog.folders)
  const groups = new Map<string, Group>()
  let loading = false
  let untracked = 0
  const tracked = (it: Member) => index.scopes.some((x) => x.provider === it.provider && x.root === it.root)
  const groupFor = (it: Member, partial: boolean) => {
    const k = projectKey(it)
    let g = groups.get(k)
    if (!g) {
      g = { key: k, src: srcL(it), item: it, partial, rows: [], seen: new Set() }
      groups.set(k, g)
    } else if (!partial) {
      g.partial = false
      g.item = it
    }
    return g
  }
  for (const it of members) {
    if (it.kind !== 'project') continue
    if (!tracked(it)) {
      untracked++
      continue
    }
    const g = groupFor(it, false)
    const lst = index.sessionsFor(it.provider || '', it.root || '', it.slug || '')
    if (lst === null) {
      loading = true
      continue
    }
    for (const s of lst) {
      if (g.seen.has(s.id)) continue
      g.seen.add(s.id)
      g.rows.push({ s, item: it })
    }
  }
  for (const it of members) {
    if (it.kind !== 'session' || !it.id) continue
    if (!tracked(it)) {
      untracked++
      continue
    }
    const g = groupFor(it, true)
    if (g.seen.has(it.id)) continue
    g.seen.add(it.id)
    const lst = index.sessionsFor(it.provider || '', it.root || '', it.slug || '')
    const fresh = lst?.find((x) => x.id === it.id)
    g.rows.push({ s: fresh || { id: it.id, title: it.title || it.id.slice(0, 8), lastTs: null, toolCalls: undefined }, item: it })
  }
  const byTime = (a: Row, b: Row) => String(b.s.lastTs || '').localeCompare(String(a.s.lastTs || ''))
  const out = [...groups.values()]
  for (const g of out) {
    g.rows.sort(byTime)
    g.latest = g.rows[0]?.s.lastTs || ''
  }
  out.sort((a, b) => String(b.latest).localeCompare(String(a.latest)))
  return { groups: out, loading, untracked }
}

export function conversationActions(
  src: Source,
  {
    onOpenTarget,
    draftTarget,
    index,
    folderMode,
    folderCatalog,
    providers,
  }: {
    onOpenTarget: (target: Target) => void
    draftTarget: (target: Target) => Target
    index: NavIndex
    folderMode: boolean
    folderCatalog: Pick<FolderCatalog, 'folders'>
    providers: readonly ShellProvider[]
  }
) {
  const items: MenuItem[] = [
    {
      label: 'New conversation here',
      onClick: () =>
        onOpenTarget(draftTarget({ provider: src.provider, root: src.root, rootLabel: src.rootLabel, slug: src.slug, cwd: src.cwd, project: src.project })),
    },
  ]
  if (!src.cwd) return items
  const others = index.scopes.filter((x) => !(x.provider === src.provider && x.root === src.root))
  if (!others.length) return items
  const cwdKey = normCwd(src.cwd)
  const canonicalFolder = folderMode
    ? folderCatalog.folders.find((f) => f.sources.some((s) => s.provider === src.provider && s.root === src.root && s.slug === src.slug))
    : null
  const children = others.map((x) => {
    const canonicalSource = canonicalFolder?.sources.find((s) => s.provider === x.provider && s.root === x.root)
    const existing = index.projects.find(
      (p) =>
        p.provider === x.provider &&
        p.root === x.root &&
        (folderMode ? (canonicalSource ? p.slug === canonicalSource.slug : p.cwd === src.cwd) : p.cwd && normCwd(p.cwd) === cwdKey)
    )
    const n = existing?.sessionCount || 0
    return {
      key: sourceKey(x),
      label: providerLabel(providers, x.provider),
      sub: x.rootLabel,
      dot: providerColor(providers, x.provider).dot,
      tag: existing ? `${n} session${n === 1 ? '' : 's'}` : 'new here',
      title: existing
        ? `${src.cwd}\nalready a project in ${providerLabel(providers, x.provider)} · ${x.rootLabel} — the conversation joins it`
        : `${src.cwd}\nnot opened with ${providerLabel(providers, x.provider)} · ${x.rootLabel} yet — the project appears once the first conversation is written`,
      onClick: () => {
        const t: Target = { provider: x.provider, root: x.root, rootLabel: x.rootLabel, cwd: src.cwd, project: existing?.name || src.project }
        if (existing) t.slug = existing.slug
        else if (src.cwd) rememberAdoption(src, x, src.cwd)
        onOpenTarget(draftTarget(t))
      },
    }
  })
  items.push({ label: 'New conversation here with…', children })
  return items
}
