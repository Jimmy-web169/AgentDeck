import { useEffect, useMemo, useState } from 'react'
import { createApi } from '../../api.js'
import HandoffDialog, { HandoffButton } from './HandoffDialog.jsx'
import { fmtRelative } from '../../lib/format.js'
import { shortPath, projectName } from '../../lib/paths.js'
import { usePrefs } from '../../lib/prefs.js'

// Home › Insights — a personal read of how you work with your coding agents in
// one tracked folder: a plain-English digest of the last 30 days with a persona
// chip, five glanceable tiles (active days, streak, week-over-week, session
// length, prompts per session), a 12-week heatmap, weekly rhythm, hour/weekday
// peaks, session shape and the projects you have let go quiet. It deliberately
// repeats nothing from Home › Stats (no tokens, tool bars or model lists).
// Every mark is one hue over the chart surface, every number lives in a text
// token, every mark has a hover title, and the weekly chart has a table view.
// "Copy digest" puts the narrative + numbers on the clipboard as Markdown.
//
// Data: GET /api/<provider>/activity?root=&days=84. The newer fields
// (sessionsDetail, weekly, compare, rhythm, neglected) may be missing on an
// older backend — everything below falls back to what `daily` can tell us.

const HEAT_WEEKS = 12
const WINDOW = 30 // days covered by the hero + tiles
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0] // display order for the weekday bars (data is 0 = Sunday)
const DUR_LABELS = ['<5m', '5–15m', '15–45m', '45m–2h', '>2h']
const PROMPT_LABELS = ['1–2', '3–5', '6–10', '11–20', '>20']
const PART_PHRASE = { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' }
const PART_PERSONA = { morning: 'Early bird', afternoon: 'Afternoon builder', evening: 'Evening coder', night: 'Night owl' }

// ---------- tiny formatting helpers ----------
const plural = (n, w) => `${n ?? 0} ${w}${n === 1 ? '' : 's'}`
const pct = (x) => `${Math.round((x || 0) * 100)}%`
const hh = (h) => `${String(h).padStart(2, '0')}:00`
const num1 = (x) => (x == null || isNaN(x) ? '—' : Number(x) >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10))
const parseDay = (iso) => new Date(`${iso}T00:00:00`)
const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
const shortDate = (iso) => {
  const [, m, d] = String(iso || '').split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : String(iso || '')
}
const fmtDur = (min) => {
  if (min == null || isNaN(min)) return '—'
  const m = Math.round(min)
  if (m < 1) return '<1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`
}
const fmtDurCap = (m) => (m >= 12 * 60 ? `${fmtDur(m)}+` : fmtDur(m)) // durations are clamped at 12h server-side

const deltaText = (d) => (d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '± 0')
const argmax = (arr) => {
  let best = 0
  let at = null
  arr.forEach((v, i) => {
    if (v > best) {
      best = v
      at = i
    }
  })
  return at
}
// sequential steps of one hue over the chart surface (0 = none)
const heat = (v, max) => {
  if (!v) return 'bg-ink-700'
  const r = v / Math.max(1, max)
  if (r < 0.25) return 'bg-emerald-500/25'
  if (r < 0.5) return 'bg-emerald-500/45'
  if (r < 0.75) return 'bg-emerald-500/70'
  return 'bg-emerald-500/95'
}

// ---------- derivations (with fallbacks for older backends) ----------
function deriveWeekly(daily) {
  const map = new Map()
  for (const d of daily) {
    const dt = parseDay(d.date)
    const mon = new Date(dt)
    mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)) // back to Monday
    const key = isoDate(mon)
    const w = map.get(key) || { weekStart: key, sessions: 0, prompts: 0, activeDays: 0, projects: null }
    w.sessions += d.sessions || 0
    w.prompts += d.prompts || 0
    w.activeDays += d.sessions ? 1 : 0
    map.set(key, w)
  }
  return [...map.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
}

