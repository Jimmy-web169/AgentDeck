import type { Target, Terminal } from './tabs.ts'
import type { TerminalPane } from './terminalPanes.ts'
import { useEffect, useState } from 'react'
import { reconcileTerminalPanes } from './terminalPanes.ts'

export default function useTerminalPanes(provider: string, target: Target | null, terminals: Terminal[], openTargets: Target[]) {
  const [previous, setPrevious] = useState<TerminalPane[]>([])
  const result = reconcileTerminalPanes(previous, provider, target, terminals, openTargets)
  const signature = JSON.stringify(result.panes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Equal serialized pane metadata must retain the current objects; transient parent renders are not pane transitions.
  useEffect(() => {
    setPrevious((p) => (JSON.stringify(p) === signature ? p : result.panes))
    // The serialized pane metadata, not transient parent render objects,
    // determines whether the retained collection needs an update.
  }, [signature])
  return result
}
