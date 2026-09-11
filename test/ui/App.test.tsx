import { required } from '../helpers/assert.ts'
import { renderWithQuery as render } from '../helpers/query.ts'
// @vitest-environment jsdom
import { test, vi, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { screen, within, cleanup, waitFor, act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HOME_VIEWS, normalizeView } from '../../src/lib/tabs.ts'
import App from '../../src/App.tsx'
import { shellActions, shell } from '../../src/store/index.ts'

vi.mock('../../src/SessionApp.tsx', () => ({
  default: function FixtureSessionApp({ pendingOpen }: React.ComponentProps<typeof import('../../src/SessionApp.tsx').default>) {
    return <output aria-label="Provider navigation">{JSON.stringify(pendingOpen)}</output>
  },
}))

vi.mock('../../src/providers/index.ts', () => ({
  PROVIDER_LIST: [
    {
      id: 'codex',
      label: 'Codex',
      color: 'blue',
      sessionTabs: [],
    },
  ],
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

test('the new-tab picker creates a Home tab without replacing the current session', async () => {
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const pathname = new URL(url, 'http://fixture.invalid').pathname
      const data = pathname.endsWith('/active-sessions')
        ? { tmux: [] }
        : pathname.endsWith('/roots')
          ? { roots: [] }
          : pathname.endsWith('/projects')
            ? { projects: [] }
            : { folders: [], errors: [], notices: [] }
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    })
  )
  shellActions.openTarget({ provider: 'codex', root: 'fixture', slug: 'project', id: 'home-picker-session', title: 'Keep this conversation' }, { newTab: true })
  const previous = shell.store.getState().state
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByTitle(/New tab/))
  const dialog = screen.getByRole('dialog', { name: 'Quick switcher' })
  await user.click(within(dialog).getByText('Home', { exact: true }))
  await waitFor(() => assert.equal(shell.store.getState().state.tabs.length, previous.tabs.length + 1))
  const next = shell.store.getState().state
  assert.notEqual(next.activeKey, previous.activeKey)
  assert.equal(next.tabs.find((tab) => tab.key === next.activeKey)?.target?.view, 'activity')
  assert.equal(next.tabs.find((tab) => tab.key === previous.activeKey)?.target?.id, 'home-picker-session')
  assert.equal(shell.store.getState().searchOpen, false)
  assert.equal(shell.store.getState().searchNewTab, false)
})

test('Live is global even with zero terminals, while Home no longer lists dashboards', async () => {
  const live = {
    provider: 'codex',
    root: 'fixture',
    key: 'codex|fixture|launch|live',
    launchId: 'live',
    cwd: '/fixture/repo',
    title: 'Live fixture',
    tmuxName: 'fixture-live',
    attached: false,
  }
  let tmux: { provider: string; root: string; key: string; launchId: string; cwd: string; title: string; tmuxName: string; attached: boolean }[] = []
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const pathname = new URL(url, 'http://fixture.invalid').pathname
      let data: unknown
      if (pathname === '/api/codex/active-sessions') data = { tmux }
      else if (pathname === '/api/codex/roots') data = { roots: [] }
      else if (pathname === '/api/codex/projects') data = { projects: [] }
      else throw Error(`Unexpected fixture request: ${url}`)
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    })
  )
  const user = userEvent.setup()
  render(<App />)
  const liveButton = screen.getByTitle('Live sessions & dashboards · all providers')
  await user.click(liveButton)
  let dialog = screen.getByRole('dialog', { name: 'Live sessions & dashboards' })
  assert.ok(within(dialog).getByText('No running terminals right now.'))
  assert.equal(
    HOME_VIEWS.some((view) => view.k === 'dashboards'),
    false
  )
  assert.equal(normalizeView('dashboards'), 'activity')
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  tmux = [
    live,
    ...['second', 'third'].map((launchId) => ({
      ...live,
      launchId,
      key: `codex|fixture|launch|${launchId}`,
      tmuxName: `fixture-${launchId}`,
      title: launchId,
    })),
  ]
  await act(async () => {
    for (const terminal of tmux) shellActions.terminalReady(terminal)
  })
  await waitFor(() => assert.match(liveButton.textContent, /3/))
  await user.click(liveButton)
  dialog = screen.getByRole('dialog', { name: 'Live sessions & dashboards' })
  const tabsBefore = screen.getAllByRole('tab').filter((tab) => !dialog.contains(tab)).length
  await user.click(within(dialog).getAllByRole('button', { name: 'Enter' })[0])
  assert.equal(screen.queryByRole('dialog', { name: 'Live sessions & dashboards' }), null)
  await waitFor(() => assert.equal(screen.getAllByRole('tab').length, tabsBefore + 1))
  const pending = JSON.parse(screen.getByLabelText('Provider navigation').textContent)
  assert.equal(pending.root, 'fixture')
  assert.equal(pending.launchId, 'live')
  assert.equal(pending.terminalKey, live.key)
  assert.ok(
    screen.getAllByRole('tab').some((tab) => tab.textContent.includes('Activity')),
    'entering Live preserves the previous Home tab'
  )
})

