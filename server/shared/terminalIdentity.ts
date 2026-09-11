import crypto from 'node:crypto'
import { terminalKey, legacyDraftKey } from '../../shared/identity.ts'

export const isLaunchId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

interface IdentityTarget {
  id?: string | null
  launchId?: string | null
}
interface LookupTarget extends IdentityTarget {
  terminalKey?: string
  legacyDraft?: boolean
  cwd?: string | null
  slug?: string | null
}
interface Entry extends IdentityTarget {
  key?: string
  provider?: string
  root?: string
}
export function terminalIdentity(provider: string, root: string, { id, launchId }: IdentityTarget = {}) {
  if (launchId && !isLaunchId(launchId)) throw Object.assign(new Error('invalid launch id'), { status: 400 })
  const launch = id ? null : launchId || crypto.randomUUID()
  return { key: terminalKey(provider, root, { id, launchId: launch }), launchId: launch }
}

// No folder/mtime heuristics: an entry is either an exact terminal alias or an
// observed provider session. Old terminal keys remain usable through this path.
export function findTerminal<T extends Entry>(entries: T[], provider: string, root: string, body: LookupTarget): (T & { key: string }) | undefined {
  const scoped = entries.filter((e): e is T & { key: string } => e.provider === provider && e.root === root && typeof e.key === 'string' && !!e.key)
  if (body.terminalKey) return scoped.find((e) => e.key === body.terminalKey)
  if (body.launchId) return scoped.find((e) => e.launchId === body.launchId)
  if (body.id) return scoped.find((e) => e.id === body.id)
  if (body.legacyDraft) {
    const candidates = scoped.filter((e) => [body.cwd, body.slug].filter((value): value is string => !!value).some((p) => e.key === legacyDraftKey(root, p)))
    const unique = [...new Map(candidates.map((e) => [e.key, e])).values()]
    if (unique.length > 1)
      throw Object.assign(new Error('Multiple legacy terminals match this folder. Select the exact terminal from Live sessions.'), { status: 409 })
    return unique[0]
  }
  return undefined
}
