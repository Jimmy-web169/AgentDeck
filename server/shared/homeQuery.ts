import fs from 'node:fs'

const bad = (message: string) => Object.assign(new Error(message), { status: 400 })
export function queryList(q: URLSearchParams, key: string): Set<string> | null {
  if (!q.has(key)) return null
  let values: unknown
  try {
    values = JSON.parse(q.get(key) ?? '')
  } catch {
    throw bad(`Invalid ${key}`)
  }
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string')) throw bad(`Invalid ${key}`)
  return new Set(values)
}

// Root-native slugs, not guessed path prefixes. An explicit empty set reads no
// projects. Existing source-mode endpoints keep their original default scope.
export const homeProjects = (q: URLSearchParams) => queryList(q, 'slugs')
const canonical = (p: string) => {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return p
  }
}

// Filter BEFORE limiting. Home's aggregator pages a frozen, merged snapshot;
// ordinary provider History still returns its legacy latest 500 rows.
export function homeHistory<T extends { display?: unknown; project?: unknown }>(rows: T[], q: URLSearchParams, readError: string | null = null, malformed = 0) {
  if (q.get('home') !== '1') return { history: rows.reverse().slice(0, 500) }
  const cwds = queryList(q, 'cwds'),
    wanted = cwds && new Set([...cwds].map(canonical))
  const paths = new Map<string, string>()
  let unattributed = 0
  const history = rows
    .map((h, i) => ({ ...h, rowId: String(i) }))
    .filter((h) => {
      if (typeof h.display !== 'string' || (h.project != null && typeof h.project !== 'string')) {
        malformed++
        return false
      }
      if (!h.project) {
        unattributed++
        return !wanted
      }
      if (!paths.has(h.project)) paths.set(h.project, canonical(h.project))
      const normalized = paths.get(h.project)
      return !wanted || (normalized !== undefined && wanted.has(normalized))
    })
  return { history, coverage: { unattributed, malformed, readError } }
}
