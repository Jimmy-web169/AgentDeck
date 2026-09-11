// Activity profile: buckets session summaries into a per-day / per-hour /
// per-weekday picture of how someone has been using their agents lately.
// Pure — no filesystem, no provider knowledge — so both providers feed it the
// same shape and the tests can run it on fixtures.
//
//   bucketActivity(sessions, { days, now }) → {
//     days, range: { from, to },
//     daily:    [{ date: 'YYYY-MM-DD', sessions, prompts, toolCalls, tokens }]  oldest → newest, zero-filled
//     hours:    [24]  sessions by local hour of their last activity
//     weekdays: [7]   sessions by local weekday (0 = Sunday)
//     totals:   { sessions, prompts, toolCalls, tokens, activeDays }
//     streak:   { current, longest }   consecutive active days (today may still be empty)
//     topProjects: [{ slug, cwd, sessions, toolCalls, tokens }]  by sessions, then tokens
//     models:   { name: sessions }
//     busiest:  { hour, weekday }  or nulls when there is nothing in range
//     sessionsDetail: { count, avgPrompts, medianPrompts, avgDurationMin, medianDurationMin,
//                       longest: { title, slug, cwd, minutes, date } | null,
//                       durationBuckets: [{ label, n }], promptBuckets: [{ label, n }] }
//     weekly:   [{ weekStart, sessions, prompts, activeDays, projects }]  Monday-start weeks, oldest → newest
//     compare:  { thisWeek: { sessions, prompts, activeDays }, lastWeek: { … } }  last 7 days vs the 7 before
//     rhythm:   { part: 'morning'|'afternoon'|'evening'|'night'|null, share, weekendShare }
//     neglected: [{ slug, cwd, lastTs, daysAgo, sessions }]  active in the window, idle ≥ 14 days, max 5
//   }
//
// A session counts on the day of its LAST activity (fallback: first), in the
// server's local time — "when did I work on it" rather than "when did it start".
// Its tokens are attributed whole to that day; a long-running session therefore
// shows up as one spike, which is the honest reading of a per-session log.

interface ActivitySession {
  firstTs?: string | number | null
  lastTs?: string | number | null
  tokens?: Record<string, number>
  userTurns?: number
  toolCalls?: number
  slug?: string | null
  cwd?: string | null
  title?: string | null
  models?: string[]
}
interface Daily {
  date: string
  sessions: number
  prompts: number
  toolCalls: number
  tokens: number
}
interface Project {
  slug: string | null
  cwd: string | null
  sessions: number
  toolCalls: number
  tokens: number
  lastTs: string | null
}
interface ActivityEntry {
  s: ActivitySession
  t: Date
  minutes: number
}
interface Week {
  weekStart: string
  sessions: number
  prompts: number
  activeDays: number
  projects: Set<string>
}
const DAY_MS = 86400000
const pad = (n: number) => String(n).padStart(2, '0')

export const dayKey = (d: string | number | Date) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

// the provider computes `total` (server/shared/tokens.ts); the sum is only a fallback for old shapes
export const totalTokens = (t: Record<string, number> = {}) =>
  typeof t.total === 'number' && t.total > 0 ? t.total : (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0)