test('ending a dashboard preserves its tab on failure and removes its tab and Live row only after success', async () => {
  const dashboard = { id: 'fixture-dashboard', title: 'Fixture dashboard', running: true, sources: [] }
  let ended = false,
    allowEnd = false,
    endRequests = 0
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  )
  const browserConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw Error('Use the centered in-app confirmation')
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const pathname = new URL(url, 'http://fixture.invalid').pathname
      let data: unknown
      if (pathname === '/api/codex/active-sessions') data = { tmux: [] }
      else if (pathname === '/api/codex/roots') data = { roots: [] }
      else if (pathname === '/api/deck/dashboard/attach') data = { dashboard, url: 'about:blank' }
      else if (pathname === '/api/deck/dashboards') data = { dashboards: ended ? [] : [dashboard] }
      else if (pathname === '/api/deck/dashboard/end') {
        assert.equal(options.method, 'POST')
        assert.deepEqual(JSON.parse(options.body), { id: dashboard.id })
        endRequests++
        if (!allowEnd) return new Response(JSON.stringify({ error: 'Cannot verify tmux' }), { status: 503 })
        ended = true
        data = { id: dashboard.id, endedAt: 1 }
      } else throw Error(`Unexpected fixture request: ${url}`)
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    })
  )
  const user = userEvent.setup()
  render(<App />)
  await act(async () => shellActions.openDeckView({ kind: 'dashboard', dashboardId: dashboard.id, title: dashboard.title }))
  await screen.findByRole('button', { name: 'End dashboard only' })
  const dashboardTab = () => screen.queryByRole('tab', { name: /Fixture dashboard/ })
  assert.ok(dashboardTab())
  await user.click(screen.getByRole('button', { name: 'End dashboard only' }))
  assert.equal(endRequests, 0, 'no request before the centered confirmation')
  await user.click(screen.getByRole('button', { name: /^End dashboard$/ }))
  await screen.findByText('Cannot verify tmux')
  assert.ok(dashboardTab(), 'failure cannot remove the still-running dashboard')
  await user.click(screen.getByTitle('Live sessions & dashboards · all providers'))
  const liveDialog = screen.getByRole('dialog', { name: 'Live sessions & dashboards' })
  await user.click(within(liveDialog).getByRole('tab', { name: 'Dashboards' }))
  await within(liveDialog).findByText('Fixture dashboard')
  await user.click(within(liveDialog).getByRole('button', { name: 'End dashboard' }))
  assert.equal(endRequests, 1)
  allowEnd = true
  const confirm = required(screen.getByText('End this dashboard?').closest<HTMLElement>('[role="dialog"]'))
  await user.click(within(confirm).getByRole('button', { name: 'End dashboard' }))
  await waitFor(() => assert.equal(dashboardTab(), null))
  await within(liveDialog).findByText(/No dashboards yet/)
  assert.equal(endRequests, 2)
  assert.equal(browserConfirm.mock.calls.length, 0)
})
