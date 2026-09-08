import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketActivity, dayKey, totalTokens } from '../server/shared/activity.js'

// a fixed local "now": Monday 2026-09-07 12:00
const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime()
const at = (daysAgo, hour = 10) => new Date(2026, 8, 7 - daysAgo, hour, 0, 0).toISOString()
const sess = (daysAgo, extra = {}) => ({ id: `s${daysAgo}-${hour(extra)}`, slug: 'proj-a', cwd: '/w/a', lastTs: at(daysAgo, hour(extra)), userTurns: 2, toolCalls: 5, tokens: { input: 100, output: 50, cacheRead: 25, cacheCreate: 0 }, models: ['m1'], ...extra })
const hour = (x) => x.hour ?? 10

test('bucketActivity: zero-filled window, oldest → newest, totals and per-day sums', () => {
  const a = bucketActivity([sess(0), sess(0, { hour: 22 }), sess(3), sess(40)], { days: 7, now: NOW })
  assert.equal(a.days, 7)
  assert.equal(a.daily.length, 7)
  assert.equal(a.range.to, dayKey(NOW))
  assert.equal(a.daily[6].sessions, 2) // today
  assert.equal(a.daily[3].sessions, 1) // three days ago
  assert.equal(a.totals.sessions, 3) // the 40-day-old one is outside the window
  assert.equal(a.totals.prompts, 6)
  assert.equal(a.totals.toolCalls, 15)
  assert.equal(a.totals.tokens, 3 * 175)
  assert.equal(a.totals.activeDays, 2)
  assert.equal(totalTokens({ input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }), 10)
})

test('bucketActivity: hours / weekdays use the local clock of the last activity', () => {
  const a = bucketActivity([sess(0, { hour: 22 }), sess(1, { hour: 9 })], { days: 7, now: NOW })
  assert.equal(a.hours[22], 1)
  assert.equal(a.hours[9], 1)
  assert.equal(a.weekdays[1], 1) // Monday (today)
  assert.equal(a.weekdays[0], 1) // Sunday (yesterday)
  assert.equal(a.busiest.hour, 9) // ties resolve to the earliest hour
})

test('bucketActivity: streaks ignore an empty today, longest run is measured across the window', () => {
  // yesterday + the two days before → current 3; a separate 4-day run earlier → longest 4
  const list = [sess(1), sess(2), sess(3), sess(10), sess(11), sess(12), sess(13)]
  const a = bucketActivity(list, { days: 30, now: NOW })
  assert.equal(a.streak.current, 3)
  assert.equal(a.streak.longest, 4)
  const b = bucketActivity([sess(0), sess(1)], { days: 30, now: NOW })
  assert.equal(b.streak.current, 2)
  const c = bucketActivity([sess(5)], { days: 30, now: NOW })
  assert.equal(c.streak.current, 0)
})

test('bucketActivity: projects rank by sessions then tokens; models count sessions', () => {
  const a = bucketActivity(
    [sess(0), sess(1), sess(2, { slug: 'proj-b', cwd: '/w/b', tokens: { input: 9000 }, models: ['m2'] }), sess(3, { slug: 'proj-c', cwd: '/w/c', models: ['m1', 'm2'] })],
    { days: 30, now: NOW }
  )
  assert.deepEqual(
    a.topProjects.map((p) => p.slug),
    ['proj-a', 'proj-b', 'proj-c']
  )
  assert.equal(a.topProjects[0].sessions, 2)
  assert.deepEqual(a.models, { m1: 3, m2: 2 })
})

test('bucketActivity: personal shape — durations, prompt buckets, weekly, compare, rhythm, neglected', () => {
  const withDur = (daysAgo, hour, minutes, extra = {}) => {
    const last = new Date(2026, 8, 7 - daysAgo, hour, 0, 0)
    const first = new Date(last.getTime() - minutes * 60000)
    return { id: `d${daysAgo}-${hour}`, slug: 'proj-a', cwd: '/w/a', firstTs: first.toISOString(), lastTs: last.toISOString(), userTurns: 4, toolCalls: 1, tokens: {}, models: [], ...extra }
  }
  const a = bucketActivity(
    [
      withDur(0, 14, 30), // today, afternoon, 30 min
      withDur(1, 15, 240, { userTurns: 30 }), // yesterday, afternoon, 4 h — the longest
      withDur(2, 22, 3, { userTurns: 1 }), // late, 3 min
      withDur(9, 9, 60), // last week
      withDur(20, 16, 10, { slug: 'proj-old', cwd: '/w/old' }), // idle for 20 days → neglected (afternoon)
    ],
    { days: 30, now: NOW }
  )
  assert.equal(a.sessionsDetail.count, 5)
  assert.equal(a.sessionsDetail.longest.minutes, 240)
  assert.equal(a.sessionsDetail.longest.slug, 'proj-a')
  assert.equal(a.sessionsDetail.medianDurationMin, 30)
  assert.deepEqual(a.sessionsDetail.durationBuckets.map((b) => b.n), [1, 1, 1, 1, 1])
  assert.deepEqual(a.sessionsDetail.promptBuckets.map((b) => b.n), [1, 3, 0, 0, 1])
  assert.equal(a.weekly.at(-1).weekStart, '2026-09-07') // this Monday
  assert.equal(a.weekly.reduce((n, w) => n + w.sessions, 0), 5)
  assert.equal(a.compare.thisWeek.sessions, 3)
  assert.equal(a.compare.lastWeek.sessions, 1)
  assert.equal(a.rhythm.part, 'afternoon')
  assert.equal(a.rhythm.share, 0.6)
  assert.equal(a.rhythm.weekendShare, 0.6) // Sun 9/6, Sat 9/5, Sat 8/29
  assert.deepEqual(a.neglected.map((p) => p.slug), ['proj-old'])
  assert.equal(a.neglected[0].daysAgo, 20)
  const empty = bucketActivity([], { days: 7, now: NOW })
  assert.equal(empty.sessionsDetail.longest, null)
  assert.equal(empty.rhythm.part, null)
  assert.deepEqual(empty.neglected, [])
})

test('bucketActivity: tolerates junk and empty input', () => {
  const a = bucketActivity([{ id: 'x' }, { id: 'y', lastTs: 'not a date' }, null], { days: 3, now: NOW })
  assert.equal(a.totals.sessions, 0)
  assert.deepEqual(a.busiest, { hour: null, weekday: null })
  assert.equal(a.daily.length, 3)
  assert.equal(bucketActivity(undefined, { days: 0, now: NOW }).days, 84) // 0 / junk → default
  assert.equal(bucketActivity(undefined, { days: 'x', now: NOW }).days, 84)
  assert.equal(bucketActivity(undefined, { days: 5000, now: NOW }).days, 366) // clamps
})
