import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileTerminalPanes } from '../src/lib/terminalPanes.js'
import { liveTarget, newDraft } from '../src/lib/tabs.js'
import { terminalStatus } from '../src/lib/terminalStatus.js'
import { createLiveTerminalStore } from '../src/lib/liveTerminalStore.js'
import { mergeTerminalEntries } from '../src/lib/terminalTarget.js'

for (const provider of ['claude', 'codex', 'antigravity']) {
  test(`${provider}: draft promotion and tab switching preserve the mounted terminal pane key`, () => {
    const a = newDraft({ provider, root: 'r', cwd: '/project' })
    const b = newDraft({ ...a, launchId: undefined })
    let state = reconcileTerminalPanes([], provider, a, [], [a, b])
    const original = state.currentKey
    const terminal = { ...a, key: `${provider}|r|launch|${a.launchId}` }
    state = reconcileTerminalPanes(state.panes, provider, liveTarget(terminal), [terminal], [a, b])
    assert.equal(state.currentKey, original)
    state = reconcileTerminalPanes(state.panes, provider, b, [terminal], [a, b])
    assert.notEqual(state.currentKey, original)
    assert.equal(state.panes.length, 2)
    const bound = { ...terminal, id: 'saved', slug: 'project' }
    state = reconcileTerminalPanes(state.panes, provider, liveTarget(bound), [bound], [liveTarget(bound), b])
    assert.equal(state.currentKey, original)
    assert.equal(state.panes.find((p) => p.key === original).target.id, 'saved')
    // Closing its tab keeps the running pane; End/removal can release it.
    state = reconcileTerminalPanes(state.panes, provider, b, [bound], [b])
    assert.equal(state.panes.some((p) => p.key === original), true)
    state = reconcileTerminalPanes(state.panes, provider, b, [], [b])
    assert.equal(state.panes.some((p) => p.key === original), false)
  })
}

test('late identity merging retains the original terminal pane, not an earlier history view', () => {
  const provider = 'codex'
  const saved = { provider, root: 'r', id: 's' }
  const draft = newDraft({ provider, root: 'r', cwd: '/project' })
  let state = reconcileTerminalPanes([], provider, saved, [], [saved, draft])
  const terminal = { ...draft, key: 'terminal' }
  state = reconcileTerminalPanes(state.panes, provider, liveTarget(terminal), [terminal], [saved, draft])
  const original = state.currentKey
  const bound = { ...terminal, id: 's' }
  state = reconcileTerminalPanes(state.panes, provider, liveTarget(bound), [bound], [saved])
  assert.equal(state.panes.length, 1)
  assert.equal(state.currentKey, original)
  assert.equal(state.panes[0].key, original)
})

test('same IDs in different accounts/providers never share terminal panes', () => {
  const a = { provider: 'codex', root: 'one', id: 's' }
  const b = { ...a, root: 'two' }
  let state = reconcileTerminalPanes([], 'codex', a, [], [a, b])
  const first = state.currentKey
  state = reconcileTerminalPanes(state.panes, 'codex', b, [], [a, b])
  assert.notEqual(state.currentKey, first)
  assert.equal(state.panes.length, 2)
})

test('a stale pool poll cannot undo a Live identity update', () => {
  const old = { provider: 'claude', root: 'r', key: 'terminal', id: 'old' }
  const linked = { ...old, id: 'new' }
  assert.deepEqual(mergeTerminalEntries([old], [linked]), [linked])
})

test('connection and transcript states are separate, with actionable long-wait copy', () => {
  assert.equal(terminalStatus({ loading: true, reconnecting: true }), 'Reconnecting to terminal…')
  assert.equal(terminalStatus({ loading: true }), 'Starting terminal…')
  assert.equal(terminalStatus({ running: false }), null)
  assert.match(terminalStatus({ running: true }), /Opening terminal view/)
  assert.match(terminalStatus({ running: true, delayed: true }), /reload it or pop it out/)
  assert.match(terminalStatus({ running: true, frameLoaded: true }), /waiting for its conversation record/)
  assert.match(terminalStatus({ running: true, frameLoaded: true, delayed: true }), /Conversation record not detected yet/)
  assert.match(terminalStatus({ running: true, frameLoaded: true, id: 's', delayed: true }), /keep using the terminal/)
  assert.match(terminalStatus({ running: true, frameLoaded: true, id: 's', transcriptReady: true }), /synced/)
})

test('Live file bursts coalesce into one refresh and cancel cleanly', async () => {
  const timers = new Map()
  let timerId = 0, calls = 0
  const store = createLiveTerminalStore(async () => { calls++; return [] }, {
    setTimer: (fn) => { timers.set(++timerId, fn); return timerId },
    clearTimer: (id) => timers.delete(id),
  })
  for (let i = 0; i < 100; i++) store.schedule()
  assert.equal(timers.size, 1)
  const fire = timers.values().next().value
  timers.clear(); fire()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  store.schedule(); store.cancel()
  assert.equal(timers.size, 0)
})

test('a stale Live response cannot resurrect an ended terminal; concurrent refreshes share one request', async () => {
  const resolvers = []
  let calls = 0
  const store = createLiveTerminalStore(() => { calls++; return new Promise((resolve) => resolvers.push(resolve)) })
  const terminal = { key: 't', provider: 'codex', root: 'r' }
  store.upsert(terminal)
  const first = store.refresh()
  assert.equal(first, store.refresh())
  await Promise.resolve()
  assert.equal(calls, 1)
  store.remove('t')
  assert.deepEqual(store.getSnapshot(), [])
  resolvers.shift()([terminal])
  await first
  assert.deepEqual(store.getSnapshot(), [])
  await Promise.resolve()
  assert.equal(calls, 2)
  resolvers.shift()([])
  await new Promise((resolve) => setImmediate(resolve))
  store.cancel()
})