function deriveCompare(daily) {
  const sum = (rows) => rows.reduce((a, d) => ({ sessions: a.sessions + (d.sessions || 0), prompts: a.prompts + (d.prompts || 0), activeDays: a.activeDays + (d.sessions ? 1 : 0) }), { sessions: 0, prompts: 0, activeDays: 0 })
  return { thisWeek: sum(daily.slice(-7)), lastWeek: sum(daily.slice(-14, -7)) }
}

function heatGrid(daily) {
  if (!daily.length) return { weeks: [], months: [], max: 1 }
  const max = Math.max(1, ...daily.map((d) => d.sessions || 0))
  const firstDow = parseDay(daily[0].date).getDay()
  const cells = [...Array(firstDow).fill(null), ...daily]
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const monthOf = (w) => {
    const d = w.find(Boolean)
    return d ? parseDay(d.date).getMonth() : null
  }
  // label a column when its month differs from the previous column's; skip the
  // very first column if the month changes again right after (labels would collide)
  const months = weeks.map((w, i) => {
    const m = monthOf(w)
    if (m == null) return ''
    if (i > 0 && m === monthOf(weeks[i - 1])) return ''
    if (i === 0 && weeks.length > 1 && monthOf(weeks[1]) !== m) return ''
    return MONTHS[m]
  })
  return { weeks, months, max }
}

// Persona chip — one label for how this person tends to work. Weekend-heavy
// beats time-of-day (rarer, more defining); a time-of-day part only earns a
// chip when it clearly dominates; otherwise fall back to weekday/all-hours.
function personaOf(rhythm, totals) {
  if (!totals?.sessions || !rhythm) return null
  const share = Number(rhythm.share) || 0
  const weekendShare = Number(rhythm.weekendShare) || 0
  if (weekendShare >= 0.5) return { label: 'Weekend coder', why: `${pct(weekendShare)} of sessions land on weekends` }
  if (rhythm.part && PART_PERSONA[rhythm.part] && share >= 0.45) return { label: PART_PERSONA[rhythm.part], why: `${pct(share)} of sessions ${PART_PHRASE[rhythm.part]}` }
  if (weekendShare < 0.1) return { label: 'Weekday regular', why: `${pct(1 - weekendShare)} of sessions on weekdays` }
  return { label: 'All-hours builder', why: 'no single time of day or week dominates' }
}

// Narrative — sentences as segment arrays ({ t, k }) so the hero can emphasise
// the numbers and the Markdown digest can bold the same ones.
const T = (t) => ({ t })
const K = (t) => ({ t, k: true })
function sentence(clauses) {
  const out = []
  clauses.forEach((c, i) => {
    if (i > 0) out.push(T(i === clauses.length - 1 ? (clauses.length > 2 ? ', and ' : ' and ') : ', '))
    out.push(...c)
  })
  if (!out.length) return null
  out[0] = { ...out[0], t: out[0].t.charAt(0).toUpperCase() + out[0].t.slice(1) }
  out.push(T('.'))
  return out
}

