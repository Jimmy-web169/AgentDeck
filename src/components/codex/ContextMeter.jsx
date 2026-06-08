import { fmtTokens } from '../../lib/format.js'

// Context window usage for a session. `summary` carries contextWindow and
// lastTokenUsage (from token_count records). Shows "% used" — green/amber/red as
// usage climbs. Renders nothing until usage is known.
export default function ContextMeter({ summary, label = 'context' }) {
  const cw = summary?.contextWindow || 0
  const used = summary?.lastTokenUsage?.input_tokens || 0
  if (!cw || !used) return null
  const usedPct = Math.min(100, Math.round((used / cw) * 100))
  const color = usedPct >= 90 ? 'text-red-300' : usedPct >= 70 ? 'text-amber-300' : 'text-sky-300'
  return (
    <span className={`shrink-0 text-[11px] font-mono ${color}`} title={`context window: ${fmtTokens(used)} of ${fmtTokens(cw)} used`}>
      ⛶ {label} {usedPct}% used
    </span>
  )
}
