import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApi } from '../src/api.js'
import { PROVIDERS } from '../server/registry.js'
import {
  bumpSessionVersions,
  cancelReconnect,
  createDebounceWithMaxWait,
  getSessionVersion,
  hasSubagentsNow,
  isLiveAuthoritative,
  reconnectDelayMs,
  scheduleReconnect,
  startFallbackPoll,
  subscribeToPageResume,
} from '../src/lib/liveSync.js'

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  return {
    setTimer(fn, delay) {
      const id = nextId++
      timers.set(id, { at: now + delay, fn })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    advance(ms) {
      const target = now + ms
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
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

test('provider-bound API clients never leak the selected provider', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(url)
    return {
      status: 200,
      ok: true,
      text: async () => '{}',
      headers: { get: () => null },
    }
  }
  try {
    const claude = createApi('claude')
    const codex = createApi('codex')
    await Promise.all([claude.roots(), codex.roots(), claude.projects('r1'), codex.projects('r2')])
    assert.deepEqual(urls, [
      '/api/claude/roots',
      '/api/codex/roots',
      '/api/claude/projects?root=r1',
      '/api/codex/projects?root=r2',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('new Codex subagent changes bump both child and parent scoped versions', () => {
  const versions = bumpSessionVersions({}, [
    { provider: 'codex', root: 'root-a', id: 'child-1', parentId: 'parent-1' },
  ])
  assert.equal(getSessionVersion(versions, 'codex', 'root-a', 'child-1'), 1)
  assert.equal(getSessionVersion(versions, 'codex', 'root-a', 'parent-1'), 1)
  assert.equal(getSessionVersion(versions, 'claude', 'root-a', 'parent-1'), 0)
  assert.equal(getSessionVersion(versions, 'codex', 'root-b', 'parent-1'), 0)
})

test('Codex watcher includes the parent id for a new subagent rollout', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-codex-watch-'))
  const parentId = '11111111-1111-4111-8111-111111111111'
  const childId = '22222222-2222-4222-8222-222222222222'
  const sessionDir = path.join(rootDir, 'sessions', '2026', '07', '21')
  fs.mkdirSync(sessionDir, { recursive: true })
  const file = path.join(sessionDir, `rollout-2026-07-21T12-00-00-${childId}.jsonl`)
  fs.writeFileSync(file, `${JSON.stringify({
    timestamp: '2026-07-21T12:00:00.000Z',
    payload: {
      cwd: 'C:/repo',
      source: { subagent: { thread_spawn: { parent_thread_id: parentId, agent_role: 'worker' } } },
    },
  })}\n`)
  try {
    const change = PROVIDERS.codex.watch.toEvent('root-a', rootDir, file)
    assert.deepEqual(change, {
      provider: 'codex',
      root: 'root-a',
      id: childId,
      slug: 'C:/repo',
      parentId,
    })
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})

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

test('fallback polling covers a missed SSE event and stops on cleanup', () => {
  let tick
  let cleared = null
  let calls = 0
  const stop = startFallbackPoll(() => calls++, 3000, {
    setEvery(fn, ms) {
      assert.equal(ms, 3000)
      tick = fn
      return 42
    },
    clearEvery(id) {
      cleared = id
    },
  })
  tick()
  assert.equal(calls, 1)
  stop()
  assert.equal(cleared, 42)
})

test('background visibility recovery catches up only when the page becomes visible', () => {
  const doc = new EventTarget()
  const win = new EventTarget()
  let visibilityState = 'hidden'
  Object.defineProperty(doc, 'visibilityState', { get: () => visibilityState })
  const reasons = []
  const unsubscribe = subscribeToPageResume((reason) => reasons.push(reason), { doc, win })

  doc.dispatchEvent(new Event('visibilitychange'))
  visibilityState = 'visible'
  doc.dispatchEvent(new Event('visibilitychange'))
  win.dispatchEvent(new Event('focus'))
  assert.deepEqual(reasons, ['visibility', 'focus'])

  unsubscribe()
  win.dispatchEvent(new Event('focus'))
  assert.deepEqual(reasons, ['visibility', 'focus'])
})

test('a disconnected WebSocket slice falls back to REST and retries with a cap', () => {
  assert.equal(isLiveAuthoritative({ ready: true }), true)
  assert.equal(isLiveAuthoritative({ ready: false, transcript: { timeline: [] } }), false)
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(reconnectDelayMs), [1000, 2000, 4000, 8000, 10000, 10000])

  const clock = fakeClock()
  const meta = { attempt: 0, timer: null, closed: false }
  let reconnects = 0
  assert.equal(scheduleReconnect(meta, () => reconnects++, { setTimer: clock.setTimer }), true)
  assert.equal(scheduleReconnect(meta, () => reconnects++, { setTimer: clock.setTimer }), false)
  clock.advance(999)
  assert.equal(reconnects, 0)
  clock.advance(1)
  assert.equal(reconnects, 1)

  scheduleReconnect(meta, () => reconnects++, { setTimer: clock.setTimer })
  cancelReconnect(meta, { clearTimer: clock.clearTimer })
  clock.advance(2000)
  assert.equal(reconnects, 1)
})
