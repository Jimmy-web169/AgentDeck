// Account usage limits for the top bar. `usage` is Claude Code's rate_limits
// object (bridged from the status line — see README): { five_hour, seven_day }
// each with used_percentage + resets_at (unix seconds).

const textColor = (p) => (p >= 80 ? 'text-red-300' : p >= 50 ? 'text-amber-300' : 'text-emerald-300')
const barColor = (p) => (p >= 80 ? 'bg-red-400' : p >= 50 ? 'bg-amber-400' : 'bg-emerald-400')

function fmtReset(resetsAt) {
  if (!resetsAt) return ''
  const secs = resetsAt - Math.floor(Date.now() / 1000)
  if (secs <= 0) return 'resetting…'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `resets in ${h ? `${h}h ` : ''}${m}m`
}

function Meter({ label, w }) {
  if (!w || typeof w.used_percentage !== 'number') return null
  const p = Math.round(w.used_percentage)
  return (
    <span className="flex items-center gap-1" title={`${label} limit · ${p}% used · ${fmtReset(w.resets_at)}`}>
      <span className="text-zinc-500">{label}</span>
      <span className="w-10 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <span className={`block h-full ${barColor(p)}`} style={{ width: `${Math.min(100, p)}%` }} />
      </span>
      <span className={`font-mono ${textColor(p)}`}>{p}%</span>
    </span>
  )
}

export default function RateLimitsBar({ usage }) {
  if (!usage || (!usage.five_hour && !usage.seven_day)) return null
  return (
    <div className="flex items-center gap-3 text-[11px]" title="Claude usage limits — bridged from your status line">
      <Meter label="5h" w={usage.five_hour} />
      <Meter label="7d" w={usage.seven_day} />
    </div>
  )
}
