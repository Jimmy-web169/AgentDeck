import crypto from 'node:crypto'

export const isLaunchId = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

export function terminalIdentity(provider, root, { id, launchId } = {}) {
  if (launchId && !isLaunchId(launchId)) throw Object.assign(new Error('invalid launch id'), { status: 400 })
  const launch = id ? null : launchId || crypto.randomUUID()
  return { key: `${provider}|${root}|${id ? `session|${id}` : `launch|${launch}`}`, launchId: launch }
}

// No folder/mtime heuristics: an entry is either an exact terminal alias or an
// observed provider session. Old terminal keys remain usable through this path.
export function findTerminal(entries, provider, root, body) {
  const scoped = entries.filter((e) => e.provider === provider && e.root === root)
  if (body.terminalKey) return scoped.find((e) => e.key === body.terminalKey)
  if (body.launchId) return scoped.find((e) => e.launchId === body.launchId)
  if (body.id) return scoped.find((e) => e.id === body.id)
  if (body.legacyDraft) {
    const candidates = scoped.filter((e) => [body.cwd, body.slug].filter(Boolean).some((p) => e.key === `${root}|new|${p}`))
    const unique = [...new Map(candidates.map((e) => [e.key, e])).values()]
    if (unique.length > 1) throw Object.assign(new Error('Multiple legacy terminals match this folder. Select the exact terminal from Live sessions.'), { status: 409 })
    return unique[0]
  }
  return undefined
}
