import { required } from '../../helpers/assert.ts'
import { test, expect, vi, afterEach } from 'vitest'
import { MutationObserver } from '@tanstack/react-query'
import { createQueryClient, deckMutationOptions } from '../../../src/api/index.ts'
import { queryKeys } from '../../../shared/identity.ts'
afterEach(() => vi.unstubAllGlobals())

test('Deck create/export/send mutations update owners immediately and never retry launches', async () => {
  const client = createQueryClient()
  const dashboards = queryKeys.dashboards(),
    active = queryKeys.activeSessions('claude'),
    terminals = queryKeys.terminals('codex')
  client.setQueryData(dashboards, { dashboards: [] })
  client.setQueryData(active, { tmux: [] })
  client.setQueryData(terminals, { terminals: [] })
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return new Response(JSON.stringify({ id: 'receipt', state: url.endsWith('/send') ? 'launched' : 'exported' }))
    })
  )
  const mutate = <K extends Parameters<typeof deckMutationOptions>[1]>(
    kind: K,
    value: Parameters<ReturnType<typeof deckMutationOptions<K>>['mutationFn']>[0]
  ) => new MutationObserver(client, deckMutationOptions(client, kind)).mutate(value)
  try {
    await mutate('createDashboard', { keys: ['terminal'], title: 'Live dashboard' })
    expect(required(client.getQueryState(dashboards)).isInvalidated).toBe(true)
    const source = { provider: 'claude', root: 'a', id: 'session' }
    await mutate('exportHandoff', { source, task: 'Continue' })
    expect(required(client.getQueryData<{ state: string }>(queryKeys.handoffStatus('receipt'))).state).toBe('exported')
    expect(required(client.getQueryState(queryKeys.handoffStatus('receipt'))).isInvalidated).toBe(true)
    expect(required(client.getQueryState(active)).isInvalidated).toBe(false)
    await mutate('sendHandoff', { id: 'receipt', target: { provider: 'codex', root: 'b' } })
    expect(required(client.getQueryData<{ state: string }>(queryKeys.handoffStatus('receipt'))).state).toBe('launched')
    expect(required(client.getQueryState(active)).isInvalidated).toBe(true)
    expect(required(client.getQueryState(terminals)).isInvalidated).toBe(true)
    expect(calls.map((call) => call.url)).toEqual(['/api/deck/dashboard/create', '/api/deck/handoff/export', '/api/deck/handoff/send'])
    client.setQueryData(dashboards, { dashboards: [] })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Refused' }), { status: 409 }))
    )
    await expect(mutate('createDashboard', { keys: ['terminal'] })).rejects.toMatchObject({ status: 409 })
    expect(required(client.getQueryState(dashboards)).isInvalidated).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {
    client.clear()
  }
})
