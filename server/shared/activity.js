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
//   }
//
// A session counts on the day of its LAST activity (fallback: first), in the
// server's local time — "when did I work on it" rather than "when did it start".
// Its tokens are attributed whole to that day; a long-running session therefore
// shows up as one spike, which is the honest reading of a per-session log.

const DAY_MS = 86400000
const pad = (n) => String(n).padStart(2, '0')

export const dayKey = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

export const totalTokens = (t = {}) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0)

export function bucketActivity(sessions = [], { days = 84, now = Date.now() } = {}) {
  const n = Number(days)
  const span = Number.isFinite(n) && n > 0 ? Math.min(366, Math.floor(n)) : 84
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const daily = new Map()
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * DAY_MS)
    const key = dayKey(d)
    daily.set(key, { date: key, sessions: 0, prompts: 0, toolCalls: 0, tokens: 0 })
  }
  const hours = Array(24).fill(0)
  const weekdays = Array(7).fill(0)
  const projects = new Map()
  const models = {}

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
    const p = projects.get(pk) || { slug: s.slug || null, cwd: s.cwd || null, sessions: 0, toolCalls: 0, tokens: 0 }
    p.sessions++
    p.toolCalls += s.toolCalls || 0
    p.tokens += tok
    projects.set(pk, p)
    for (const m of s.models || []) models[m] = (models[m] || 0) + 1
  }

  const list = [...daily.values()]
  const totals = list.reduce(
    (a, d) => ({ sessions: a.sessions + d.sessions, prompts: a.prompts + d.prompts, toolCalls: a.toolCalls + d.toolCalls, tokens: a.tokens + d.tokens }),
    { sessions: 0, prompts: 0, toolCalls: 0, tokens: 0 }
  )
  totals.activeDays = list.filter((d) => d.sessions > 0).length

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
  const argmax = (arr) => (arr.some((v) => v > 0) ? arr.indexOf(Math.max(...arr)) : null)

  return {
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