function narrative({ active30, sessions30, totals, streak, busiest, rhythm, sd, lastActive }) {
  if (!totals.sessions) {
    return [[T(`No agent sessions in the last ${HEAT_WEEKS} weeks for this folder. Once you start working here, this page fills in with your rhythm, streaks and session shape.`)]]
  }
  const out = []

  // 1 — how many days, and when in the day
  if (active30 === 0) {
    out.push(lastActive ? [T(`Nothing in the last ${WINDOW} days — your last session here was on `), K(lastActive), T('.')] : [T(`Nothing in the last ${WINDOW} days.`)])
  } else {
    const s1 = [T('You worked with agents on '), K(`${active30} of the last ${WINDOW} days`), T(` (${plural(sessions30, 'session')})`)]
    if (rhythm?.part && PART_PHRASE[rhythm.part] && rhythm.share >= 0.35) s1.push(T(', mostly '), K(PART_PHRASE[rhythm.part]), T(` (${pct(rhythm.share)} of sessions)`))
    s1.push(T('.'))
    out.push(s1)
  }

  // 2 — busiest weekday, weekend habit, streak
  const clauses = []
  if (busiest.weekday != null) clauses.push([K(`${WEEKDAYS_LONG[busiest.weekday]}s`), T(' are your busiest day')])
  if (rhythm && typeof rhythm.weekendShare === 'number') {
    const ws = rhythm.weekendShare
    clauses.push(ws >= 0.5 ? [T('most of your sessions land on weekends '), T(`(${pct(ws)})`)] : ws < 0.1 ? [T(`you rarely work weekends (${pct(ws)})`)] : [T(`${pct(ws)} of sessions land on weekends`)])
  }
  if (streak.current >= 2) clauses.push([T("you're on a "), K(`${streak.current}-day streak`), T(streak.longest > streak.current ? ` (longest ${streak.longest})` : ' — your longest yet')])
  const s2 = sentence(clauses)
  if (s2) out.push(s2)

  // 3 — session shape
  if (sd?.count) {
    const bits = []
    const tp = sd.medianPrompts ?? sd.avgPrompts
    const td = sd.medianDurationMin ?? sd.avgDurationMin
    if (tp != null) bits.push(K(`${num1(tp)} prompts`))
    if (td != null) bits.push(K(fmtDur(td)))
    if (bits.length) {
      const s3 = [T('A typical session runs ')]
      bits.forEach((b, i) => {
        if (i) s3.push(T(' and '))
        s3.push(b)
      })
      if (sd.longest?.minutes != null) s3.push(T('; the longest was '), K(fmtDurCap(sd.longest.minutes)), T(' in '), K(shortPath(sd.longest.cwd || sd.longest.slug)), T(sd.longest.date ? ` on ${sd.longest.date}` : ''))
      s3.push(T('.'))
      out.push(s3)
    }
  }
  return out
}

function derive(data) {
  const daily = Array.isArray(data.daily) ? data.daily : []
  const last30 = daily.slice(-WINDOW)
  const active30 = last30.filter((d) => d.sessions > 0).length
  const sessions30 = last30.reduce((a, d) => a + (d.sessions || 0), 0)
  const totals = data.totals || { sessions: 0, prompts: 0, toolCalls: 0, tokens: 0, activeDays: 0 }
  const streak = data.streak || { current: 0, longest: 0 }
  const hours = Array.isArray(data.hours) && data.hours.length === 24 ? data.hours : Array(24).fill(0)
  const weekdays = Array.isArray(data.weekdays) && data.weekdays.length === 7 ? data.weekdays : Array(7).fill(0)
  const busiest = { hour: data.busiest?.hour ?? argmax(hours), weekday: data.busiest?.weekday ?? argmax(weekdays) }
  const cmp = data.compare?.thisWeek && data.compare?.lastWeek ? data.compare : deriveCompare(daily)
  const delta = (cmp.thisWeek.sessions || 0) - (cmp.lastWeek.sessions || 0)
  const sd = data.sessionsDetail && typeof data.sessionsDetail === 'object' ? data.sessionsDetail : null
  const weekly = Array.isArray(data.weekly) && data.weekly.length ? data.weekly : deriveWeekly(daily)
  const rhythm = data.rhythm && typeof data.rhythm === 'object' ? data.rhythm : null
  const neglected = Array.isArray(data.neglected) ? data.neglected : null
  const lastActive = [...daily].reverse().find((d) => d.sessions > 0)?.date || null
  const persona = personaOf(rhythm, totals)
  const sentences = narrative({ active30, sessions30, totals, streak, busiest, rhythm, sd, lastActive })
  const pps = sd?.avgPrompts != null ? num1(sd.avgPrompts) : totals.sessions ? num1(totals.prompts / totals.sessions) : '—'
  return { daily, last30, active30, sessions30, totals, streak, hours, weekdays, busiest, cmp, delta, sd, weekly, rhythm, neglected, lastActive, persona, sentences, pps, grid: heatGrid(daily) }
}

