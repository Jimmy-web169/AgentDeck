// @vitest-environment jsdom
import { test, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../src/api/index.ts'
import useAppShell, { bindShellShortcuts } from '../../src/lib/useAppShell.ts'
import { shell, shellActions } from '../../src/store/index.ts'
import type { ShellProvider } from '../../src/lib/useShellNavigation.ts'

test('shell keyboard bindings preserve search/sidebar toggles, Alt tab actions and terminal exclusions', () => {
  const initial = shell.store.getState(),
    unbind = bindShellShortcuts()
  const key = (code: string, modifiers = {}, target: EventTarget = window) => {
    const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...modifiers })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  try {
    shellActions.setSearchOpen(false)
    shellActions.setSearchNewTab(true)
    expect(key('KeyK', { ctrlKey: true })).toBe(true)
    expect(shell.store.getState().searchOpen).toBe(true)
    expect(shell.store.getState().searchNewTab).toBe(false)
    key('KeyP', { metaKey: true })
    expect(shell.store.getState().searchOpen).toBe(false)
    shellActions.setCollapsed(false)
    key('KeyB', { ctrlKey: true })
    expect(shell.store.getState().collapsed).toBe(true)
    const count = shell.store.getState().state.tabs.length
    expect(key('KeyT', { ctrlKey: true })).toBe(false)
    expect(key('KeyT', { altKey: true, shiftKey: true })).toBe(false)
    expect(shell.store.getState().state.tabs).toHaveLength(count)
    key('KeyT', { altKey: true })
    expect(shell.store.getState().searchOpen).toBe(true)
    expect(shell.store.getState().searchNewTab).toBe(true)
    expect(shell.store.getState().state.tabs).toHaveLength(count)
    shellActions.openTarget({ provider: 'codex', root: 'fixture', id: 'one' }, { newTab: true })
    shellActions.openTarget({ provider: 'codex', root: 'fixture', id: 'two' }, { newTab: true })
    const tabs = shell.store.getState().state.tabs
    expect(tabs).toHaveLength(count + 2)
    key('Digit1', { altKey: true })
    expect(shell.store.getState().state.activeKey).toBe(tabs[0].key)
    key('BracketLeft', { altKey: true })
    expect(shell.store.getState().state.activeKey).toBe(tabs.at(-1)?.key)
    key('BracketRight', { altKey: true })
    expect(shell.store.getState().state.activeKey).toBe(tabs[0].key)
    key('Digit2', { altKey: true })
    expect(shell.store.getState().state.activeKey).toBe(tabs[1].key)
    key('Digit9', { altKey: true })
    expect(shell.store.getState().state.activeKey).toBe(tabs.at(-1)?.key)
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    document.body.append(terminal)
    expect(key('KeyW', { altKey: true }, terminal)).toBe(false)
    expect(shell.store.getState().state.tabs).toHaveLength(count + 2)
    terminal.remove()
    key('KeyW', { altKey: true })
    expect(shell.store.getState().state.tabs).toHaveLength(count + 1)
    // Alt+→ / ← step like Alt+] / Alt+[, over units; Alt+↓/↑ move inside one; text fields keep their keys
    shellActions.openTarget({ provider: 'codex', root: 'fixture', id: 'three', terminalKey: 'codex|fixture|session|three' }, { newTab: true })
    shellActions.popOutToTab({ provider: 'codex', root: 'fixture', id: 'three', terminalKey: 'codex|fixture|session|three' })
    const state = () => shell.store.getState().state
    const sub = state().tabs.find((t) => t.target?.kind === 'terminal')
    const parent = state().tabs.find((t) => t.target?.id === 'three' && t.target?.kind !== 'terminal')
    expect(state().activeKey).toBe(sub?.key)
    key('ArrowUp', { altKey: true })
    expect(state().activeKey).toBe(parent?.key)
    key('ArrowDown', { altKey: true })
    expect(state().activeKey).toBe(sub?.key)
    key('ArrowLeft', { altKey: true }) // the unit before
    expect(state().activeKey).toBe(state().tabs.find((t) => t.target?.id === 'one')?.key)
    key('ArrowRight', { altKey: true }) // back into the unit, on the segment last used
    expect(state().activeKey).toBe(sub?.key)
    key('Digit9', { altKey: true })
    expect(state().activeKey).toBe(sub?.key)
    const field = document.createElement('textarea')
    document.body.append(field)
    expect(key('ArrowLeft', { altKey: true }, field)).toBe(false)
    expect(state().activeKey).toBe(sub?.key)
    field.remove()
    key('KeyW', { altKey: true }) // on the sub-tab: folds it back to the conversation
    expect(state().tabs.some((t) => t.target?.kind === 'terminal')).toBe(false)
    expect(state().activeKey).toBe(parent?.key)
    key('KeyW', { altKey: true }) // on the conversation: closes the unit
    expect(state().tabs.some((t) => t.target?.id === 'three')).toBe(false)
    unbind()
    shellActions.setSearchOpen(false)
    expect(key('KeyT', { altKey: true })).toBe(false)
    expect(shell.store.getState().searchOpen).toBe(false)
    expect(shell.store.getState().state.tabs).toHaveLength(count + 1)
  } finally {
    unbind()
    shell.store.setState(initial, true)
  }
})

test('sidebar width changes do not rerender the App shell subscription', async () => {
  const initial = shell.store.getState(),
    client = createQueryClient(),
    providers: ShellProvider[] = []
  vi.stubGlobal(
    'EventSource',
    class {
      close() {}
    }
  )
  const wrapper = ({ children }: { children: import('react').ReactNode }) => createElement(QueryClientProvider, { client }, children)
  let renders = 0
  const hook = renderHook(
    () => {
      renders++
      return useAppShell(providers)
    },
    { wrapper }
  )
  try {
    await act(async () => {})
    const before = renders
    act(() => shellActions.setSidebarW(420))
    expect(renders).toBe(before)
    act(() => shellActions.setSearchOpen(!shell.store.getState().searchOpen))
    expect(renders).toBeGreaterThan(before)
  } finally {
    hook.unmount()
    client.clear()
    shell.store.setState(initial, true)
    vi.unstubAllGlobals()
  }
})
