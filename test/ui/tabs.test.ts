import { required } from '../helpers/assert.ts'
// Original test group: tab-identity. Assertions retained during module-path migration.
import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  isHome,
  loadTabs,
  TABS_KEY,
  terminalTabKeys,
  openTabState,
  adoptTerminal,
  dedupeTabs,
  liveTarget,
  newDraft,
  sameTarget,
  targetKey,
} from '../../src/lib/tabs.ts'

const scope = { provider: 'codex', root: 'account-a', cwd: '/work/project' }

test('new conversations in one folder have independent, stable identities', () => {
  const a = newDraft(scope),
    b = newDraft(scope)
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
  const a = newDraft(scope),
    b = newDraft(scope)
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
  const tabs = [
    { key: 'original', target: bound },
    { key: 'history', target: { ...scope, id: terminal.id } },
  ]
  assert.deepEqual(
    dedupeTabs(tabs, 'original').map((t) => t.key),
    ['original']
  )
  assert.deepEqual(
    dedupeTabs(tabs, 'history').map((t) => t.key),
    ['history']
  )
  assert.equal(adoptTerminal(newDraft(scope), terminal).terminalKey, undefined)
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
  assert.equal(required(result[0].target).id, 'session-a')
  assert.equal(required(result[0].target).terminalKey, 'exact')
  assert.equal(required(result[0].target).draft, false)
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
  assert.equal(required(history.tabs[1].target).terminalKey, 'live-b')
  assert.deepEqual(
    original.tabs.map((t) => t.key),
    ['work']
  )
})

test('legacy folder drafts acquire the exact old key without confusing new drafts', () => {
  const old = { ...scope, draft: true }
  const live = { ...scope, key: `${scope.root}|new|${scope.cwd}` }
  assert.equal(adoptTerminal(old, live).terminalKey, live.key)
  assert.equal(adoptTerminal(newDraft(scope), live).terminalKey, undefined)
})

test('legacy Home links round-trip without overriding current sidebar scope', () => {
  const target = { provider: null, view: 'resources', homeScope: { excluded: ['codex'] }, homeSource: { provider: 'claude', root: 'work' } }
  const prior = globalThis.localStorage
  try {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === TABS_KEY
          ? JSON.stringify({
              tabs: [
                { key: 'a', target },
                { key: 'b', target: { provider: null, view: 'stats', homeScope: { folder: 'folder-b', excluded: [] } } },
              ],
              activeKey: 'a',
            })
          : null,
    })
    const restored = loadTabs()
    assert.ok(restored)
    assert.deepEqual(required(restored.tabs[0].target).homeScope, target.homeScope)
    assert.deepEqual(required(restored.tabs[0].target).homeSource, target.homeSource)
    assert.deepEqual(required(restored.tabs[1].target).homeScope, { excluded: [] })
  } finally {
    if (prior === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else globalThis.localStorage = prior
  }
})

test('dashboard tabs are deduplicated views with no session ownership', () => {
  for (const target of [{ kind: 'dashboard', dashboardId: 'd' }]) {
    assert.equal(isHome(target), false)
    const a = openTabState({ tabs: [{ key: 's', target: { provider: 'codex', root: 'r', id: 'saved' } }], activeKey: 's' }, target, { newTab: true })
    const b = openTabState(a, target, { newTab: true })
    assert.equal(b.tabs.length, 2)
    assert.equal(required(b.tabs[0].target).id, 'saved')
  }
})

test('retired standalone folder links and stored tabs migrate to Activity; dashboards are unchanged', () => {
  const target = { kind: 'folder', folderId: 'a', title: 'Project' }
  const prev = globalThis.localStorage
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'old', target }], activeKey: 'old' }) : null) })
  try {
    assert.deepEqual(required(loadTabs()).tabs[0].target, { provider: null, view: 'activity', focus: null })
    assert.equal(required(loadTabs()).activeKey, 'old')
  } finally {
    if (prev === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else globalThis.localStorage = prev
  }
  const dashboard = { kind: 'dashboard', dashboardId: 'a' }
  assert.equal(isHome(dashboard), false)
})
