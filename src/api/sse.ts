import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ChangeEvent } from '../../shared/types.js'
import { createDebounceWithMaxWait } from '../lib/liveSync.ts'
import { matchesChange, coalesceChanges } from './queryPolicy.ts'
import { liveKeysStore } from '../store/liveKeys.ts'

interface Connection {
  users: number
  close: () => void
}
interface Options {
  EventSource?: typeof EventSource
  live?: Pick<typeof liveKeysStore, 'note' | 'clear' | 'setConnection'>
  log?: Pick<Console, 'warn'>
}
const connections = new WeakMap<Pick<QueryClient, 'invalidateQueries'>, Connection>()
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function changeEvent(value: unknown): value is ChangeEvent {
  return (
    record(value) &&
    typeof value.provider === 'string' &&
    !!value.provider &&
    typeof value.root === 'string' &&
    !!value.root &&
    ['id', 'slug', 'parentId'].every((key) => value[key] == null || typeof value[key] === 'string')
  )
}

export function connectEvents(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  { EventSource: Source = globalThis.EventSource, live = liveKeysStore, log = console }: Options = {}
) {
  let entry = connections.get(queryClient)
  if (!entry) {
    const source = new Source('/events')
    let changes: ChangeEvent[] = [],
      all = false
    const timing = { waitMs: 300, maxWaitMs: 2000, setTimer: setTimeout, clearTimer: clearTimeout }
    const refresh = createDebounceWithMaxWait(() => {
      const batch = coalesceChanges(changes),
        invalidateAll = all
      changes = []
      all = false
      void queryClient.invalidateQueries({
        predicate: (query) => !query.meta?.manualOnly && (invalidateAll || batch.some((change) => matchesChange(query.queryKey, change))),
      })
    }, timing)
    source.onopen = () => {
      live.setConnection('live')
      all = true
      refresh()
    }
    source.onerror = () => live.setConnection('reconnecting')
    source.onmessage = (event) => {
      let message: unknown
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        log.warn('Ignoring malformed SSE message', error)
        return
      }
      if (!record(message)) return
      if (message.type === 'hello') {
        live.setConnection('live')
        all = true
        refresh()
        return
      }
      if (message.type !== 'change' || !Array.isArray(message.changes)) return
      const batch = message.changes.filter(changeEvent)
      if (!batch.length) return
      live.note(batch)
      changes.push(...batch)
      refresh()
    }
    entry = {
      users: 0,
      close() {
        refresh.cancel()
        source.onopen = source.onerror = source.onmessage = null
        source.close()
        live.clear()
      },
    }
    connections.set(queryClient, entry)
  }
  const owned = entry
  owned.users++
  let closed = false
  return () => {
    if (closed) return
    closed = true
    if (--owned.users === 0) {
      owned.close()
      connections.delete(queryClient)
    }
  }
}

export function useEventStream() {
  const queryClient = useQueryClient()
  useEffect(() => connectEvents(queryClient), [queryClient])
}
