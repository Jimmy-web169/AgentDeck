// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Target } from '../../../../shared/types.d.ts'

// The tab attaches through the provider client; only the calls matter here.
const open = vi.fn(async () => ({ ok: true }))
const terminal = vi.fn(async () => ({ url: 'http://localhost:7682/x', key: 'claude|acc|session|one' }))
const terminalStop = vi.fn(async () => ({}))
vi.mock('../../../../src/api/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/api/index.ts')>()),
  createApi: () => ({ open, terminal, terminalStop }),
}))
import TerminalTabView from '../../../../src/components/shared/TerminalTabView.tsx'

afterEach(() => {
  cleanup()
  open.mockClear()
})

const target: Target = {
  kind: 'terminal',
  provider: 'claude',
  root: 'acc',
  slug: 'p',
  id: 'one',
  title: 'Fix the flaky test',
  cwd: '/home/demo/orbit-api',
  terminalKey: 'claude|acc|session|one',
}

test('the terminal tab keeps the VS Code and Terminal buttons in its bar, ahead of pop out and End', async () => {
  const user = userEvent.setup()
  render(createElement(TerminalTabView, { target }))
  await waitFor(() => expect(screen.getByTitle(/^Terminal · Fix/)).toBeTruthy())
  const vscode = screen.getByTitle('Open this project in VS Code')
  const term = screen.getByTitle('Open a terminal in this project')
  const popOut = screen.getByRole('button', { name: /pop out/ })
  const end = screen.getByRole('button', { name: /End/ })
  const bar = vscode.closest('header')
  expect(bar).toBeTruthy()
  expect(bar?.contains(term)).toBe(true)
  expect(bar?.contains(popOut)).toBe(true)
  // The bar names the conversation only; the tab strip and sidebar already say
  // which provider and folder it belongs to.
  expect(bar?.textContent).toContain('Fix the flaky test')
  expect(bar?.textContent).not.toContain('Claude Code')
  expect(bar?.textContent).not.toContain('/home/demo/orbit-api')
  // Same order as the panel header: open-with buttons, then the viewer controls.
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(follows(vscode, term)).toBe(true)
  expect(follows(term, popOut)).toBe(true)
  expect(follows(popOut, end)).toBe(true)
  // Both open at the conversation's folder through the provider's open endpoint.
  await user.click(vscode)
  expect(open).toHaveBeenCalledWith({ root: 'acc', id: 'one', slug: 'p' }, { what: 'vscode', cwd: '/home/demo/orbit-api' })
  await waitFor(() => expect(vscode.textContent).toContain('VS Code'))
  await user.click(term)
  expect(open).toHaveBeenCalledWith({ root: 'acc', id: 'one', slug: 'p' }, { what: 'terminal', cwd: '/home/demo/orbit-api' })
  expect(open).toHaveBeenCalledTimes(2)
})

test('a new conversation’s terminal tab opens the tools at its working folder', async () => {
  const user = userEvent.setup()
  render(createElement(TerminalTabView, { target: { ...target, id: null, title: null, terminalKey: 'claude|acc|launch|abc', launchId: 'abc', draft: true } }))
  await waitFor(() => expect(screen.getByTitle('Open a terminal in this project')).toBeTruthy())
  await user.click(screen.getByTitle('Open a terminal in this project'))
  expect(open).toHaveBeenCalledWith({ root: 'acc', id: null, slug: 'p' }, { what: 'terminal', cwd: '/home/demo/orbit-api' })
})

test('a failed open is reported in the bar and the terminal stays', async () => {
  const user = userEvent.setup()
  open.mockRejectedValueOnce(new Error('code: command not found'))
  render(createElement(TerminalTabView, { target }))
  const frame = await waitFor(() => screen.getByTitle(/^Terminal · Fix/))
  await user.click(screen.getByTitle('Open this project in VS Code'))
  await waitFor(() => expect(screen.getByText(/code: command not found/)).toBeTruthy())
  expect(document.body.contains(frame)).toBe(true)
})