function digestMd(v, { providerLabel, rootLabel, range }) {
  const flat = (segs) => segs.map((s) => (s.k ? `**${s.t}**` : s.t)).join('')
  const scope = [providerLabel, rootLabel].filter(Boolean).join(' · ')
  const lines = [
    `# AgentDeck insights — ${scope} (last ${WINDOW} days, to ${range?.to || '?'})`,
    '',
    ...(v.persona ? [`_${v.persona.label}_ — ${v.persona.why}`, ''] : []),
    v.sentences.map(flat).join(' '),
    '',
    '## At a glance',
    `- Active days: ${v.active30} / ${WINDOW} (${v.totals.activeDays ?? '—'} in ${HEAT_WEEKS} weeks)`,
    `- Streak: ${plural(v.streak.current, 'day')} (longest ${v.streak.longest})`,
    `- This week: ${plural(v.cmp.thisWeek.sessions, 'session')} vs ${v.cmp.lastWeek.sessions} last week (${deltaText(v.delta)})`,
    `- Typical session: ${v.sd ? fmtDur(v.sd.medianDurationMin) : '—'} (average ${v.sd ? fmtDur(v.sd.avgDurationMin) : '—'})`,
    `- Prompts per session: ${v.sd?.medianPrompts ?? v.pps} (average ${v.pps})`,
    v.busiest.hour != null ? `- Peaks: ${hh(v.busiest.hour)} · ${WEEKDAYS_LONG[v.busiest.weekday] || '—'}s` : '- Peaks: —',
    '',
    '## Weekly',
    '| week of | sessions | prompts | active days | projects |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...v.weekly.map((w) => `| ${w.weekStart} | ${w.sessions} | ${w.prompts} | ${w.activeDays} | ${w.projects ?? '—'} |`),
    ...(v.neglected?.length ? ['', '## Needs attention', ...v.neglected.map((p) => `- ${shortPath(p.cwd || p.slug)} — idle ${plural(p.daysAgo, 'day')} · ${plural(p.sessions, 'session')}`)] : []),
    '',
    `_A session counts on the day of its last activity. Rhythm, peaks and session shape use the full ${HEAT_WEEKS}-week window._`,
  ]
  return lines.join('\n')
}

