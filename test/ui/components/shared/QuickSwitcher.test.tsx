// @vitest-environment jsdom
import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { mockNavIndex, mockProvider, renderWithQuery } from '../../../helpers/query.ts'
import QuickSwitcher from '../../../../src/components/shared/QuickSwitcher.tsx'

vi.mock('../../../../src/lib/prefs.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/prefs.ts')>()),
  usePrefs: () => ({ sidebarMode: 'folder' }),
}))
vi.mock('../../../../src/lib/useFolderCatalog.ts', () => ({
  default: () => ({
    loading: false,
    error: '',
    folders: [
      {
        id: 'fixture-folder',
        name: 'Example',
        cwd: '/fixture/example',
        resolved: true,
        sessionCount: 0,
        sources: [{ provider: 'codex', root: 'fixture', rootLabel: 'Work', slug: 'example', cwd: '/fixture/example', sessionCount: 0 }],
      },
    ],
  }),
}))

afterEach(cleanup)

test('pointer folder drill-down retains search focus so Escape returns and then closes', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  renderWithQuery(
    <QuickSwitcher
      open
      onClose={onClose}
      onPick={vi.fn()}
      onNewConversation={vi.fn()}
      index={mockNavIndex({ sessionsFor: () => [] })}
      providers={[mockProvider('codex', 'Codex')]}
      recent={[]}
      live={{ ids: new Set(), slugs: new Set() }}
      openTabs={new Set()}
    />
  )
  const input = screen.getByRole('textbox')
  const browse = screen.getByTitle(/Browse this folder/)
  const dialog = screen.getByRole('dialog')
  assert.ok(dialog.lastElementChild?.textContent?.includes('new tab'))
  await user.hover(browse)
  await waitFor(() => assert.ok(!dialog.lastElementChild?.textContent?.includes('new tab')))
  await user.click(browse)
  await screen.findByText('New conversation · Codex')
  assert.equal(document.activeElement, input)
  await user.keyboard('{Escape}')
  await waitFor(() => assert.ok(screen.getByTitle(/Browse this folder/)))
  assert.equal(onClose.mock.calls.length, 0)
  assert.equal(document.activeElement, input)
  await user.keyboard('{Escape}')
  assert.equal(onClose.mock.calls.length, 1)
})
