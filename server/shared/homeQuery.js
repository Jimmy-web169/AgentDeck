import fs from 'node:fs'

const bad = (message) => Object.assign(new Error(message), { status: 400 })
export function queryList(q, key) {
  if (!q.has(key)) return null
  let values
  try { values = JSON.parse(q.get(key)) } catch { throw bad(`Invalid ${key}`) }
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'string')) throw bad(`Invalid ${key}`)
  return new Set(values)
}

// Root-native slugs, not guessed path prefixes. An explicit empty set reads no
// projects. Existing source-mode endpoints keep their original default scope.
export const homeProjects = (q) => queryList(q, 'slugs')
const canonical = (p) => { try { return fs.realpathSync.native(p) } catch { return p } }

// Filter BEFORE limiting. Home's aggregator pages a frozen, merged snapshot;
// ordinary provider History still returns its legacy latest 500 rows.
export function homeHistory(rows, q, readError = null, malformed = 0) {
  if (q.get('home') !== '1') return { history: rows.reverse().slice(0, 500) }
  const cwds = queryList(q, 'cwds'), wanted = cwds && new Set([...cwds].map(canonical))
  const paths = new Map()
  let unattributed = 0
  const history = rows.map((h, i) => ({ ...h, rowId: String(i) })).filter((h) => {
    if (typeof h.display !== 'string' || (h.project != null && typeof h.project !== 'string')) { malformed++; return false }
    if (!h.project) { unattributed++; return !wanted }
    if (!paths.has(h.project)) paths.set(h.project, canonical(h.project))
    return !wanted || wanted.has(paths.get(h.project))
  })
  return { history, coverage: { unattributed, malformed, readError } }
}
