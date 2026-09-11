// @vitest-environment jsdom
import { test, vi, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, cleanup, act } from '@testing-library/react'
import TerminalStatus from '../../../../src/components/shared/TerminalStatus.tsx'
import { LINK_HINT_MS } from '../../../../src/lib/terminalStatus.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('TerminalStatus announces progress in English and delays repair until a loaded terminal remains unbound', async () => {
  vi.useFakeTimers()
  const props = { running: true, frameLoaded: false, terminalKey: 'fixture', repair: <button type="button">Repair</button> }
  const view = render(<TerminalStatus {...props} />)
  assert.equal(screen.getByRole('status').textContent, 'Opening terminal view…')
  assert.doesNotMatch(view.container.textContent, /\p{Script=Han}/u)
  assert.equal(screen.queryByText('Trouble detecting this conversation?'), null)
  view.rerender(<TerminalStatus {...props} frameLoaded />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LINK_HINT_MS)
  })
  assert.match(screen.getByRole('status').textContent, /Conversation record not detected yet/)
  assert.ok(screen.getByRole('button', { name: 'Repair', hidden: true }).closest('details'))
  view.rerender(<TerminalStatus {...props} frameLoaded id="saved" transcriptReady />)
  assert.equal(screen.getByRole('status').textContent, 'Terminal is running · conversation synced')
  assert.equal(screen.queryByText('Trouble detecting this conversation?'), null)
})
