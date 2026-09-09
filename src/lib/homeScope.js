// Shared normalization for read queries and legacy Home links. The sidebar is
// authoritative for the current mode; old per-tab filters never override it.
export function normalizeHomeScope(value) {
  const excludedRoots = [...new Set((Array.isArray(value?.excludedRoots) ? value.excludedRoots : []).filter((key) => {
    try { const pair = JSON.parse(key); return Array.isArray(pair) && pair.length === 2 && pair.every((v) => typeof v === 'string' && v) && JSON.stringify(pair) === key } catch { return false }
  }))].sort()
  return {
    excluded: [...new Set((Array.isArray(value?.excluded) ? value.excluded : []).filter((p) => typeof p === 'string' && p))].sort(),
    ...(excludedRoots.length ? { excludedRoots } : {}),
  }
}
export const homeSourceKey = (source) => JSON.stringify([source.provider, source.root])
export const homeSourceEnabled = (source, scope) => !scope.excluded?.includes(source.provider) && !scope.excludedRoots?.includes(homeSourceKey(source))

// Provider chips toggle the whole group; root chips toggle one exact account.
// Expanding a legacy provider exclusion before a root toggle preserves siblings.
export function toggleHomeFilter(scope, sources, provider, root) {
  const current = normalizeHomeScope(scope)
  const excluded = new Set(current.excluded), roots = new Set(current.excludedRoots)
  const group = sources.filter((s) => s.provider === provider)
  const enabled = group.some((s) => homeSourceEnabled(s, current))
  if (root == null) {
    if (enabled) excluded.add(provider)
    else { excluded.delete(provider); group.forEach((s) => roots.delete(homeSourceKey(s))) }
  } else {
    if (excluded.delete(provider)) group.forEach((s) => roots.add(homeSourceKey(s)))
    const key = homeSourceKey({ provider, root })
    if (!roots.delete(key)) roots.add(key)
  }
  return normalizeHomeScope({ excluded: [...excluded], excludedRoots: [...roots] })
}
export function normalizeHomeSource(value) {
  return typeof value?.provider === 'string' && value.provider && typeof value.root === 'string' && value.root
    ? { provider: value.provider, root: value.root, ...(typeof value.rootLabel === 'string' ? { rootLabel: value.rootLabel } : {}) } : null
}
export function resolveHomePresentation(prefs, target, sidebarScope) {
  const folderMode = prefs.sidebarMode === 'folder'
  const explicitSource = folderMode && ['resources', 'plugins'].includes(target?.view) ? normalizeHomeSource(target?.homeSource) : null
  return {
    explicitSource,
    // Session -> Stats deep links retain the native provider/root drill-down.
    integrated: folderMode && !explicitSource && !target?.focus?.id,
    homeScope: normalizeHomeScope({ excluded: prefs.folderExcludedProviders, excludedRoots: prefs.folderExcludedRoots }),
    scope: explicitSource || sidebarScope,
  }
}
export function homeQuery(view, scope, { search = '' } = {}) {
  const normalized = normalizeHomeScope(scope)
  return new URLSearchParams({ view, excluded: JSON.stringify(normalized.excluded), ...(normalized.excludedRoots ? { excludedRoots: JSON.stringify(normalized.excludedRoots) } : {}), ...(search ? { search } : {}) }).toString()
}
