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
