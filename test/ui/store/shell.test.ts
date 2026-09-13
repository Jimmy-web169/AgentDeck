import { required } from '../../helpers/assert.ts'
// @vitest-environment jsdom
import { test, expect, afterEach, vi } from 'vitest'
import { createShellStore } from '../../../src/store/shell.ts'

afterEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})
const target = { provider: 'codex', root: 'r', slug: 'project', id: 'one', title: 'Saved' }
test('opening, focusing and closing tabs preserve one saved target and the mounted terminal identity', () => {
  const { store, actions } = createShellStore(['codex'])
  const terminal = { ...target, key: 'fixture-terminal', launchId: 'launch', url: 'about:blank' }
  actions.connect({ readTerminals: () => [terminal], updateTerminal: () => {} })
  actions.openTarget(target, { newTab: true })
  const selected = store.getState().state.activeKey
  actions.openTarget({ ...target, title: 'Updated' }, { newTab: true })
  expect(store.getState().state.tabs).toHaveLength(2)
  expect(store.getState().state.activeKey).toBe(selected)
  expect(required(store.getState().pendingOpen).terminalKey).toBe(terminal.key)
  actions.closeTab(selected)
  expect(store.getState().state.tabs).toHaveLength(1)
  expect(required(store.getState().closedRunning)[0]?.terminalKey).toBe(terminal.key)
})
test('pending navigation rejects a stale app report and terminal end clears only its exact tab', () => {
  const { store, actions } = createShellStore(['codex'])
  actions.openTarget({ ...target, terminalKey: 'first', launchId: 'launch-one' }, { newTab: true })
  actions.openTarget({ ...target, id: 'two', terminalKey: 'second', launchId: 'launch-two' }, { newTab: true })
  actions.onNavigate('codex', target)
  expect(required(store.getState().pendingOpen).id).toBe('two')
  actions.terminalEnded('codex', 'first')
  const saved = store.getState().state.tabs.filter((tab) => tab.target?.provider)
  expect(required(required(saved.find((tab) => tab.target?.id === 'one')).target).terminalKey).toBeUndefined()
  expect(required(required(saved.find((tab) => tab.target?.id === 'two')).target).terminalKey).toBe('second')
  expect(required(store.getState().pendingOpen).id).toBe('two')
})
test('handoff and folder reveal are typed state transitions; dashboard completion closes just its layout', () => {
  const { store, actions } = createShellStore(['codex'])
  actions.setCollapsed(true)
  actions.revealFolder('folder-one')
  expect(store.getState().collapsed).toBe(false)
  expect(store.getState().folderFocus).toEqual({ folderId: 'folder-one' })
  actions.requestHandoff({ mode: 'send', source: target })
  expect(store.getState().handoffRequest).toEqual({ mode: 'send', source: target })
  actions.openTarget(target, { newTab: true })
  actions.openDeckView({ kind: 'dashboard', dashboardId: 'layout-one' })
  actions.dashboardEnded('layout-one')
  expect(store.getState().state.tabs.some((tab) => tab.target?.id === 'one')).toBe(true)
  expect(store.getState().state.tabs.some((tab) => tab.target?.dashboardId === 'layout-one')).toBe(false)
})

test('a terminal moves to its own tab beside the conversation, comes back on request, and leaves with its terminal', () => {
  const { store, actions } = createShellStore(['codex'])
  const conversation = { ...target, terminalKey: 'codex|r|session|one', launchId: 'launch-one' }
  actions.openTarget({ provider: 'codex', root: 'r', id: 'zero', title: 'Other' }, { newTab: true })
  actions.openTarget(conversation, { newTab: true })
  actions.openTarget({ provider: 'codex', root: 'r', id: 'two', title: 'Later' }, { newTab: true })
  const keys = () => store.getState().state.tabs.map((t) => (t.target?.kind === 'terminal' ? `term:${t.target.id}` : t.target?.id || 'home'))
  expect(keys()).toEqual(['home', 'zero', 'one', 'two'])
  // "to tab": right after its conversation, active, deduplicated
  actions.popOutToTab(conversation)
  expect(keys()).toEqual(['home', 'zero', 'one', 'term:one', 'two'])
  const termKey = store.getState().state.activeKey
  expect(store.getState().state.tabs.find((t) => t.key === termKey)?.target).toMatchObject({ kind: 'terminal', terminalKey: 'codex|r|session|one' })
  actions.popOutToTab(conversation)
  expect(keys()).toEqual(['home', 'zero', 'one', 'term:one', 'two'])
  // back: the conversation tab is focused and the terminal tab folds away without a "still running" notice
  actions.backToSession({ ...conversation, kind: 'terminal' })
  expect(keys()).toEqual(['home', 'zero', 'one', 'two'])
  expect(store.getState().state.tabs[store.getState().state.tabs.findIndex((t) => t.target?.id === 'one')].key).toBe(store.getState().state.activeKey)
  expect(store.getState().closedRunning).toBeNull()
  // closing the conversation closes its unit: the sub-tab goes with it
  actions.popOutToTab(conversation)
  const conversationKey = store.getState().state.tabs.find((t) => t.target?.id === 'one' && t.target?.kind !== 'terminal')?.key
  actions.closeTab(conversationKey)
  expect(keys()).toEqual(['home', 'zero', 'two'])
  // a terminal link with no conversation tab opens as a unit: the conversation tab is created for it
  actions.openTarget({ ...conversation, kind: 'terminal' })
  expect(keys()).toEqual(['home', 'zero', 'two', 'one', 'term:one'])
  expect(store.getState().state.activeKey).toBe(store.getState().state.tabs.find((t) => t.target?.kind === 'terminal')?.key)
  actions.backToSession({ ...conversation, kind: 'terminal' })
  expect(keys()).toEqual(['home', 'zero', 'two', 'one'])
  // a stored orphan sub-tab is repaired on load
  localStorage.setItem(
    'agentdeck_tabs',
    JSON.stringify({
      tabs: [
        { key: 'x', target: { ...conversation, kind: 'terminal' } },
        { key: 'y', target: { provider: 'codex', root: 'r', id: 'two' } },
      ],
      activeKey: 'x',
    })
  )
  const loaded = createShellStore(['codex']).store.getState().state
  expect(loaded.tabs.map((t) => (t.target?.kind === 'terminal' ? 'term' : t.target?.id))).toEqual(['one', 'term', 'two'])
  expect(loaded.activeKey).toBe('x')
  localStorage.removeItem('agentdeck_tabs')
  // the terminal ending closes its sub-tab
  actions.popOutToTab(conversation)
  expect(keys()).toEqual(['home', 'zero', 'two', 'one', 'term:one'])
  actions.terminalEnded('codex', 'codex|r|session|one')
  expect(keys()).toEqual(['home', 'zero', 'two', 'one'])
  expect(store.getState().closedRunning).toBeNull()
  // a terminal sub-tab survives a reload as itself, beside its conversation
  actions.popOutToTab(conversation)
  const reloaded = createShellStore(['codex']).store.getState().state.tabs
  const at = reloaded.findIndex((t) => t.target?.kind === 'terminal' && t.target.terminalKey === 'codex|r|session|one')
  expect(at).toBeGreaterThan(0)
  expect(reloaded[at - 1].target).toMatchObject({ id: 'one' })
  expect(reloaded[at - 1].target?.kind).toBeUndefined()
})
