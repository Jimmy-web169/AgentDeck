import { useEffect } from 'react'

export default function BackgroundTerminalNotice({ targets, onDismiss, onReopen }) {
  useEffect(() => {
    if (!targets?.length) return
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [targets, onDismiss])
  if (!targets?.length) return null
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 max-w-[92vw] rounded-lg border border-zinc-700 bg-ink-800 px-4 py-3 shadow-xl text-xs text-zinc-300">
      <span role="status" aria-live="polite">{targets.length === 1 ? 'Tab closed. Terminal is still running; find it in Live.' : `Tabs closed. ${targets.length} terminals are still running; find them in Live.`}</span>
      <button onClick={onReopen} className="shrink-0 text-sky-300 hover:text-sky-200">{targets.length === 1 ? 'Reopen' : 'View Live'}</button>
      <button onClick={onDismiss} aria-label="Dismiss notification" className="shrink-0 text-zinc-400">✕</button>
    </div>
  )
}
