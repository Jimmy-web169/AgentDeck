import { useEffect, useState } from 'react'
import { LINK_HINT_MS, terminalStatus, canRepairConversation } from '../../lib/terminalStatus.js'

export default function TerminalStatus(props) {
  const [delayed, setDelayed] = useState(false)
  useEffect(() => {
    setDelayed(false)
    const timer = setTimeout(() => setDelayed(true), LINK_HINT_MS)
    return () => clearTimeout(timer)
  }, [props.loading, props.running, props.frameLoaded, props.id, props.transcriptReady, props.terminalKey])
  const text = terminalStatus({ ...props, delayed })
  if (!text) return null
  return <div className="shrink-0 px-3 py-1.5 text-[11px] text-zinc-400 bg-ink-900/70 border-b border-zinc-800/60">
    <span role="status" aria-live="polite">{text}</span>
    {canRepairConversation({ ...props, delayed }) && <details className="mt-1">
      <summary className="cursor-pointer text-zinc-500">Trouble detecting this conversation?</summary>
      <div className="mt-2">{props.repair}</div>
    </details>}
  </div>
}
