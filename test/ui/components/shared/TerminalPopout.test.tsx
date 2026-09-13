// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import TerminalPopout, { TerminalPage } from '../../../../src/components/shared/TerminalPopout.tsx'
import type { Target } from '../../../../shared/types.d.ts'

afterEach(cleanup)

const target: Target = {
  provider: 'claude',
  root: 'acc',
  slug: 'p',
  id: 'one',
  title: 'Fix the flaky test',
  cwd: '/home/demo/orbit-api',
  terminalKey: 'claude|acc|session|one',
}

test('the pop-out page fills the window with the exact terminal and its bar goes back to the conversation', async () => {
  const user = userEvent.setup()
  const attach = vi.fn(async (t: Target) => ({ url: `http://localhost:7682/?key=${encodeURIComponent(t.terminalKey || '')}` }))
  const onBack = vi.fn()
  render(createElement(TerminalPopout, { target, attach, onBack }))
  expect(document.title).toBe('Fix the flaky test · Claude Code terminal')
  expect(screen.getByText('connecting…')).toBeTruthy()
  const frame = await waitFor(() => screen.getByTitle('Terminal · Fix the flaky test'))
  expect(frame.getAttribute('src')).toBe('http://localhost:7682/?key=claude%7Cacc%7Csession%7Cone')
  expect(frame.className).toContain('h-full')
  expect(attach).toHaveBeenCalledWith(target)
  expect(screen.getByText('connected')).toBeTruthy()
  // A browser tab of its own has no other chrome, so the bar names the provider and folder too.
  expect(screen.getByText('Claude Code')).toBeTruthy()
  expect(screen.getByText('/home/demo/orbit-api')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /Back to session/ }))
  expect(onBack).toHaveBeenCalledWith(target)
  // reload asks the server again for the same terminal
  await user.click(screen.getByRole('button', { name: /reload/ }))
  await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
})

test('an ended terminal is reported in the bar and the page still offers the way back', async () => {
  const attach = vi.fn(async () => {
    throw Object.assign(new Error('This terminal has ended. Open a new conversation or resume its saved session.'), { status: 410 })
  })
  render(createElement(TerminalPopout, { target, attach, onBack() {} }))
  await waitFor(() => expect(screen.getByText(/This terminal has ended/)).toBeTruthy())
  expect(screen.queryByTitle(/^Terminal · /)).toBeNull()
  expect(screen.getByRole('button', { name: /Back to session/ })).toBeTruthy()
})

test('the shared terminal page takes extra actions beside its bar and titles nothing on its own', async () => {
  const attach = vi.fn(async () => ({ url: 'http://localhost:7682/x' }))
  const onBack = vi.fn()
  document.title = 'AgentDeck'
  render(createElement(TerminalPage, { target, attach, onBack, backTitle: 'fold back', actions: createElement('button', { type: 'button' }, 'End ✕') }))
  await waitFor(() => expect(screen.getByTitle(/^Terminal · Fix/)).toBeTruthy())
  expect(screen.getByRole('button', { name: 'End ✕' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Back to session/ }).getAttribute('title')).toBe('fold back')
  expect(document.title).toBe('AgentDeck')
})

test('a link that names no terminal explains itself instead of attaching', () => {
  const attach = vi.fn()
  render(createElement(TerminalPopout, { target: { provider: 'claude', root: 'acc' }, attach, onBack() {} }))
  expect(screen.getByText(/does not name a terminal/)).toBeTruthy()
  expect(attach).not.toHaveBeenCalled()
})
