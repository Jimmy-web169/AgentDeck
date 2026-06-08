import { fmtRelative } from '../../lib/format.js'

// Account-level Codex usage limits for the top bar. `usage` is the newest
// rate_limits snapshot: { primary (5-hour), secondary (weekly) } each with
// used_percent, window_minutes, and either resets_at (unix seconds) or
// resets_in_seconds (relative to the snapshot's `ts`). This data is NOT live —
// it's whatever the last session wrote — so we surface its age, and when a
// window has already reset since the reading we show ↺ instead of a stale %.

const textColor = (p) => (p >= 80 ? 'text-red-300' : p >= 50 ? 'text-amber-300' : 'text-emerald-300')
const barColor = (p) => (p >= 80 ? 'bg-red-400' : p >= 50 ? 'bg-amber-400' : 'bg-emerald-400')
const winLabel = (m) => (!m ? '·' : m >= 10080 ? '7d' : m >= 1440 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 60)}h`)

// when (epoch ms) does this window reset? supports both snapshot shapes
function resetAtMs(w, ts) {
  if (typeof w.resets_at === 'number') return w.resets_at * 1000
  if (typeof w.resets_in_seconds === 'number' && ts) return new Date(ts).getTime() + w.resets_in_seconds * 1000
  return null
}

function fmtIn(ms) {
  const secs = Math.floor((ms - Date.now()) / 1000)
  if (secs <= 0) return 'now'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h ? `${h}h ` : ''}${m}m`
}

function Meter({ w, ts }) {
  if (!w || typeof w.used_percent !== 'number') return null
  const p = Math.round(w.used_percent)
  const label = winLabel(w.window_minutes)
  const rms = resetAtMs(w, ts)
  // the reading's window has already reset → the % is stale; real quota is freed
  const reset = rms != null && rms < Date.now()
  const age = ts ? fmtRelative(ts) : 'unknown'
  const title = reset
    ? `${label} limit · this reading's window has reset since ${age} — your real usage is now lower`
    : `${label} limit · ${p}% used as of ${age}${rms ? ` · resets in ${fmtIn(rms)}` : ''}`
  return (
    <span className="flex items-center gap-1" title={title}>
      <span className="text-zinc-500">{label}</span>
      <span className="w-10 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
        <span className={`block h-full ${reset ? 'bg-zinc-600' : barColor(p)}`} style={{ width: `${reset ? 0 : Math.min(100, p)}%` }} />
      </span>
      <span className={`font-mono ${reset ? 'text-zinc-500' : textColor(p)}`}>{reset ? '↺' : `${p}%`}</span>
    </span>
  )
}

export default function RateLimitsBar({ usage, ts }) {
  if (!usage || (!usage.primary && !usage.secondary)) return null
  const age = ts ? fmtRelative(ts) : null
  return (
    <div
      className="flex items-center gap-3 text-[11px]"
      title={`Codex usage — newest snapshot from your sessions${age ? `, as of ${age}` : ''} (not live)`}
    >
      <Meter w={usage.primary} ts={ts} />
      <Meter w={usage.secondary} ts={ts} />
    </div>
  )
}
