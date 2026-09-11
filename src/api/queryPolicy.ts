import type { ChangeEvent } from '../../shared/types.js'
export interface QueryRef {
  provider: string
  root: string
  slug?: string | null
  id?: string | null
  run?: string
  agent?: string
  days?: number
  scope?: string
  kind?: string
  name?: string
}
import { changeBatchKey, homeSourceKey, queryIdentity } from '../../shared/identity.ts'
import { normalizeHomeScope } from '../../shared/homeScope.ts'

export { queryKeys } from '../../shared/identity.ts'

// Provider inventories have a different tuple shape from root-scoped queries.
// Never interpret roots/terminals/active-sessions as a configured root ID.
export function matchesChange(key: readonly unknown[], change: ChangeEvent) {
  const ref = queryIdentity(key)
  if (!ref) return false
  if (ref.owner === 'filesystem') return false
  if (ref.owner === 'deck') {
    if (ref.kind === 'dashboard-attachment') return false
    if (ref.kind !== 'home') return true
    const scope = normalizeHomeScope(ref.scope)
    return !scope.excluded.includes(change.provider) && !scope.excludedRoots?.includes(homeSourceKey(change))
  }
  // Every provider's active-sessions endpoint returns the same global tmux pool.
  if (ref.inventory && ref.kind === 'active-sessions') return true
  if (ref.provider !== change.provider) return false
  if (ref.inventory) return true
  if (ref.root !== change.root) return false
  const kind = ref.kind
  if (['session', 'raw', 'subagents', 'subagent'].includes(String(kind))) {
    // Child events often carry the child's slug, not the parent's: parentId
    // must still invalidate the parent transcript and nested-agent inventory.
    if (change.parentId && ref.id === change.parentId) return true
    return (!change.slug || !ref.slug || ref.slug === change.slug) && (!change.id || ref.id === change.id)
  }
  if (kind === 'sessions') return !change.slug || !ref.slug || ref.slug === change.slug
  return true
}

export function coalesceChanges(changes: ChangeEvent[]) {
  return [...new Map(changes.map((change) => [changeBatchKey(change), change])).values()]
}
