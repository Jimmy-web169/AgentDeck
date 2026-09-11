export interface TerminalPane {
  key: string
  target: Target
}
import type { Target } from '../../shared/types.js'
import { adoptTerminalsFor, sameTarget, targetKey, liveTarget, type Terminal } from './tabs.ts'

// Pane identity belongs to the view, not the provider's late-arriving session ID.
// Never change a mounted pane's key when its launch acquires a saved ID.
export function reconcileTerminalPanes(previous: TerminalPane[], provider: string, target: Target | null, terminals: Terminal[], openTargets: Target[] = []) {
  const entries = terminals.filter((t) => t.provider === provider)
  const wanted = target && (target.id || target.draft) ? { ...target, provider } : null
  const panes = previous.map((p) => ({ ...p, target: adoptTerminalsFor(p.target, entries) }))
  let currentKey = null
  if (wanted) {
    const current = adoptTerminalsFor(wanted, entries)
    const original = previous.find(
      (p) =>
        p.target.root === current.root &&
        ((current.terminalKey && p.target.terminalKey === current.terminalKey) || (current.launchId && p.target.launchId === current.launchId))
    )
    const existing = (original && panes.find((p) => p.key === original.key)) || panes.find((p) => sameTarget(p.target, current))
    if (existing) {
      existing.target = { ...existing.target, ...current }
      currentKey = existing.key
    } else {
      currentKey = targetKey(current)
      panes.push({ key: currentKey, target: current })
    }
  }
  const kept: TerminalPane[] = []
  for (const p of panes) {
    const keep = p.key === currentKey || openTargets.some((t) => sameTarget(p.target, t)) || entries.some((e: Terminal) => sameTarget(p.target, liveTarget(e)))
    if (!keep) continue
    const duplicate = kept.findIndex((other) => sameTarget(other.target, p.target))
    if (duplicate < 0) kept.push(p)
    else if (p.key === currentKey) kept[duplicate] = p
  }
  return { panes: kept, currentKey }
}
