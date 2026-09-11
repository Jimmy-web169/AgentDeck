export function normalizeHomeScope(input: unknown): { excluded: string[]; excludedRoots?: string[] } {
  const value = input as { excluded?: unknown; excludedRoots?: unknown } | null | undefined
  const excludedRoots = [
    ...new Set(
      (Array.isArray(value?.excludedRoots) ? value.excludedRoots : []).filter((key) => {
        try {
          const pair = JSON.parse(key)
          return Array.isArray(pair) && pair.length === 2 && pair.every((v) => typeof v === 'string' && v) && JSON.stringify(pair) === key
        } catch {
          return false
        }
      })
    ),
  ].sort()
  return {
    excluded: [...new Set((Array.isArray(value?.excluded) ? value.excluded : []).filter((p) => typeof p === 'string' && p))].sort(),
    ...(excludedRoots.length ? { excludedRoots } : {}),
  }
}

export function normalizeHomeSource(input: unknown) {
  const value = input as { provider?: unknown; root?: unknown; rootLabel?: unknown } | null | undefined
  return typeof value?.provider === 'string' && value.provider && typeof value.root === 'string' && value.root
    ? { provider: value.provider, root: value.root, ...(typeof value.rootLabel === 'string' ? { rootLabel: value.rootLabel } : {}) }
    : null
}
