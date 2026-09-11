import { useCallback, useContext } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Dashboard, Target, Handoff } from '../../shared/types.js'
import { queryKeys } from './queryPolicy.ts'
import { QueryActivityContext } from './queries.ts'
import { request } from './fetcher.ts'
import { deckApi } from './endpoints.ts'
import { queryIdentity } from '../../shared/identity.ts'

interface Destination {
  provider: string
  root: string
  rootLabel: string
}
interface Attachment {
  dashboard: Dashboard
  url: string | null
}
export function useHandoffDestinations(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.handoffDestinations(),
    enabled,
    queryFn: ({ signal }) => request<{ destinations: Destination[] }>('/api/deck/handoff/destinations', { signal }),
  })
}

// Attaching owns a viewer. It only runs on opening the tab or an explicit
// reconnect, never on a focus event, retry, or unrelated transcript change.
export function useDashboardAttachment(id: string) {
  const visible = useContext(QueryActivityContext)
  const client = useQueryClient()
  const queryKey = queryKeys.dashboardAttachment(id)
  const query = useQuery({
    queryKey,
    enabled: !!id && visible,
    staleTime: Infinity,
    gcTime: 0,
    meta: { manualOnly: true },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => deckApi<Attachment>('dashboard/attach', { id }),
  })
  const update = async (command: 'control' | 'remove', key: string | null) => {
    await client.cancelQueries({ queryKey, exact: true })
    const next = await deckApi<Dashboard>(`dashboard/${command}`, { id, key })
    client.setQueryData<Attachment>(queryKey, (old) => (old ? { ...old, dashboard: next } : undefined))
    await client.invalidateQueries({ queryKey: queryKeys.dashboards() })
    return next
  }
  return { ...query, update }
}

interface Commands {
  createDashboard: { input: { keys: string[]; title?: string }; output: Dashboard }
  endDashboard: { input: { id: string }; output: { id: string; endedAt: number } }
  exportHandoff: { input: { source: Target; task?: string | null }; output: Handoff }
  sendHandoff: { input: { id: string; target: { provider: string; root: string } }; output: Handoff }
}
const routes = { createDashboard: 'dashboard/create', endDashboard: 'dashboard/end', exportHandoff: 'handoff/export', sendHandoff: 'handoff/send' }
export function deckMutationOptions<K extends keyof Commands>(client: QueryClient, command: K) {
  return {
    retry: false as const,
    mutationFn: (input: Commands[K]['input']) => deckApi<Commands[K]['output']>(routes[command], input),
    onSuccess: async (result: Commands[K]['output']) => {
      if (command === 'createDashboard' || command === 'endDashboard') {
        const queryKey = queryKeys.dashboards()
        if (command === 'endDashboard') {
          await client.cancelQueries({ queryKey, exact: true })
          client.setQueryData<{ dashboards: Dashboard[] }>(queryKey, (previous) =>
            previous ? { ...previous, dashboards: previous.dashboards.filter((item) => item.id !== result.id) } : previous
          )
        }
        await client.invalidateQueries({ queryKey, exact: true })
      } else {
        const key = queryKeys.handoffStatus(result.id)
        client.setQueryData(key, result)
        await client.invalidateQueries({ queryKey: key, exact: true })
        if (command === 'sendHandoff') {
          await client.invalidateQueries({
            predicate: (query) => {
              const identity = queryIdentity(query.queryKey)
              return identity?.owner === 'provider' && identity.inventory === true && ['active-sessions', 'terminals'].includes(identity.kind)
            },
          })
        }
      }
    },
  }
}
export function useDeckMutation<K extends keyof Commands>(command: K) {
  return useMutation(deckMutationOptions(useQueryClient(), command))
}
export function useHandoffStatusCommand() {
  const client = useQueryClient()
  return useCallback(
    (id: string) =>
      client.fetchQuery({
        queryKey: queryKeys.handoffStatus(id),
        staleTime: 0,
        queryFn: ({ signal }) => request<Handoff>(`/api/deck/handoff/status?id=${encodeURIComponent(id)}`, { signal }),
      }),
    [client]
  )
}
