import type { Folder, FolderSource } from '../api/models.ts'
import type { Target } from '../../shared/types.d.ts'
import type { Pin } from './pins.ts'
export interface FolderFilter {
  excludedProviders?: string[]
  excludedRoots?: string[]
  showUnavailable?: boolean
}
import { homeProjectKey, folderNodeKey, draftFolderKey } from '../../shared/identity.ts'
import { homeSourceEnabled } from './homeScope.ts'
import { isFolderPin } from './pins.ts'
const sourceId = (s: FolderSource) => homeProjectKey({ ...s, slug: s.slug || null })
const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
const folderName = (f: Pick<Folder, 'name' | 'cwd'>) =>
  String(f.name || f.cwd || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || ''
const folderOrder = (a: Folder, b: Folder) =>
  compare(folderName(a), folderName(b)) || compare(String(a.cwd || ''), String(b.cwd || '')) || a.id.localeCompare(b.id)
export { folderNodeKey }

export function folderTree(folders: Folder[], drafts: Target[] = [], scopes: { provider: string; root: string; rootLabel?: string }[] = []) {
  const result: Folder[] = folders.map((f) => ({ ...f, sources: f.sources.map((s) => ({ ...s })) }))
  for (const d of drafts) {
    if (!d.cwd || !d.provider || !d.root) continue
    let folder = result.find((f) => f.cwd === d.cwd || f.sources.some((s) => s.cwd === d.cwd))
    if (!folder) {
      folder = {
        id: draftFolderKey({ provider: d.provider, root: d.root, cwd: d.cwd }),
        cwd: d.cwd,
        name: d.project || d.cwd,
        sources: [],
        sessionCount: 0,
        draftOnly: true,
      }
      result.push(folder)
    }
    if (!folder.sources.some((s) => s.provider === d.provider && s.root === d.root && ((!d.slug && s.cwd === d.cwd) || s.slug === d.slug))) {
      folder.sources.push({
        provider: d.provider,
        root: d.root,
        rootLabel: scopes.find((s) => s.provider === d.provider && s.root === d.root)?.rootLabel || d.rootLabel || d.root,
        slug: d.slug || null,
        cwd: d.cwd,
        sessionCount: 0,
        draftOnly: true,
      })
    }
  }
  // Stable alphabetical navigation: writes change counts, not row positions.
  for (const f of result) f.sources.sort((a, b) => sourceId(a).localeCompare(sourceId(b)))
  return result.sort(folderOrder)
}

// Read-only projection: hidden sources keep their tracking, tabs and processes.
export function visibleFolderTree(folders: Folder[], { excludedProviders = [], excludedRoots = [], showUnavailable = false }: FolderFilter = {}) {
  return folders
    .filter((f) => f.resolved || f.draftOnly || showUnavailable)
    .flatMap((f) => {
      const sources = f.sources.filter((s) => homeSourceEnabled(s, { excluded: excludedProviders, excludedRoots }))
      return sources.length ? [{ ...f, sources, sessionCount: sources.reduce((n, s) => n + (s.sessionCount || 0), 0) }] : []
    })
    .sort(folderOrder)
}

// A folder pin is a live reference, not a snapshot of its provider membership.
// Never reconnect a missing pin by basename or guessed path aliases.
export function resolveFolderReferences(pins: Pin[], folders: Folder[], options: FolderFilter = {}): Folder[] {
  const visible = new Map(visibleFolderTree(folders, options).map((f) => [f.id, f]))
  const existing = new Map(folders.map((f) => [f.id, f]))
  return pins.filter(isFolderPin).map(
    (p) =>
      visible.get(p.folderId || '') || {
        id: p.folderId,
        cwd: p.cwd || null,
        name: p.name || p.cwd || '',
        resolved: false,
        sources: [],
        sessionCount: 0,
        pinStatus: existing.has(p.folderId || '') ? 'No sources match the current filters.' : 'Folder unavailable or no longer tracked.',
      }
  )
}
export const resolveFolderPins = resolveFolderReferences

export function providerBranches(folder: Folder, providers: readonly { id: string }[] = []) {
  const branches = new Map<
    string,
    { provider: string; roots: Map<string, { root: string; rootLabel: string; sources: FolderSource[]; sessionCount: number }>; sessionCount: number }
  >()
  for (const source of folder.sources) {
    const branch = branches.get(source.provider) || {
      provider: source.provider,
      roots: new Map<string, { root: string; rootLabel: string; sources: FolderSource[]; sessionCount: number }>(),
      sessionCount: 0,
    }
    branches.set(source.provider, branch)
    const root = branch.roots.get(source.root) || { root: source.root, rootLabel: source.rootLabel || source.root, sources: [], sessionCount: 0 }
    branch.roots.set(source.root, root)
    root.sources.push(source)
    root.sessionCount += source.sessionCount || 0
    branch.sessionCount += source.sessionCount || 0
  }
  const order = (id: string) => {
    const i = providers.findIndex((p) => p.id === id)
    return i < 0 ? providers.length : i
  }
  return [...branches.values()]
    .map((b) => ({ ...b, roots: [...b.roots.values()].sort((a, b) => compare(a.rootLabel, b.rootLabel) || a.root.localeCompare(b.root)) }))
    .sort((a, b) => order(a.provider) - order(b.provider) || a.provider.localeCompare(b.provider))
}

export function folderAncestorKeys(folders: Folder[], target: Target | null) {
  const folder = folders.find((f) => folderHasTarget(f, target))
  if (!folder) return []
  const keys = [folderNodeKey(folder.id)]
  if (target?.provider && target?.root) keys.push(folderNodeKey(folder.id, target.provider), folderNodeKey(folder.id, target.provider, target.root))
  return keys
}

export function folderHasTarget(folder: Folder, target: Target | null) {
  if (!target) return false
  return folder.sources.some(
    (s) => s.provider === target.provider && s.root === target.root && ((s.slug && s.slug === target.slug) || (target.cwd && s.cwd === target.cwd))
  )
}
