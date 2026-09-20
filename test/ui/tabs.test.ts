import { required } from '../helpers/assert.ts'
// Original test group: tab-identity. Assertions retained during module-path migration.
import { expect, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  isHome,
  isTerminalTab,
  sessionTargetOf,
  tabLabel,
  groupTabs,
  unitOf,
  unitKeys,
  normalizeGroups,
  unitEntry,
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
import { toHash, fromHash } from '../../src/lib/route.ts'

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

test('a tab follows its live terminal’s listed title, and never another conversation’s', () => {
  const draft = newDraft({ ...scope, title: 'New conversation' })
  const terminal = { ...scope, launchId: draft.launchId, key: 'terminal-a', id: 'saved-a', title: null }
  // bound before the first prompt: the placeholder stays until a title exists
  const bound = adoptTerminal(draft, terminal)
  assert.equal(bound.id, 'saved-a')
  assert.equal(bound.title, 'New conversation')
  // the server learned the first prompt: the tab shows it
  const titled = adoptTerminal(bound, { ...terminal, title: 'Fix the flaky test' })
  assert.equal(titled.title, 'Fix the flaky test')
  // a later rename follows too; a terminal without a title keeps the tab's
  assert.equal(adoptTerminal(titled, { ...terminal, title: 'Flaky test fixed' }).title, 'Flaky test fixed')
  assert.equal(adoptTerminal(titled, terminal).title, 'Fix the flaky test')
  // another conversation's terminal does not touch this tab
  const other = { ...scope, launchId: 'other-launch', key: 'terminal-b', id: 'saved-b', title: 'Other work' }
  assert.equal(adoptTerminal(titled, other).title, 'Fix the flaky test')
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

test('a terminal tab is its own tab beside the conversation: identity, label, deep link and running dot', () => {
  const session = {
    provider: 'claude',
    root: 'acc',
    slug: 'p',
    id: 'one',
    title: 'Fix the flaky test',
    project: 'orbit-api',
    terminalKey: 'claude|acc|session|one',
  }
  const term = { ...session, kind: 'terminal' }
  expect(isTerminalTab(term)).toBe(true)
  expect(isTerminalTab(session)).toBe(false)
  expect(sameTarget(session, term)).toBe(false)
  expect(sameTarget(term, { ...term, title: 'renamed' })).toBe(true)
  expect(targetKey(term)).toBe('claude|acc|terminal-tab|claude|acc|session|one')
  expect(sessionTargetOf(term)).toMatchObject({ ...session, kind: undefined })
  expect(sameTarget(sessionTargetOf(term), session)).toBe(true)
  expect(tabLabel(term, [{ id: 'claude', label: 'Claude Code' }])).toEqual({ primary: '>_ orbit-api', secondary: 'Fix the flaky test' })
  const hash = toHash(term)
  expect(hash).toBe('#/terminal/claude/acc/p/one?terminal=claude%7Cacc%7Csession%7Cone')
  expect(fromHash(hash, ['claude'])).toEqual({ provider: 'claude', root: 'acc', slug: 'p', id: 'one', terminalKey: 'claude|acc|session|one', kind: 'terminal' })
  expect(fromHash('#/terminal/', ['claude'])).toBeNull()
  // both tabs get the running dot; the terminal tab learns the saved conversation like the conversation tab
  const running = { provider: 'claude', root: 'acc', key: 'claude|acc|session|one', id: 'one', slug: 'p', title: 'Fix the flaky test', launchId: null }
  const keys = terminalTabKeys([running])
  expect(keys.has(targetKey(session))).toBe(true)
  expect(keys.has(targetKey(term))).toBe(true)
  const draftTerm = { provider: 'claude', root: 'acc', cwd: '/w', launchId: 'l1', terminalKey: 'claude|acc|launch|l1', draft: true, kind: 'terminal' }
  const bound = adoptTerminal(draftTerm, {
    provider: 'claude',
    root: 'acc',
    key: 'claude|acc|launch|l1',
    launchId: 'l1',
    id: 'saved',
    slug: 'p',
    title: 'Saved',
  })
  expect(bound).toMatchObject({ kind: 'terminal', id: 'saved', title: 'Saved', draft: false })
  // stored tabs keep terminal tabs apart from their conversations
  const deduped = dedupeTabs(
    [
      { key: 'a', target: session },
      { key: 'b', target: term },
    ],
    'a'
  )
  expect(deduped.map((t) => t.key)).toEqual(['a', 'b'])
})

test('units: a terminal sub-tab is filed under its conversation, an orphan is given one, a duplicate is dropped', () => {
  const one = { provider: 'claude', root: 'acc', id: 'one', terminalKey: 'k1' }
  const two = { provider: 'claude', root: 'acc', id: 'two', terminalKey: 'k2' }
  const tabs = [
    { key: 't2', target: { ...two, kind: 'terminal' } },
    { key: 'a', target: one },
    { key: 'home', target: { provider: null, view: 'activity' } },
    { key: 't1', target: { ...one, kind: 'terminal' } },
    { key: 't1dup', target: { ...one, kind: 'terminal', title: 'again' } },
    { key: 'b', target: two },
  ]
  const units = groupTabs(tabs)
  expect(units.map((u) => [u.tab.key, u.terminal?.key || null])).toEqual([
    ['a', 't1'],
    ['home', null],
    ['b', 't2'],
  ])
  expect(unitOf(tabs, 't2')?.tab.key).toBe('b')
  expect(unitOf(tabs, 'home')?.terminal).toBeNull()
  expect(unitOf(tabs, 'nope')).toBeNull()
  expect(unitKeys(units[0])).toEqual(['a', 't1'])
  expect(normalizeGroups(tabs).map((t) => t.key)).toEqual(['a', 't1', 'home', 'b', 't2'])
  // an orphan gets a conversation tab of its own, in place
  const repaired = normalizeGroups([
    { key: 'home', target: { provider: null, view: 'activity' } },
    { key: 't1', target: { ...one, kind: 'terminal' } },
  ])
  expect(repaired.map((t) => (t.key === 't1' ? 't1' : t.target?.id || 'home'))).toEqual(['home', 'one', 't1'])
  expect(repaired[1].target?.kind).toBeUndefined()
  expect(sameTarget(repaired[1].target, one)).toBe(true)
  // where a unit opens: the segment last used there
  expect(unitEntry(units[0], {})).toBe('a')
  expect(unitEntry(units[0], { a: 'terminal' })).toBe('t1')
  expect(unitEntry(units[1], { home: 'terminal' })).toBe('home')
})
