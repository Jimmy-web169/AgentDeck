// @vitest-environment jsdom
import { createElement } from 'react'
import { test, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { renderWithQuery, mockNavSession } from '../../../helpers/query.ts'
import SubagentExplorer, { explorerEntries } from '../../../../src/components/shared/SubagentExplorer.tsx'
import type { ConversationProps } from '../../../../src/components/shared/Conversation.tsx'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('nested workflow agents and plain agents retain distinct transcript identities', () => {
  const entries = explorerEntries(
    { agents: [{ id: 'same' }], runs: [{ runId: 'run', agents: [{ id: 'same' }], phases: [], elapsedMs: 0, agentCount: 1, totals: {} }] },
    { provider: 'claude', root: 'a', slug: 'project', id: 'parent' },
    true
  )
  expect(entries).toHaveLength(2)
  expect(entries[0].key).not.toBe(entries[1].key)
  expect(entries[1].target.ref).toEqual({ provider: 'claude', root: 'a', slug: 'project', id: 'parent', agent: 'same', run: 'run' })
  expect(explorerEntries({ children: [{ id: 'child' }] }, { provider: 'antigravity', root: 'b', id: 'parent' }, false)[0].target).toEqual({
    kind: 'session',
    ref: { provider: 'antigravity', root: 'b', id: 'child' },
  })
})

function Transcript({ data }: ConversationProps) {
  return createElement('p', null, `Viewing ${data.summary.id}`)
}
test('the pane lists agent status first, opens a transcript only on click, and returns to the list without touching the main session', async () => {
  const send = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), 'http://fixture')
    return Response.json(
      url.pathname.endsWith('/subagents')
        ? {
            children: [
              { id: 'first', title: 'First agent', status: 'running', agentRole: 'explorer', tokens: { output: 1200 } },
              { id: 'second', title: 'Second agent', status: 'done', assistantTurns: 3 },
            ],
          }
        : { summary: mockNavSession({ id: url.searchParams.get('id') || '' }), timeline: [] }
    )
  })
  vi.stubGlobal('fetch', send)
  const props = { provider: 'codex', ctx: { root: 'r', id: 'parent' }, nested: false, active: false, Conversation: Transcript, onClose: vi.fn() }
  const view = renderWithQuery(createElement(SubagentExplorer, props))
  expect(send).not.toHaveBeenCalled()
  view.rerender(createElement(SubagentExplorer, { ...props, active: true }))
  const first = await view.findByRole('button', { name: /First agent/ })
  // Status rows come first, in the Sub-agents tab's idiom; no transcript is requested yet.
  expect(first.textContent).toContain('explorer')
  expect(first.textContent).toContain('running')
  expect(view.getByRole('button', { name: /Second agent/ }).textContent).toContain('3 replies')
  expect(view.queryByText(/^Viewing /)).toBeNull()
  expect(send.mock.calls.some(([input]) => String(input).includes('/session?'))).toBe(false)
  fireEvent.click(view.getByRole('button', { name: /Second agent/ }))
  await view.findByText('Viewing second')
  expect(view.queryByRole('button', { name: /First agent/ })).toBeNull()
  expect(view.getByText('Second agent')).toBeTruthy()
  expect(send.mock.calls.some(([input]) => String(input).includes('/session?') && String(input).includes('id=parent'))).toBe(false)
  fireEvent.click(view.getByRole('button', { name: 'Back to subagent list' }))
  expect(view.queryByText('Viewing second')).toBeNull()
  expect(view.getByRole('button', { name: /First agent/ })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Close sub-agent pane' }))
  expect(props.onClose).toHaveBeenCalledOnce()
})
