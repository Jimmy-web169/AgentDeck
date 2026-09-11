import { required } from '../helpers/assert.ts'
// @vitest-environment jsdom
import { test, expect, vi } from 'vitest'
import { createElement } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../src/api/index.ts'
import { queryKeys } from '../../shared/identity.ts'
import { shell, shellActions } from '../../src/store/index.ts'
import { useDashboardActions } from '../../src/lib/useDashboardActions.ts'

// Retains the old deckApi.test.js success/failure contract in its UI owner.
test('successful End removes the tab and Live row; failures preserve both', async () => {
  const client = createQueryClient(),
    state = shell.store.getState()
  const wrapper = ({ children }: { children: import('react').ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(useDashboardActions, { wrapper })
  const open = () => {
    shellActions.openDeckView({ kind: 'dashboard', dashboardId: 'test' })
    client.setQueryData(queryKeys.dashboards(), { dashboards: [{ id: 'test' }, { id: 'other' }] })
  }
  try {
    open()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        expect(url).toBe('/api/deck/dashboard/end')
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body)).toEqual({ id: 'test' })
        return new Response(JSON.stringify({ id: 'test', endedAt: 1 }))
      })
    )
    await act(async () => hook.result.current.endDashboard('test'))
    expect(shell.store.getState().state.tabs.some((tab) => tab.target?.dashboardId === 'test')).toBe(false)
    expect(required(client.getQueryData<{ dashboards: { id: string }[] }>(queryKeys.dashboards())).dashboards.map((item) => item.id)).toEqual(['other'])
    open()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Cannot verify tmux' }), { status: 503 }))
    )
    await act(async () => {
      await expect(hook.result.current.endDashboard('test')).rejects.toMatchObject({ status: 503 })
    })
    expect(shell.store.getState().state.tabs.some((tab) => tab.target?.dashboardId === 'test')).toBe(true)
    expect(required(client.getQueryData<{ dashboards: { id: string }[] }>(queryKeys.dashboards())).dashboards.map((item) => item.id)).toEqual(['test', 'other'])
  } finally {
    hook.unmount()
    client.clear()
    shell.store.setState(state, true)
    vi.unstubAllGlobals()
  }
})
