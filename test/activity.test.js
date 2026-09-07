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

test('bucketActivity: tolerates junk and empty input', () => {
  const a = bucketActivity([{ id: 'x' }, { id: 'y', lastTs: 'not a date' }, null], { days: 3, now: NOW })
  assert.equal(a.totals.sessions, 0)
  assert.deepEqual(a.busiest, { hour: null, weekday: null })
  assert.equal(a.daily.length, 3)
  assert.equal(bucketActivity(undefined, { days: 0, now: NOW }).days, 84) // 0 / junk → default
  assert.equal(bucketActivity(undefined, { days: 'x', now: NOW }).days, 84)
  assert.equal(bucketActivity(undefined, { days: 5000, now: NOW }).days, 366) // clamps
})
