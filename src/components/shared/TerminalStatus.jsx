import { useEffect, useState } from 'react'
import { LINK_HINT_MS, terminalStatus } from '../../lib/terminalStatus.js'

export default function TerminalStatus(props) {
  const [delayed, setDelayed] = useState(false)
  useEffect(() => {
    setDelayed(false)
    const timer = setTimeout(() => setDelayed(true), LINK_HINT_MS)
    return () => clearTimeout(timer)
  }, [props.loading, props.running, props.frameLoaded, props.id, props.transcriptReady])
  const text = terminalStatus({ ...props, delayed })
  if (!text) return null
  return <div role="status" aria-live="polite" className="shrink-0 px-3 py-1.5 text-[11px] text-zinc-400 bg-ink-900/70 border-b border-zinc-800/60">{text}</div>
}
