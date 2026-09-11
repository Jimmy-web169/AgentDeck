export type Source = { provider: string; root: string }

export type Target = import('../../shared/types.js').Target

import { normalizeHomeScope, normalizeHomeSource } from '../../shared/homeScope.ts'
import { homeSourceKey } from '../../shared/identity.ts'
export { normalizeHomeScope, normalizeHomeSource, homeSourceKey }

export const homeSourceEnabled = (source: Source, scope: { excluded?: string[]; excludedRoots?: string[] }) =>
  !scope.excluded?.includes(source.provider) && !scope.excludedRoots?.includes(homeSourceKey(source))

// Provider chips toggle the whole group; root chips toggle one exact account.
// Expanding a legacy provider exclusion before a root toggle preserves siblings.
export function toggleHomeFilter(scope: unknown, sources: Source[], provider: string, root?: string | null) {
  const current = normalizeHomeScope(scope)
  const excluded = new Set(current.excluded),
    roots = new Set(current.excludedRoots)
  const group = sources.filter((s) => s.provider === provider)
  const enabled = group.some((s) => homeSourceEnabled(s, current))
  if (root == null) {
    if (enabled) excluded.add(provider)
    else {
      excluded.delete(provider)
      group.forEach((s) => {
        roots.delete(homeSourceKey(s))
      })
    }
  } else {
    if (excluded.delete(provider))
      group.forEach((s) => {
        roots.add(homeSourceKey(s))
      })
    const key = homeSourceKey({ provider, root })
    if (!roots.delete(key)) roots.add(key)
  }
  return normalizeHomeScope({ excluded: [...excluded], excludedRoots: [...roots] })
}
export function resolveHomePresentation(
  prefs: { sidebarMode: string; folderExcludedProviders?: string[]; folderExcludedRoots?: string[] },
  target: Target | null,
  sidebarScope: Source | null
) {
  const folderMode = prefs.sidebarMode === 'folder'
  const explicitSource = folderMode && ['resources', 'plugins'].includes(target?.view || '') ? normalizeHomeSource(target?.homeSource) : null
  return {
    explicitSource,
    // Session -> Stats deep links retain the native provider/root drill-down.
    integrated: folderMode && !explicitSource && !target?.focus?.id,
    homeScope: normalizeHomeScope({ excluded: prefs.folderExcludedProviders, excludedRoots: prefs.folderExcludedRoots }),
    scope: explicitSource || sidebarScope,
  }
}
export function homeQuery(view: string, scope: unknown, { search = '' } = {}) {
  const normalized = normalizeHomeScope(scope)
  return new URLSearchParams({
    view,
    excluded: JSON.stringify(normalized.excluded),
    ...(normalized.excludedRoots ? { excludedRoots: JSON.stringify(normalized.excludedRoots) } : {}),
    ...(search ? { search } : {}),
  }).toString()
}
