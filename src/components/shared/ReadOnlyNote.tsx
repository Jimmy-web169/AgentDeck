import InfoDot from './InfoDot.tsx'

// A quiet "read-only" badge with the reason one hover away. Used wherever
// AgentDeck shows something another program owns (Codex's memories, agy's
// config and artifacts), so nobody looks for an edit button that is not there.
export default function ReadOnlyNote({ why, className = '' }: { why?: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 align-middle ${className}`}>
      <span className="text-[9.5px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">read-only</span>
      {why && <InfoDot text={why} align="left" />}
    </span>
  )
}
