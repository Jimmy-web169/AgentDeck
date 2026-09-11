import { useEffect, useState } from 'react'
import { LINK_HINT_MS } from '../../lib/terminalStatus.ts'

export default function ConversationPending({
  target,
  error,
  onRetry,
}: {
  target: import('../../../shared/types.d.ts').Target | null
  error?: string | null
  onRetry?: () => void
}) {
  const [delayed, setDelayed] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: These identity and lifecycle fields restart the delay when the displayed conversation or terminal changes.
  useEffect(() => {
    setDelayed(false)
    const timer = setTimeout(() => setDelayed(true), LINK_HINT_MS)
    return () => clearTimeout(timer)
  }, [target?.root, target?.id, target?.launchId, target?.terminalKey])
  const saved = !!target?.id
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 py-8">
      <div role="status" aria-live="polite" className="text-sm text-zinc-400">
        {error
          ? 'Conversation record unavailable'
          : saved
            ? delayed
              ? 'Still waiting for the conversation record'
              : 'Loading conversation record…'
            : 'New conversation'}
      </div>
      <p className="text-xs text-zinc-500 max-w-md">
        {saved
          ? 'Record loading does not block opening or using the terminal below.'
          : 'Start or use the terminal below. This area updates when the provider saves a conversation record.'}
      </p>
      {delayed && !saved && target?.terminalKey && (
        <p className="text-xs text-zinc-400 max-w-md">
          No conversation record detected yet. You can keep using the terminal; this view will sync automatically when the record appears.
        </p>
      )}
      {saved && (error || delayed) && onRetry && (
        <button type="button" onClick={onRetry} className="text-xs text-sky-300 hover:text-sky-200">
          Retry loading record
        </button>
      )}
    </div>
  )
}
