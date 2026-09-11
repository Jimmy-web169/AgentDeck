// Original test group: terminal-experience. Assertions retained during module-path migration.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { reconcileTerminalPanes } from '../../src/lib/terminalPanes.ts'
import { liveTarget, newDraft } from '../../src/lib/tabs.ts'

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
    assert.equal(state.panes.find((p) => p.key === original)?.target.id, 'saved')
    // Closing its tab keeps the running pane; End/removal can release it.
    state = reconcileTerminalPanes(state.panes, provider, b, [bound], [b])
    assert.equal(
      state.panes.some((p) => p.key === original),
      true
    )
    state = reconcileTerminalPanes(state.panes, provider, b, [], [b])
    assert.equal(
      state.panes.some((p) => p.key === original),
      false
    )
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
