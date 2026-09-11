// @vitest-environment jsdom
import { test, vi, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { renderWithQuery as render, mockProviderApi } from '../helpers/query.ts'
import { userEvent } from '@testing-library/user-event'
import ClaudeTerminal from '../../src/components/claude/TerminalPanel.tsx'
import CodexTerminal from '../../src/components/codex/TerminalPanel.tsx'
import { ProviderApiContext } from '../../src/api/index.ts'
import { LINK_HINT_MS } from '../../src/lib/terminalStatus.ts'
import { shellActions } from '../../src/store/index.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('ending an exact terminal closes its iframe; restarting the same key stays open', async () => {
  const result = { key: 'restart-fixture', url: 'about:blank' }
  const api = mockProviderApi('codex', { terminal: vi.fn(async () => result) })
  const user = userEvent.setup()
  render(
    <ProviderApiContext.Provider value={api}>
      <CodexTerminal root="r" cwd="/fixture" slug="repo" isNew />
    </ProviderApiContext.Provider>
  )
  await user.click(screen.getByRole('button', { name: /Open terminal in/ }))
  const initial = await screen.findByTitle('agent terminal')
  await act(async () => shellActions.terminalEnded('claude', result.key))
  assert.equal(screen.getByTitle('agent terminal'), initial, 'another provider cannot close this viewer')
  await act(async () => shellActions.terminalEnded('codex', result.key))
  assert.equal(screen.queryByTitle('agent terminal'), null)
  await user.click(screen.getByRole('button', { name: /Open terminal in/ }))
  await screen.findByTitle('agent terminal')
  assert.equal(api.terminal.mock.calls.length, 2)
})

test('repair is nested in status details, not a toolbar action; the dialog has no folder picker', async () => {
  const result = { key: 'fixture-terminal', url: 'about:blank', canBindSession: true }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const parsed = new URL(url, 'http://fixture.invalid')
      assert.ok(['/api/claude/terminal', '/api/claude/projects'].includes(parsed.pathname), `Unexpected fixture request: ${url}`)
      return new Response(JSON.stringify(parsed.pathname.endsWith('/projects') ? { projects: [] } : result), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
  )
  const user = userEvent.setup()
  for (const provider of ['claude', 'codex']) {
    const Panel = provider === 'claude' ? ClaudeTerminal : CodexTerminal
    const api = mockProviderApi(provider, { terminal: async () => result, projects: async () => ({ projects: [] }) })
    render(
      <ProviderApiContext.Provider value={api}>
        <Panel root="r" cwd="/fixture" slug="repo" isNew />
      </ProviderApiContext.Provider>
    )
    assert.equal(screen.queryByRole('button', { name: 'Match current conversation manually' }), null)
    await user.click(screen.getByRole('button', { name: /Open terminal in/ }))
    await screen.findByTitle(provider === 'claude' ? 'claude terminal' : 'agent terminal')
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /^⟳(?: reload)?$/ }))
    const frame = screen.getByTitle(provider === 'claude' ? 'claude terminal' : 'agent terminal')
    // Trigger the same status transition under fake time, without waiting 20s.
    fireEvent.load(frame)
    assert.equal(screen.queryByText('Trouble detecting this conversation?'), null)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_HINT_MS)
    })
    vi.useRealTimers()
    await user.click(screen.getByText('Trouble detecting this conversation?'))
    const repair = screen.getByRole('button', { name: 'Match current conversation manually' })
    assert.ok(repair.closest('details'))
    assert.equal(screen.getAllByRole('button', { name: 'Match current conversation manually' }).length, 1)
    await user.click(repair)
    const dialog = screen.getByRole('dialog', { name: 'Match current conversation manually' })
    await within(dialog).findByText(/No matching conversations/)
    assert.equal(within(dialog).queryByRole('combobox'), null)
    assert.equal(within(dialog).queryByRole('textbox'), null)
    assert.match(dialog.textContent, /Current folder: \/fixture/)
    cleanup()
    localStorage.clear()
  }
})
