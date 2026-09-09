import { homeSourceEnabled } from './homeScope.js'
import { isFolderPin } from './pins.js'
const sourceId = (s) => JSON.stringify([s.provider, s.root, s.slug || null])
const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
const folderName = (f) => String(f.name || f.cwd || '').split(/[\\/]/).filter(Boolean).at(-1) || ''
const folderOrder = (a, b) => compare(folderName(a), folderName(b)) || compare(String(a.cwd || ''), String(b.cwd || '')) || a.id.localeCompare(b.id)
export const folderNodeKey = (folder, provider, root) => JSON.stringify(['folder', folder, ...(provider == null ? [] : ['provider', provider]), ...(root == null ? [] : ['root', root])])

export function folderTree(folders, drafts = [], scopes = []) {
  const result = folders.map((f) => ({ ...f, sources: f.sources.map((s) => ({ ...s })) }))
  for (const d of drafts) {
    if (!d.cwd || !d.provider || !d.root) continue
    let folder = result.find((f) => f.cwd === d.cwd || f.sources.some((s) => s.cwd === d.cwd))
    if (!folder) {
      folder = { id: `draft:${JSON.stringify([d.provider, d.root, d.cwd])}`, cwd: d.cwd, name: d.project || d.cwd, sources: [], sessionCount: 0, draftOnly: true }
      result.push(folder)
    }
    if (!folder.sources.some((s) => s.provider === d.provider && s.root === d.root && ((!d.slug && s.cwd === d.cwd) || s.slug === d.slug))) {
      folder.sources.push({ provider: d.provider, root: d.root, rootLabel: scopes.find((s) => s.provider === d.provider && s.root === d.root)?.rootLabel || d.rootLabel || d.root, slug: d.slug || null, cwd: d.cwd, sessionCount: 0, draftOnly: true })
    }
  }
  // Stable alphabetical navigation: writes change counts, not row positions.
  for (const f of result) f.sources.sort((a, b) => sourceId(a).localeCompare(sourceId(b)))
  return result.sort(folderOrder)
}

// Read-only projection: hidden sources keep their tracking, tabs and processes.
export function visibleFolderTree(folders, { excludedProviders = [], excludedRoots = [], showUnavailable = false } = {}) {
  return folders.filter((f) => f.resolved || f.draftOnly || showUnavailable).flatMap((f) => {
    const sources = f.sources.filter((s) => homeSourceEnabled(s, { excluded: excludedProviders, excludedRoots }))
    return sources.length ? [{ ...f, sources, sessionCount: sources.reduce((n, s) => n + (s.sessionCount || 0), 0) }] : []
  }).sort(folderOrder)
}

// A folder pin is a live reference, not a snapshot of its provider membership.
// Never reconnect a missing pin by basename or guessed path aliases.
export function resolveFolderReferences(pins, folders, options = {}) {
  const visible = new Map(visibleFolderTree(folders, options).map((f) => [f.id, f]))
  const existing = new Map(folders.map((f) => [f.id, f]))
  return pins.filter(isFolderPin).map((p) => visible.get(p.folderId) || {
    id: p.folderId, cwd: p.cwd, name: p.name, resolved: false, sources: [], sessionCount: 0,
    pinStatus: existing.has(p.folderId) ? 'No sources match the current filters.' : 'Folder unavailable or no longer tracked.',
  })
}
export const resolveFolderPins = resolveFolderReferences

export function providerBranches(folder, providers = []) {
  const branches = new Map()
  for (const source of folder.sources) {
    if (!branches.has(source.provider)) branches.set(source.provider, { provider: source.provider, roots: new Map(), sessionCount: 0 })
    const branch = branches.get(source.provider)
    if (!branch.roots.has(source.root)) branch.roots.set(source.root, { root: source.root, rootLabel: source.rootLabel || source.root, sources: [], sessionCount: 0 })
    const root = branch.roots.get(source.root)
    root.sources.push(source)
    root.sessionCount += source.sessionCount || 0
    branch.sessionCount += source.sessionCount || 0
  }
  const order = (id) => { const i = providers.findIndex((p) => p.id === id); return i < 0 ? providers.length : i }
  return [...branches.values()].map((b) => ({ ...b, roots: [...b.roots.values()].sort((a, b) => compare(a.rootLabel, b.rootLabel) || a.root.localeCompare(b.root)) }))
    .sort((a, b) => order(a.provider) - order(b.provider) || a.provider.localeCompare(b.provider))
}

export function folderAncestorKeys(folders, target) {
  const folder = folders.find((f) => folderHasTarget(f, target))
  if (!folder) return []
  const keys = [folderNodeKey(folder.id)]
  if (target?.provider && target?.root) keys.push(folderNodeKey(folder.id, target.provider), folderNodeKey(folder.id, target.provider, target.root))
  return keys
}

export function folderHasTarget(folder, target) {
  if (!target) return false
  return folder.sources.some((s) => s.provider === target.provider && s.root === target.root &&
    ((s.slug && s.slug === target.slug) || (target.cwd && s.cwd === target.cwd)))
}