export function bucketActivity(sessions: ActivitySession[] = [], { days = 84, now = Date.now() }: { days?: number | string; now?: number } = {}) {
  const n = Number(days)
  const span = Number.isFinite(n) && n > 0 ? Math.min(366, Math.floor(n)) : 84
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const daily = new Map<string, Daily>()
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * DAY_MS)
    const key = dayKey(d)
    daily.set(key, { date: key, sessions: 0, prompts: 0, toolCalls: 0, tokens: 0 })
  }
  const hours = Array(24).fill(0)
  const weekdays = Array(7).fill(0)
  const projects = new Map<string, Project>()
  const models: Record<string, number> = {}
  const inRange: ActivityEntry[] = [] // { s, t, minutes }

  for (const s of sessions) {
    const ts = s?.lastTs || s?.firstTs
    if (!ts) continue
    const t = new Date(ts)
    if (Number.isNaN(t.getTime())) continue
    const bucket = daily.get(dayKey(t))
    if (!bucket) continue // outside the window
    const tok = totalTokens(s.tokens)
    bucket.sessions++
    bucket.prompts += s.userTurns || 0
    bucket.toolCalls += s.toolCalls || 0
    bucket.tokens += tok
    hours[t.getHours()]++
    weekdays[t.getDay()]++
    const pk = s.slug || s.cwd || '?'
    const p = projects.get(pk) || { slug: s.slug || null, cwd: s.cwd || null, sessions: 0, toolCalls: 0, tokens: 0, lastTs: null }
    p.sessions++
    p.toolCalls += s.toolCalls || 0
    p.tokens += tok
    if (!p.lastTs || t.getTime() > new Date(p.lastTs).getTime()) p.lastTs = t.toISOString()
    projects.set(pk, p)
    for (const m of s.models || []) models[m] = (models[m] || 0) + 1
    const f = s.firstTs ? new Date(s.firstTs) : null
    const minutes = f && !Number.isNaN(f.getTime()) ? Math.min(12 * 60, Math.max(0, Math.round((t.getTime() - f.getTime()) / 60000))) : 0
    inRange.push({ s, t, minutes })
  }

  const list = [...daily.values()]
  const sums = list.reduce(
    (a, d) => ({ sessions: a.sessions + d.sessions, prompts: a.prompts + d.prompts, toolCalls: a.toolCalls + d.toolCalls, tokens: a.tokens + d.tokens }),
    { sessions: 0, prompts: 0, toolCalls: 0, tokens: 0 }
  )
  const totals = { ...sums, activeDays: list.filter((d) => d.sessions > 0).length }

  // current streak: count back from today; an empty "today" doesn't break a
  // streak that ran through yesterday
  let i = list.length - 1
  if (list[i].sessions === 0) i--
  let current = 0
  for (; i >= 0 && list[i].sessions > 0; i--) current++
  let longest = 0
  let run = 0
  for (const d of list) {
    run = d.sessions > 0 ? run + 1 : 0
    if (run > longest) longest = run
  }

  const topProjects = [...projects.values()].sort((a, b) => b.sessions - a.sessions || b.tokens - a.tokens).slice(0, 8)
  const argmax = (arr: number[]) => (arr.some((v) => v > 0) ? arr.indexOf(Math.max(...arr)) : null)

  // ---- personal shape ----
  const median = (xs: number[]) => {
    if (!xs.length) return 0
    const a = [...xs].sort((x, y) => x - y)
    const m = a.length >> 1
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  const bucketize = (xs: number[], edges: number[], labels: string[]) =>
    labels.map((label, i) => ({ label, n: xs.filter((v) => v >= (edges[i - 1] ?? -Infinity) && v < (edges[i] ?? Infinity)).length }))
  const prompts = inRange.map((x) => x.s.userTurns || 0)
  const durations = inRange.map((x) => x.minutes)
  const longestX = inRange.reduce<ActivityEntry | null>((best, x) => (x.minutes > (best?.minutes ?? -1) ? x : best), null)
  const sessionsDetail = {
    count: inRange.length,
    avgPrompts: avg(prompts),
    medianPrompts: median(prompts),
    avgDurationMin: avg(durations),
    medianDurationMin: median(durations),
    longest: longestX
      ? { title: longestX.s.title || null, slug: longestX.s.slug || null, cwd: longestX.s.cwd || null, minutes: longestX.minutes, date: dayKey(longestX.t) }
      : null,
    durationBuckets: bucketize(durations, [5, 15, 45, 120], ['<5m', '5–15m', '15–45m', '45m–2h', '>2h']),
    promptBuckets: bucketize(prompts, [3, 6, 11, 21], ['1–2', '3–5', '6–10', '11–20', '>20']),
  }

  // Monday-start weeks covering the window
  const weekStartOf = (d: string | Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
    return x
  }
  const weeks = new Map<string, Week>()
  for (const d of list) {
    const ws = dayKey(weekStartOf(d.date + 'T00:00:00'))
    const w = weeks.get(ws) || { weekStart: ws, sessions: 0, prompts: 0, activeDays: 0, projects: new Set<string>() }
    w.sessions += d.sessions
    w.prompts += d.prompts
    if (d.sessions) w.activeDays++
    weeks.set(ws, w)
  }
  for (const x of inRange) {
    const w = weeks.get(dayKey(weekStartOf(x.t)))
    if (w) w.projects.add(x.s.slug || x.s.cwd || '?')
  }
  const weekly = [...weeks.values()].map((w) => ({ ...w, projects: w.projects.size }))

  const sum = (ds: Daily[]) => ({
    sessions: ds.reduce((a, d) => a + d.sessions, 0),
    prompts: ds.reduce((a, d) => a + d.prompts, 0),
    activeDays: ds.filter((d) => d.sessions > 0).length,
  })
  const compare = { thisWeek: sum(list.slice(-7)), lastWeek: sum(list.slice(-14, -7)) }

  const parts = { morning: [5, 12], afternoon: [12, 18], evening: [18, 23], night: [23, 29] } // night wraps past midnight → 23:00–04:59
  const partOf = (h: number) => (h >= 23 || h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening')
  const partCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  let weekend = 0
  for (const x of inRange) {
    partCounts[partOf(x.t.getHours())]++
    if (x.t.getDay() === 0 || x.t.getDay() === 6) weekend++
  }
  const topPart = inRange.length ? Object.entries(partCounts).sort((a, b) => b[1] - a[1])[0] : null
  const rhythm = {
    part: topPart ? topPart[0] : null,
    share: topPart ? +(topPart[1] / inRange.length).toFixed(2) : 0,
    weekendShare: inRange.length ? +(weekend / inRange.length).toFixed(2) : 0,
  }
  void parts

  const IDLE_DAYS = 14
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const calendarDaysBetween = (a: Date, b: Date) => Math.round((midnight(b) - midnight(a)) / DAY_MS) // whole calendar days, not 24h blocks
  const neglected = [...projects.values()]
    .map((p) => ({ slug: p.slug, cwd: p.cwd, lastTs: p.lastTs, daysAgo: calendarDaysBetween(new Date(p.lastTs ?? 0), end), sessions: p.sessions }))
    .filter((p) => p.daysAgo >= IDLE_DAYS)
    .sort((a, b) => b.sessions - a.sessions || b.daysAgo - a.daysAgo)
    .slice(0, 5)

  return {
    sessionsDetail,
    weekly,
    compare,
    rhythm,
    neglected,
    days: span,
    range: { from: list[0].date, to: list[list.length - 1].date },
    daily: list,
    hours,
    weekdays,
    totals,
    streak: { current, longest },
    topProjects,
    models,
    busiest: { hour: argmax(hours), weekday: argmax(weekdays) },
  }
}
