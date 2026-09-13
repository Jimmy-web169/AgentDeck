// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import TabStrip from '../../../../src/components/shared/TabStrip.tsx'

afterEach(cleanup)

test('tab keyboard activation leaves nested close buttons independently operable', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn(),
    onClose = vi.fn()
  render(
    createElement(TabStrip, {
      onReorder() {},
      onSearch() {},
      onHome() {},
      onCopyLink() {},
      onCloseOthers() {},
      onCloseRight() {},
      onNew() {},
      tabs: [
        { key: 'activity', target: { provider: null, view: 'activity' } },
        { key: 'stats', target: { provider: null, view: 'stats' } },
      ],
      activeKey: 'activity',
      providers: [],
      live: { ids: new Set<string>() },
      termKeys: new Set<string>(),
      onSelect,
      onClose,
    })
  )
  const [first, second] = screen.getAllByRole('tab')
  first.focus()
  await user.keyboard('{Enter} ')
  expect(onSelect.mock.calls).toEqual([['activity'], ['activity']])
  expect(onClose).not.toHaveBeenCalled()
  onSelect.mockClear()
  const close = within(second).getByRole('button', { name: /Close tab/ })
  close.focus()
  await user.keyboard('{Enter} ')
  expect(onClose.mock.calls).toEqual([['stats'], ['stats']])
  expect(onSelect).not.toHaveBeenCalled()
})

test('a terminal sub-tab renders as a glyph inside its conversation tab; the glyph selects it and middle-click folds it', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn(),
    onClose = vi.fn()
  const conv = { provider: 'claude', root: 'acc', id: 'one', title: 'Fix the flaky test', terminalKey: 'k1' }
  render(
    createElement(TabStrip, {
      onReorder() {},
      onSearch() {},
      onHome() {},
      onCopyLink() {},
      onCloseOthers() {},
      onCloseRight() {},
      onNew() {},
      tabs: [
        { key: 'home', target: { provider: null, view: 'activity' } },
        { key: 'c', target: conv },
        { key: 't', target: { ...conv, kind: 'terminal' } },
      ],
      activeKey: 't',
      providers: [{ id: 'claude', label: 'Claude Code' }] as never,
      live: { ids: new Set<string>() },
      termKeys: new Set<string>(),
      onSelect,
      onClose,
    })
  )
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((t) => t.getAttribute('aria-label') || t.textContent?.slice(0, 8))).toEqual(['Activity', 'Fix the ', 'terminal'])
  const glyph = screen.getByRole('tab', { name: 'terminal' })
  expect(glyph.getAttribute('aria-selected')).toBe('true')
  expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  await user.click(glyph)
  expect(onSelect).toHaveBeenLastCalledWith('t')
  await user.click(within(tabs[1]).getByText('Fix the flaky test'))
  expect(onSelect).toHaveBeenLastCalledWith('c')
  await user.pointer({ keys: '[MouseMiddle]', target: glyph })
  expect(onClose).toHaveBeenLastCalledWith('t')
})
