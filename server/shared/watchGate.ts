import { AsyncLocalStorage } from 'node:async_hooks'

// Concurrent deletes share a pause window. A request's host supplies its own
// gate, so creating a second host cannot replace the first host's controls.
type Control = (() => unknown) | null | undefined
interface WatchGate {
  restart(): Promise<void>
  pause<T>(fn: () => T | Promise<T>): Promise<T>
}
export function createWatchGate(stop: Control, start: Control, notify?: (() => void) | null, log: Pick<Console, 'warn'> = console): WatchGate {
  let depth = 0
  let stopping: Promise<unknown> | null = null
  return {
    async restart() {
      if (depth === 0) await start?.()
    },
    async pause<T>(fn: () => T | Promise<T>): Promise<T> {
      if (!stop) log.warn('[watchGate] no watcher control registered — running without pausing watchers')
      depth++
      try {
        if (depth === 1 && stop) stopping = Promise.resolve().then(stop)
        // A failed pause must abort the mutation: watched handles may still
        // exist. The finally path restores monitoring without authorizing it.
        if (stopping) await stopping
        return await fn()
      } finally {
        if (--depth === 0) {
          stopping = null
          try {
            await start?.()
          } catch (error) {
            log.warn(`[watchGate] restart after pause failed: ${error instanceof Error ? error.message : error}`)
          }
          try {
            notify?.()
          } catch (error) {
            log.warn(`[watchGate] refresh after pause failed: ${error instanceof Error ? error.message : error}`)
          }
        }
      }
    },
  }
}

const context = new AsyncLocalStorage<WatchGate>()
function currentGate() {
  const gate = context.getStore()
  if (!gate) throw new Error('A host watch gate is required for this operation')
  return gate
}
export const runWithWatchGate = <T>(gate: WatchGate, fn: () => T): T => context.run(gate, fn)
export const withWatchersPaused = <T>(fn: () => T | Promise<T>): Promise<T> => currentGate().pause(fn)
