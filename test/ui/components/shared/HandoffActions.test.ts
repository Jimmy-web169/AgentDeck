import { mockProviderApi } from '../../../helpers/query.ts'
// @vitest-environment jsdom
import { type Attributes, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderApiContext } from '../../../../src/api/index.ts'
import Actions from '../../../../src/components/shared/HandoffActions.tsx'
// Original group: conversation-export-ui. Case names and assertions are retained.
import { test, vi, afterEach } from 'vitest'
import { render as renderDom, screen, cleanup } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import ClaudeTerminal from '../../../../src/components/claude/TerminalPanel.tsx'
import CodexTerminal from '../../../../src/components/codex/TerminalPanel.tsx'
import { describe } from 'vitest'
import assert from 'node:assert/strict'
import { shell } from '../../../../src/store/index.ts'
import type { Target } from '../../../../shared/types.js'

describe('HandoffActions', () => {
  const actions = (props: (Attributes & Target & { disabled?: boolean }) | null | undefined) => renderToStaticMarkup(createElement(Actions, props))

  test('saved conversations have two local actions; unsaved conversations have neither', async () => {
    const html = actions({ provider: 'future', root: 'r', id: 's' })
    assert.match(html, /Continue with another AI/)
    assert.match(html, /Export JSONL/)
    assert.equal(actions({ provider: 'future', root: 'r' }), '')
    const user = userEvent.setup()
    const terminalResult = { key: 'fixture-terminal', url: 'about:blank', canBindSession: false }
    const stop = vi.fn(async () => ({}))
    const start = vi.fn(async (url) => {
      assert.equal(url, '/api/claude/terminal', 'only the fixture terminal endpoint may be requested')
      return new Response(JSON.stringify(terminalResult), { headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', start)
    vi.spyOn(window, 'open').mockReturnValue({ focus() {}, close() {} } as Window)
    for (const provider of ['claude', 'codex']) {
      const api = mockProviderApi(provider, { terminal: vi.fn(async () => terminalResult), terminalStop: stop })
      renderDom(
        createElement(
          ProviderApiContext.Provider,
          { value: api },
          createElement(provider === 'claude' ? ClaudeTerminal : CodexTerminal, {
            root: 'r',
            slug: 'repo',
            id: 'saved',
            cwd: '/fixture',
            title: 'Saved conversation',
          })
        )
      )
      const assertActions = async () => {
        const received: NonNullable<ReturnType<typeof shell.store.getState>['handoffRequest']>[] = []
        const unsubscribe = shell.store.subscribe((state, previous) => {
          if (state.handoffRequest && state.handoffRequest !== previous.handoffRequest) received.push(state.handoffRequest)
        })
        try {
          await user.click(screen.getByRole('button', { name: 'Continue with another AI' }))
          await user.click(screen.getByRole('button', { name: 'Export JSONL' }))
          assert.deepEqual(
            received.map((entry) => entry.mode),
            ['send', 'export']
          )
          for (const entry of received)
            assert.deepEqual(entry.source, {
              provider,
              root: 'r',
              slug: 'repo',
              id: 'saved',
              cwd: '/fixture',
              title: 'Saved conversation',
            })
        } finally {
          unsubscribe()
        }
      }
      await assertActions() // collapsed
      await user.click(screen.getByRole('button', { name: /Continue in a terminal|Open terminal \(continue this session\)/ }))
      await screen.findByTitle(provider === 'claude' ? 'claude terminal' : 'agent terminal')
      await assertActions() // embedded
      await user.click(screen.getByRole('button', { name: /hide/ }))
      await screen.findByText(/Terminal hidden/)
      await assertActions() // hidden
      await user.click(screen.getByRole('button', { name: /pop out/ }))
      await screen.findByText(/Terminal running in a separate tab/)
      await assertActions() // popped
      assert.equal(stop.mock.calls.length, 0, 'hiding and popping out preserve the running terminal')
      assert.equal((provider === 'claude' ? start : api.terminal).mock.calls.length, 1)
      cleanup()
      localStorage.clear()
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})
