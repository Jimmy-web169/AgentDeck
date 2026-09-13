import { test, expect } from 'vitest'
import { createTabActions, type Tab } from '../../../src/store/shellTabs.ts'
import type { Target } from '../../../shared/types.js'

function fixture() {
  let state: import('../../../src/store/shellTabs.ts').TabState = {
    tabs: ['a', 'b', 'c'].map((key) => ({ key, target: { provider: 'claude', root: 'root', id: key } })),
    activeKey: 'b',
  }
  const closed: Tab[] = [],
    pending: (Target | null | undefined)[] = []
  const actions = createTabActions({
    read: () => state,
    commit: (next) => {
      state = next
    },
    notifyClosed: (tabs) => closed.push(...tabs),
    issuePending: (target) => pending.push(target),
    createHomeTab: () => ({ key: 'home', target: { provider: null, view: 'activity' } }),
  })
  return { actions, read: () => state, closed, pending }
}
test('closing the active tab chooses its neighbor and closing the last tab restores Home', () => {
  const fx = fixture()
  fx.actions.closeTab('b')
  expect(fx.read().activeKey).toBe('c')
  expect(fx.pending.at(-1)?.id).toBe('c')
  fx.actions.closeTab('a')
  expect(fx.pending).toHaveLength(1)
  fx.actions.closeTab('c')
  expect(fx.read()).toEqual({ tabs: [{ key: 'home', target: { provider: null, view: 'activity' } }], activeKey: 'home' })
  expect(fx.closed.map((tab) => tab.key)).toEqual(['b', 'a', 'c'])
})
test('close-right, close-others and reordering retain the selected target unless it is closed', () => {
  const fx = fixture()
  fx.actions.moveTab('c', 0)
  expect(fx.read().tabs.map((tab) => tab.key)).toEqual(['c', 'a', 'b'])
  expect(fx.read().activeKey).toBe('b')
  fx.actions.closeRight('a')
  expect(fx.read().activeKey).toBe('a')
  fx.actions.closeOthers('c')
  expect(fx.read().activeKey).toBe('c')
  expect(fx.closed.map((tab) => tab.key)).toEqual(['b', 'a'])
  expect(fx.pending.map((target) => target?.id)).toEqual(['a', 'c'])
  const state = fx.read()
  fx.actions.closeTab('missing')
  fx.actions.closeRight('missing')
  fx.actions.closeOthers('missing')
  expect(fx.read()).toBe(state)
})

test('detaching a tab removes it like closing, but never reports a closed terminal', () => {
  const fx = fixture()
  fx.actions.detachTab('b')
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['a', 'c'])
  expect(fx.read().activeKey).toBe('c')
  expect(fx.closed).toEqual([])
  expect(fx.pending).toHaveLength(1)
  fx.actions.closeTab('c')
  expect(fx.closed.map((t) => t.key)).toEqual(['c'])
})

function grouped() {
  const conv = { provider: 'claude', root: 'root', id: 'b', terminalKey: 'kb' }
  let state: import('../../../src/store/shellTabs.ts').TabState = {
    tabs: [
      { key: 'a', target: { provider: 'claude', root: 'root', id: 'a' } },
      { key: 'b', target: conv },
      { key: 'bt', target: { ...conv, kind: 'terminal' } },
      { key: 'c', target: { provider: 'claude', root: 'root', id: 'c' } },
    ],
    activeKey: 'bt',
  }
  const closed: Tab[] = [],
    pending: (Target | null | undefined)[] = []
  const actions = createTabActions({
    read: () => state,
    commit: (next) => {
      state = next
    },
    notifyClosed: (tabs) => closed.push(...tabs),
    issuePending: (target) => pending.push(target),
    createHomeTab: () => ({ key: 'home', target: { provider: null, view: 'activity' } }),
  })
  return { actions, read: () => state, closed, pending }
}
test('a conversation and its terminal sub-tab are one unit: closing, folding, others, right and moving', () => {
  let fx = grouped()
  fx.actions.closeTab('bt') // folding the terminal back returns to its conversation, reports nothing
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['a', 'b', 'c'])
  expect(fx.read().activeKey).toBe('b')
  expect(fx.closed).toEqual([])
  fx = grouped()
  fx.actions.closeTab('b') // closing the conversation takes the sub-tab, one notice
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['a', 'c'])
  expect(fx.closed.map((t) => t.key)).toEqual(['b'])
  expect(fx.read().activeKey).toBe('c')
  fx = grouped()
  fx.actions.closeOthers('bt')
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['b', 'bt'])
  expect(fx.read().activeKey).toBe('bt')
  expect(fx.closed.map((t) => t.key)).toEqual(['a', 'c'])
  fx = grouped()
  fx.actions.closeRight('a')
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['a'])
  expect(fx.closed.map((t) => t.key)).toEqual(['b', 'c'])
  fx = grouped()
  fx.actions.closeRight('bt')
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['a', 'b', 'bt'])
  fx = grouped()
  fx.actions.moveTab('bt', 0) // dragging the sub-tab moves its unit
  expect(fx.read().tabs.map((t) => t.key)).toEqual(['b', 'a', 'bt', 'c']) // the store's commit re-attaches the sub-tab
})
