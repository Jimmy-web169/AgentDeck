// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import TerminalPanel, { type TerminalPresentation } from '../../../../src/components/shared/TerminalPanel.tsx'
import type { ProviderClient } from '../../../../src/api/providerApi.ts'
import { shell, shellActions } from '../../../../src/store/index.ts'

// A neutral presentation: the folded bars do not read the provider's geometry.
const presentation: TerminalPresentation = {
  sessionKey: (root, _slug, id) => ['claude', root, 'session', id].join('|'),
  height: { key: 'test-terminal-height', minimum: 160, maximum: 1200, fallback: () => 320 },
  continueLabel: '▸ Continue in terminal',
  endTitle: 'End the running CLI',
  panelClass: 'flex flex-col',
  headerClass: 'flex items-center gap-2',
  reloadClass: '',
  reloadLabel: '↻ reload',
  idleContext: false,
  headerError: false,
  wrapFrame: false,
  frameTitle: 'Terminal',
}
const Nothing = () => null
const key = 'claude|acc|session|one'
const api = {
  provider: 'claude',
  terminal: vi.fn(async () => ({ url: 'http://localhost:7682/x', key, canBindSession: false })),
  terminalStop: vi.fn(async () => ({})),
} as unknown as ProviderClient
const session = { root: 'acc', slug: 'p', id: 'one', cwd: '/home/demo/orbit-api', title: 'Fix the flaky test' }

let initial: ReturnType<typeof shell.store.getState>
beforeEach(() => {
  initial = shell.store.getState()
})
afterEach(() => {
  cleanup()
  shell.store.setState(initial, true)
})

test('while its terminal lives in a tab, the folded panel bar keeps the VS Code and Terminal buttons', async () => {
  const user = userEvent.setup()
  const onOpenTool = vi.fn(async () => ({}))
  shellActions.popOutToTab({ provider: 'claude', ...session, terminalKey: key })
  render(
    createElement(TerminalPanel, { api, presentation, ContextMeter: Nothing, IdleNote: Nothing, Title: Nothing, ...session, terminalKey: key, onOpenTool })
  )
  await waitFor(() => expect(screen.getByText('Terminal open in its own tab')).toBeTruthy())
  expect(screen.getByRole('button', { name: /focus tab/ })).toBeTruthy()
  await user.click(screen.getByTitle('Open this project in VS Code'))
  expect(onOpenTool).toHaveBeenCalledWith('vscode')
  await user.click(screen.getByTitle('Open a terminal in this project'))
  expect(onOpenTool).toHaveBeenCalledWith('terminal')
})

test('the embedded panel header still carries the same buttons', async () => {
  const onOpenTool = vi.fn(async () => ({}))
  render(
    createElement(TerminalPanel, { api, presentation, ContextMeter: Nothing, IdleNote: Nothing, Title: Nothing, ...session, terminalKey: key, onOpenTool })
  )
  await waitFor(() => expect(screen.getByTitle('Terminal')).toBeTruthy())
  expect(screen.getByTitle('Open this project in VS Code')).toBeTruthy()
  expect(screen.getByRole('button', { name: /to tab/ })).toBeTruthy()
})