// ---------- presentational pieces ----------
function Card({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-ink-900 p-4 min-w-0 ${className}`}>
      <div className="flex items-center gap-2 mb-3 min-w-0">
        <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 truncate">{title}</h3>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  )
}

function Tile({ label, value, unit, sub, aside }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-ink-900 px-4 py-3 min-w-0 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="text-[22px] font-semibold leading-tight text-zinc-100 truncate tabular-nums">{value}</span>
          {unit && <span className="text-[12px] text-zinc-500 shrink-0">{unit}</span>}
        </div>
        <div className="text-[11.5px] text-zinc-500 mt-0.5 truncate">{label}</div>
        {sub && <div className="text-[11px] text-zinc-600 truncate">{sub}</div>}
      </div>
      {aside}
    </div>
  )
}

// progress ring in currentColor so it follows the theme tokens
function Ring({ ratio, size = 40, stroke = 4 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, ratio || 0))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-ink-700" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} className="text-emerald-500/90" />
    </svg>
  )
}

// single-series column chart: bars anchored to a recessive baseline, 2px gaps,
// 4px rounded tops, hover title per bar; `peak` gets a stronger fill;
// `showValues` prints the value above each bar in a text token
function Bars({ values, labels, titles, height = 96, every = 1, peak = null, showValues = false, subLabels = null }) {
  const max = Math.max(1, ...values)
  const top = showValues ? 14 : 0
  return (
    <div>
      <div className="flex items-end gap-[2px] border-b border-zinc-800/70" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="flex-1 min-w-0 h-full flex flex-col justify-end" title={titles[i]}>
            {showValues && <div className="h-[14px] text-[10px] leading-[14px] text-center text-zinc-400 truncate tabular-nums">{v || ''}</div>}
            <div className={`w-full rounded-t-[4px] transition-colors ${v ? (peak === i ? 'bg-emerald-500/95' : 'bg-emerald-500/60 hover:bg-emerald-500/85') : 'bg-ink-700'}`} style={{ height: v ? Math.max(3, Math.round((v / max) * (height - top))) : 2 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 min-w-0 text-center">
            {subLabels && <div className="text-[10.5px] text-zinc-500 truncate tabular-nums">{subLabels[i]}</div>}
            <div className="text-[10px] text-zinc-600 truncate">{i % every === 0 ? l : ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// horizontal bucket bars with the count in a text token on the right
function HBars({ items, unit = 'session' }) {
  const max = Math.max(1, ...items.map((b) => b.n || 0))
  return (
    <div className="space-y-1.5">
      {items.map((b) => (
        <div key={b.label} className="flex items-center gap-3" title={`${b.label} · ${plural(b.n || 0, unit)}`}>
          <span className="w-16 shrink-0 text-right text-[12px] text-zinc-400 tabular-nums">{b.label}</span>
          <div className="flex-1 h-3 rounded-[4px] bg-ink-700 overflow-hidden">
            <div className="h-full rounded-r-[4px] bg-emerald-500/70" style={{ width: b.n ? `${Math.max(2, (b.n / max) * 100)}%` : 0 }} />
          </div>
          <span className="w-8 shrink-0 text-right text-[12px] text-zinc-300 tabular-nums">{b.n || 0}</span>
        </div>
      ))}
    </div>
  )
}

function Heatmap({ grid }) {
  const { weeks, months, max } = grid
  if (!weeks.length) return <div className="text-[12px] text-zinc-600">no days in range</div>
  return (
    <div className="overflow-x-auto no-scrollbar">
      <div className="inline-flex gap-2">
        <div className="shrink-0 flex flex-col gap-[3px] pt-4 pr-1 text-[10px] text-zinc-600">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className="h-3 leading-3">
              {i === 1 || i === 3 || i === 5 ? d : ''}
            </div>
          ))}
        </div>
        <div>
          <div className="flex gap-[3px] h-4">
            {months.map((m, i) => (
              <div key={i} className="w-3 relative">
                {m && <span className="absolute left-0 top-0 text-[10px] leading-3 text-zinc-600 whitespace-nowrap">{m}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((w, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }, (_, di) => {
                  const d = w[di]
                  return d ? <div key={di} className={`w-3 h-3 rounded-[3px] ${heat(d.sessions, max)}`} title={`${d.date} · ${plural(d.sessions, 'session')} · ${plural(d.prompts, 'prompt')} · ${plural(d.toolCalls, 'tool call')}`} /> : <div key={di} className="w-3 h-3" />
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const toggleBtn = 'h-6 px-2 rounded-md border border-zinc-800 text-[11.5px] text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'

// ---------- page ----------
export default function InsightsPage({ provider, root, rootLabel = '', providerLabel = '', onOpen }) {
  usePrefs() // re-render when Preferences › Paths changes (shortPath reads it)
  const [data, setData] = useState(null)
  const [handoff, setHandoff] = useState(false) // AI hand-off dialog with the digest
  const [err, setErr] = useState(null)
  const [table, setTable] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!provider || !root) return
    let cancelled = false
    setData(null)
    setErr(null)
    createApi(provider)
      .activity(root, HEAT_WEEKS * 7)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(e.message))
    return () => {
      cancelled = true
    }
  }, [provider, root])

  const v = useMemo(() => (data ? derive(data) : null), [data])

  const copy = () => {
    if (!v) return
    navigator.clipboard
      ?.writeText(digestMd(v, { providerLabel, rootLabel, range: data.range }))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  if (err) return <div className="m-6 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3">{err}</div>
  if (!v) return <div className="p-8 text-zinc-600 text-sm">Reading sessions…</div>

  const scope = [providerLabel, rootLabel].filter(Boolean).join(' · ')
  const { sd, cmp, delta, streak, busiest, weekly } = v
  const hourPeak = busiest.hour
  const dayPeak = busiest.weekday
  const durBuckets = Array.isArray(sd?.durationBuckets) && sd.durationBuckets.length ? sd.durationBuckets : DUR_LABELS.map((label) => ({ label, n: 0 }))
  const promptBuckets = Array.isArray(sd?.promptBuckets) && sd.promptBuckets.length ? sd.promptBuckets : PROMPT_LABELS.map((label) => ({ label, n: 0 }))
  const weekTitles = weekly.map((w) => `Week of ${w.weekStart} · ${plural(w.sessions, 'session')} · ${plural(w.prompts, 'prompt')} · ${plural(w.activeDays, 'active day')}${w.projects != null ? ` · ${plural(w.projects, 'project')}` : ''}`)

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 space-y-5">
      {/* 1 — hero */}
      <section className="rounded-xl border border-zinc-800 bg-ink-900 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            {scope && <div className="text-[11px] uppercase tracking-wide text-zinc-500 truncate">{scope}</div>}
            <h2 className="text-[18px] font-semibold text-zinc-100 leading-tight mt-0.5">Your last {WINDOW} days</h2>
          </div>
          {v.persona && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-ink-800 px-2.5 py-1 text-[11.5px] text-zinc-200 shrink-0" title={v.persona.why}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/90" />
              {v.persona.label}
            </span>
          )}
        </div>
        <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-300 max-w-4xl">
          {v.sentences.map((s, i) => (
            <span key={i}>
              {i > 0 ? ' ' : ''}
              {s.map((seg, j) =>
                seg.k ? (
                  <span key={j} className="text-zinc-100 font-medium">
                    {seg.t}
                  </span>
                ) : (
                  seg.t
                )
              )}
            </span>
          ))}
        </p>
        <div className="mt-3 text-[11px] text-zinc-600">
          {data.range?.from && data.range?.to ? `${data.range.from} → ${data.range.to} · ` : ''}
          rhythm, peaks and session shape use the full {HEAT_WEEKS}-week window; day counts use the last {WINDOW}.
        </div>
      </section>

      {/* 2 — tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Tile label="active days" value={v.active30} unit={`/ ${WINDOW}`} sub={v.totals.activeDays != null ? `${v.totals.activeDays} in ${HEAT_WEEKS} weeks` : undefined} aside={<Ring ratio={v.active30 / WINDOW} />} />
        <Tile label="current streak" value={`${streak.current}d`} sub={`longest ${streak.longest}d`} />
        <Tile
          label="sessions this week"
          value={cmp.thisWeek.sessions}
          sub={`vs ${cmp.lastWeek.sessions} last week`}
          aside={
            <span className={`text-[13px] font-medium tabular-nums shrink-0 ${delta > 0 ? 'text-zinc-200' : 'text-zinc-500'}`} title={`${cmp.thisWeek.sessions} this week vs ${cmp.lastWeek.sessions} the week before`}>
              {deltaText(delta)}
            </span>
          }
        />
        <Tile label="typical session" value={sd ? fmtDur(sd.medianDurationMin) : '—'} sub={sd ? `average ${fmtDur(sd.avgDurationMin)}` : 'not available'} />
        <Tile label="prompts per session" value={sd?.medianPrompts != null ? String(sd.medianPrompts) : v.pps} sub={sd?.medianPrompts != null ? `average ${v.pps}` : sd ? undefined : 'average over the window'} />
      </div>

      {/* 3 — heatmap + when you work */}
      <div className="grid gap-5 lg:grid-cols-[auto_1fr_1fr]">
        <Card
          title={`Activity · last ${HEAT_WEEKS} weeks`}
          right={
            <span className="flex items-center gap-1 text-[10.5px] text-zinc-600" title="sessions per day">
              less
              {['bg-emerald-500/25', 'bg-emerald-500/45', 'bg-emerald-500/70', 'bg-emerald-500/95'].map((c) => (
                <span key={c} className={`w-2.5 h-2.5 rounded-[2px] ${c}`} />
              ))}
              more
            </span>
          }
        >
          <Heatmap grid={v.grid} />
        </Card>
        <Card title="Hour of day" right={<span className="text-[11px] text-zinc-500">{hourPeak != null ? `peaks at ${hh(hourPeak)} · ${plural(v.hours[hourPeak], 'session')}` : 'no sessions yet'} · local time</span>}>
          <Bars values={v.hours} labels={v.hours.map((_, h) => `${h}`)} titles={v.hours.map((n, h) => `${hh(h)} · ${plural(n, 'session')}`)} every={3} height={88} peak={hourPeak} showValues />
        </Card>
        <Card title="Day of week" right={<span className="text-[11px] text-zinc-500">{dayPeak != null ? `peaks on ${WEEKDAYS_LONG[dayPeak]}s · ${plural(v.weekdays[dayPeak], 'session')}` : 'no sessions yet'}</span>}>
          <Bars values={MON_FIRST.map((i) => v.weekdays[i] || 0)} labels={MON_FIRST.map((i) => WEEKDAYS[i])} titles={MON_FIRST.map((i) => `${WEEKDAYS_LONG[i]} · ${plural(v.weekdays[i] || 0, 'session')}`)} height={88} peak={dayPeak != null ? MON_FIRST.indexOf(dayPeak) : null} showValues />
        </Card>
      </div>

      {/* 4 — weekly rhythm */}
      <Card
        title="Weekly rhythm · sessions"
        right={
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-zinc-600 hidden sm:inline">active days under each bar</span>
            <button onClick={() => setTable((t) => !t)} className={toggleBtn}>
              {table ? 'Chart' : 'Table'}
            </button>
          </div>
        }
      >
        {weekly.length === 0 ? (
          <div className="text-[12px] text-zinc-600">no weeks in range</div>
        ) : table ? (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800">
            <table className="w-full text-[12px]">
              <thead className="bg-ink-800 text-zinc-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">week of</th>
                  <th className="text-right px-3 py-1.5 font-medium">sessions</th>
                  <th className="text-right px-3 py-1.5 font-medium">prompts</th>
                  <th className="text-right px-3 py-1.5 font-medium">active days</th>
                  <th className="text-right px-3 py-1.5 font-medium">projects</th>
                </tr>
              </thead>
              <tbody>
                {[...weekly].reverse().map((w) => (
                  <tr key={w.weekStart} className="border-t border-zinc-800/70">
                    <td className="px-3 py-1 font-mono text-zinc-300">{w.weekStart}</td>
                    <td className="px-3 py-1 text-right text-zinc-300 tabular-nums">{w.sessions}</td>
                    <td className="px-3 py-1 text-right text-zinc-400 tabular-nums">{w.prompts}</td>
                    <td className="px-3 py-1 text-right text-zinc-400 tabular-nums">{w.activeDays}</td>
                    <td className="px-3 py-1 text-right text-zinc-400 tabular-nums">{w.projects ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Bars values={weekly.map((w) => w.sessions || 0)} labels={weekly.map((w) => shortDate(w.weekStart))} subLabels={weekly.map((w) => `${w.activeDays}d`)} titles={weekTitles} showValues height={130} />
        )}
      </Card>

      {/* 6 — session shape */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Session length" right={sd?.count != null ? <span className="text-[11px] text-zinc-500">{plural(sd.count, 'session')}</span> : null}>
          {sd ? (
            <>
              <HBars items={durBuckets} />
              {sd.longest && (
                <div className="mt-3 pt-3 border-t border-zinc-800/70 text-[12px] text-zinc-500 truncate" title={`${sd.longest.title || ''}${sd.longest.cwd ? ` · ${sd.longest.cwd}` : ''}`}>
                  Longest <span className="text-zinc-200 font-medium">{fmtDurCap(sd.longest.minutes)}</span>
                  {sd.longest.title ? <span className="text-zinc-400"> · {sd.longest.title}</span> : null}
                  <span className="text-zinc-600">
                    {' '}
                    · {shortPath(sd.longest.cwd || sd.longest.slug)}
                    {sd.longest.date ? ` · ${sd.longest.date}` : ''}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-[12px] text-zinc-600">Session shape is not available from this backend yet.</div>
          )}
        </Card>
        <Card title="Prompts per session">
          {sd ? <HBars items={promptBuckets} /> : <div className="text-[12px] text-zinc-600">Session shape is not available from this backend yet.</div>}
        </Card>
      </div>

      {/* 7 — needs attention */}
      <Card title="Needs attention" right={<span className="text-[11px] text-zinc-500">projects you touched this window but not in the last 14 days</span>}>
        {v.neglected == null ? (
          <div className="text-[12px] text-zinc-600">Idle-project detection is not available from this backend yet.</div>
        ) : v.neglected.length === 0 ? (
          <div className="text-[12.5px] text-zinc-500">Nothing is gathering dust — every project you touched in the last {HEAT_WEEKS} weeks has seen a session within two weeks.</div>
        ) : (
          <div className="-mx-2">
            {v.neglected.map((p) => {
              const name = shortPath(p.cwd || p.slug)
              const idle = p.daysAgo != null ? `idle ${plural(p.daysAgo, 'day')}` : p.lastTs ? `last ${fmtRelative(p.lastTs)}` : 'idle'
              const inner = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-zinc-200 truncate">{name}</div>
                    {p.cwd && <div className="text-[10.5px] text-zinc-600 font-mono truncate">{p.cwd}</div>}
                  </div>
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-zinc-700 bg-ink-800 text-zinc-300 tabular-nums">{idle}</span>
                  <span className="shrink-0 w-20 text-right text-[11.5px] text-zinc-500 tabular-nums">{plural(p.sessions ?? 0, 'session')}</span>
                  {onOpen && <span className="shrink-0 text-[11px] text-zinc-500 opacity-0 group-hover:opacity-100">Open ›</span>}
                </>
              )
              const cls = 'group w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left border-b border-zinc-800/60 last:border-0'
              return onOpen ? (
                <button key={`${p.slug}|${p.cwd}`} onClick={() => onOpen({ root, slug: p.slug, cwd: p.cwd, project: projectName(p.cwd, p.slug) })} className={`${cls} hover:bg-ink-800`} title={p.cwd || p.slug}>
                  {inner}
                </button>
              ) : (
                <div key={`${p.slug}|${p.cwd}`} className={cls} title={p.cwd || p.slug}>
                  {inner}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* 8 — footer */}
      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11.5px] text-zinc-500">
        <button onClick={copy} className="px-3 py-1.5 rounded-md bg-ink-700 border border-zinc-700 text-[12px] text-zinc-200 hover:bg-ink-600">
          {copied ? '✓ copied' : 'Copy digest as Markdown'}
        </button>
        <HandoffButton onClick={() => setHandoff(true)} label={`Ask ${providerLabel || 'the agent'} about it`} title="Open the CLI with this digest and a question about your habits" />
        <span>Paste it into any agent session, or hand it over directly.</span>
        <span className="ml-auto text-zinc-600">A session counts on the day of its last activity.</span>
      </div>
      {handoff && (
        <HandoffDialog
          api={createApi(provider)}
          providerId={provider}
          providerLabel={providerLabel || provider}
          root={root}
          context={{ kind: 'Insights digest (last 30 days)', filePath: null, content: digestMd(v, { providerLabel, rootLabel, range: data.range }), docs: null, need: 'Read the digest below and tell me the three habits worth changing, with one concrete experiment for each. Do not repeat the numbers back to me.' }}
          placeholder="What do you want to know about how you work?"
          onClose={() => setHandoff(false)}
        />
      )}
    </div>
  )
}
