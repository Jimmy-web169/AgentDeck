// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { getTermView, setTermView, subscribeTermView } from '../../../src/store/terminal.ts'

afterEach(() => localStorage.clear())

test('a terminal view is remembered per key, and a change made in another tab reaches a subscriber', () => {
  setTermView('claude|acc|session|one', 'popped')
  setTermView('codex|acc|launch|l2', 'hidden')
  expect(getTermView('claude|acc|session|one')).toBe('popped')
  expect(getTermView('codex|acc|launch|l2')).toBe('hidden')
  expect(getTermView('unknown')).toBeNull()
  expect(getTermView(null)).toBeNull()
  const listener = vi.fn()
  const stop = subscribeTermView(listener)
  // the popped-out page hands the terminal back: its write arrives here as a storage event
  localStorage.setItem('cm_termView', JSON.stringify({ 'codex|acc|launch|l2': 'hidden' }))
  window.dispatchEvent(new StorageEvent('storage', { key: 'cm_termView' }))
  expect(listener).toHaveBeenCalledTimes(1)
  expect(getTermView('claude|acc|session|one')).toBeNull()
  window.dispatchEvent(new StorageEvent('storage', { key: 'agentdeck_theme' }))
  expect(listener).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new StorageEvent('storage', { key: null })) // storage cleared
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
  window.dispatchEvent(new StorageEvent('storage', { key: 'cm_termView' }))
  expect(listener).toHaveBeenCalledTimes(2)
  // corrupt storage reads as no views
  localStorage.setItem('cm_termView', '[1,2]')
  expect(getTermView('codex|acc|launch|l2')).toBeNull()
})
