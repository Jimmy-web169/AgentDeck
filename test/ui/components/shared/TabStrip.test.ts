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
