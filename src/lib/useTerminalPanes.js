import { useEffect, useState } from 'react'
import { reconcileTerminalPanes } from './terminalPanes.js'

export default function useTerminalPanes(provider, target, terminals, openTargets) {
  const [previous, setPrevious] = useState([])
  const result = reconcileTerminalPanes(previous, provider, target, terminals, openTargets)
  const signature = JSON.stringify(result.panes)
  useEffect(() => {
    setPrevious((p) => JSON.stringify(p) === signature ? p : result.panes)
    // The serialized pane metadata, not transient parent render objects,
    // determines whether the retained collection needs an update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  return result
}
