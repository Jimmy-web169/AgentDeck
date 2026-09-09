import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalTabKeys, openTabState, adoptTerminal, dedupeTabs, liveTarget, newDraft, sameTarget, targetKey } from '../src/lib/tabs.js'
import { toHash, fromHash } from '../src/lib/route.js'
import { terminalRequest } from '../src/lib/terminalTarget.js'

const scope = { provider: 'codex', root: 'account-a', cwd: '/work/project' }

test('new conversations in one folder have independent, stable identities', () => {
  const a = newDraft(scope), b = newDraft(scope)
  assert.notEqual(a.launchId, b.launchId)
  assert.equal(sameTarget(a, b), false)
  assert.equal(sameTarget(a, JSON.parse(JSON.stringify(a))), true)
  assert.notEqual(targetKey({ ...scope, draft: true }), targetKey({ ...scope, cwd: '/other', draft: true }))
})

test('saved session identity ignores project labels, views and late cwd discovery', () => {
  const a = { ...scope, id: 'session-a' }
  assert.equal(sameTarget(a, { ...a, slug: '/new-location', view: 'raw', title: 'renamed' }), true)
  assert.equal(sameTarget(a, { ...a, provider: 'claude' }), false)
  assert.equal(sameTarget(a, { ...a, root: 'account-b' }), false)
})

test('running dots distinguish same-folder drafts and preserve launch aliases after binding', () => {
  const a = newDraft(scope), b = newDraft(scope)
  const terminal = { ...scope, launchId: a.launchId, key: 'terminal-a', id: 'saved-a' }
  const keys = terminalTabKeys([terminal])
  assert.equal(keys.has(targetKey(a)), true)
  assert.equal(keys.has(targetKey(b)), false)
  assert.equal(keys.has(targetKey(liveTarget(terminal))), true)
  assert.equal(keys.has(targetKey({ ...a, terminalKey: terminal.key })), true)
  assert.equal(keys.has(targetKey({ ...a, provider: 'claude' })), false)
})

test('binding promotes the original draft and collapses a saved-session alias, preserving active tab', () => {
  const draft = newDraft(scope)
  const terminal = { ...scope, launchId: draft.launchId, key: 'stable-terminal', id: 'session-a', slug: scope.cwd }
  const bound = adoptTerminal(draft, terminal)
  assert.equal(bound.draft, false)
  assert.equal(bound.terminalKey, terminal.key)
  assert.equal(bound.launchId, draft.launchId)
  assert.equal(sameTarget(bound, liveTarget(terminal)), true)
  const tabs = [{ key: 'original', target: bound }, { key: 'history', target: { ...scope, id: terminal.id } }]
  assert.deepEqual(dedupeTabs(tabs, 'original').map((t) => t.key), ['original'])
  assert.deepEqual(dedupeTabs(tabs, 'history').map((t) => t.key), ['history'])
  assert.equal(adoptTerminal(newDraft(scope), terminal).terminalKey, undefined)
})

test('deep links restore exact drafts and saved sessions without creating project tabs', () => {
  for (const target of [newDraft(scope), { ...newDraft(scope), terminalKey: 'codex|root|launch|key' }, { ...scope, id: 'session-a' }]) {
    const restored = fromHash(toHash(target), ['codex'])
    assert.equal(sameTarget(target, restored), true)
    assert.equal(restored.cwd, scope.cwd)
  }
})

test('restoring transitive session/launch aliases leaves one tab and preserves its active key', () => {
  const draft = newDraft(scope)
  const saved = { ...scope, id: 'session-a' }
  const tabs = [
    { key: 'saved', target: saved },
    { key: 'draft', target: draft },
    { key: 'bridge', target: { ...draft, ...saved, terminalKey: 'exact', draft: false } },
  ]
  const result = dedupeTabs(tabs, 'draft')
  assert.equal(result.length, 1)
  assert.equal(result[0].key, 'draft')
  assert.equal(result[0].target.id, 'session-a')
  assert.equal(result[0].target.terminalKey, 'exact')
  assert.equal(result[0].target.draft, false)
})

test('reattach sends the server key only; it cannot silently resume or create another CLI', () => {
  assert.deepEqual(terminalRequest({ ...scope, id: 'other', terminalKey: 'exact' }), { root: scope.root, terminalKey: 'exact' })
  const draft = newDraft(scope)
  assert.equal(terminalRequest(draft).launchId, draft.launchId)
})

test('Live Enter preserves the current session, focuses existing aliases, and never leaves an empty tab', () => {
  const original = { tabs: [{ key: 'work', target: { ...scope, id: 'session-a' } }], activeKey: 'work' }
  const terminal = { ...scope, key: 'live-b', id: 'session-b' }
  const opened = openTabState(original, liveTarget(terminal))
  assert.equal(opened.tabs.length, 2)
  assert.deepEqual(opened.tabs[0], original.tabs[0])
  const again = openTabState(opened, liveTarget(terminal), { newTab: true })
  assert.equal(again.tabs.length, 2)
  assert.equal(again.activeKey, opened.activeKey)
  const history = openTabState(again, { ...scope, id: 'session-b', slug: '/late-cwd' }, { newTab: true })
  assert.equal(history.tabs.length, 2)
  assert.equal(history.tabs[1].target.terminalKey, 'live-b')
  assert.deepEqual(original.tabs.map((t) => t.key), ['work'])
})

test('legacy folder drafts acquire the exact old key without confusing new drafts', () => {
  const old = { ...scope, draft: true }
  const live = { ...scope, key: `${scope.root}|new|${scope.cwd}` }
  assert.equal(adoptTerminal(old, live).terminalKey, live.key)
  assert.equal(adoptTerminal(newDraft(scope), live).terminalKey, undefined)
})
