// Query/SSE regression tests own invalidation, polling and focus recovery.
// Only the retained pure helpers are tested here.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createDebounceWithMaxWait, hasSubagentsNow } from '../../src/lib/liveSync.ts'

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimer(fn: () => void, delay = 0) {
      const id = nextId++
      timers.set(id, { at: now + delay, fn })
      return id
    },
    clearTimer(id: number | ReturnType<typeof setTimeout>) {
      if (typeof id === 'number') timers.delete(id)
    },
    advance(ms: number) {
      const target = now + ms
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.fn()
      }
      now = target
    },
  }
}

test('a first subagent spawned mid-view unlocks the tab via the live sessions list', () => {
  const active = { id: 's1', hasSubagents: false }
  assert.equal(hasSubagentsNow(null, []), false)
  assert.equal(hasSubagentsNow(active, [{ id: 's1', hasSubagents: false }]), false)
  // the sessions list refreshed after the sidecar appeared — no re-select needed
  assert.equal(hasSubagentsNow(active, [{ id: 's1', hasSubagents: true }]), true)
  // a cross-project jump may not be in the current list — the snapshot still counts
  assert.equal(hasSubagentsNow({ id: 's2', hasSubagents: true }, []), true)
})

test('Claude change bursts refresh within maxWait instead of debouncing forever', () => {
  const clock = fakeClock()
  let calls = 0
  const schedule = createDebounceWithMaxWait(() => calls++, {
    waitMs: 300,
    maxWaitMs: 1000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  schedule()
  clock.advance(250)
  schedule()
  clock.advance(250)
  schedule()
  clock.advance(250)
  schedule()
  clock.advance(249)
  assert.equal(calls, 0)
  clock.advance(1)
  assert.equal(calls, 1)
})
