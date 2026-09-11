import type { ChangeEvent } from '../../shared/types.js'
import { useSyncExternalStore } from 'react'
type Timer = ReturnType<typeof setTimeout>
type Group = 'ids' | 'slugs'
type ConnectionState = 'connecting' | 'live' | 'reconnecting'
interface Snapshot {
  ids: Set<string>
  slugs: Set<string>
  connection: ConnectionState
  lastEvents: Record<string, number>
}
interface TimerOptions {
  setTimer?: (callback: () => void, ms: number) => Timer
  clearTimer?: (timer: Timer) => void
}
import { liveSessionKey, liveProjectKey } from '../../shared/identity.ts'
import { LIVE_MS } from '../../shared/constants.ts'

export function createLiveKeysStore({ setTimer = setTimeout, clearTimer = clearTimeout }: TimerOptions = {}) {
  let snapshot: Snapshot = { ids: new Set(), slugs: new Set(), connection: 'connecting', lastEvents: {} }
  const listeners = new Set<() => void>()
  const timers = { ids: new Map<string, Timer>(), slugs: new Map<string, Timer>() }
  const emit = () => {
    for (const listener of listeners) listener()
  }
  const arm = (kind: Group, key: string) => {
    const previous = timers[kind].get(key)
    if (previous !== undefined) clearTimer(previous)
    timers[kind].set(
      key,
      setTimer(() => {
        timers[kind].delete(key)
        const next = new Set(snapshot[kind])
        next.delete(key)
        snapshot = { ...snapshot, [kind]: next }
        emit()
      }, LIVE_MS)
    )
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    setConnection(connection: ConnectionState) {
      if (connection === snapshot.connection) return
      snapshot = { ...snapshot, connection }
      emit()
    },
    note(changes: ChangeEvent[]) {
      const ids = new Set(snapshot.ids),
        slugs = new Set(snapshot.slugs)
      const lastEvents = { ...snapshot.lastEvents }
      for (const change of changes) {
        if (!change.provider || !change.root) continue
        lastEvents[change.provider] = Date.now()
        if (change.id) {
          const key = liveSessionKey(change.provider, change.root, change.id)
          ids.add(key)
          arm('ids', key)
        }
        if (change.slug) {
          const key = liveProjectKey(change.provider, change.root, change.slug)
          slugs.add(key)
          arm('slugs', key)
        }
      }
      snapshot = { ...snapshot, ids, slugs, lastEvents }
      emit()
    },
    clear() {
      for (const group of Object.values(timers)) {
        for (const timer of group.values()) clearTimer(timer)
        group.clear()
      }
      snapshot = { ids: new Set(), slugs: new Set(), connection: 'connecting', lastEvents: {} }
      emit()
    },
  }
}

export const liveKeysStore = createLiveKeysStore()
export const useLiveKeys = () => useSyncExternalStore(liveKeysStore.subscribe, liveKeysStore.getSnapshot, liveKeysStore.getSnapshot)
export function useConnectionStatus(provider: string) {
  const snapshot = useLiveKeys()
  return { connection: snapshot.connection, lastEvent: snapshot.lastEvents[provider] || 0 }
}
