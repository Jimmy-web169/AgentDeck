// The directory watchers keep open handles on every watched folder. On
// Windows that blocks moving a watched folder to the recycle bin — the OS
// denies the delete while a handle exists — so deleting a session (whose
// subagents sidecar is a watched directory) 500s against our own watcher.
// index.js registers its stop/start pair here; deletion handlers wrap their
// trash calls in withWatchersPaused() to stand the watchers down for the
// few milliseconds the recycle-bin move needs. Pausing is refcounted so
// concurrent deletes share one pause window: watchers stop once when the
// first caller enters and restart only after the last caller leaves.
let stopFn = null
let startFn = null
let notifyFn = null

let depth = 0 // active withWatchersPaused callers
let stopping = null // shared in-flight stop promise — late joiners await the same stop

export function registerWatchControl(stop, start, notify) {
  stopFn = stop
  startFn = start
  notifyFn = notify
}

// Restart the watchers (e.g. after the tracked roots change). Mid-pause this
// defers instead of re-arming under a live delete: the resume path always
// starts a fresh watcher generation (with the new roots) when the last pauser
// leaves, which covers the request.
export async function restartWatchers() {
  if (depth > 0) return
  await startFn?.()
}

export async function withWatchersPaused(fn) {
  if (!stopFn) console.warn('[watchGate] no watcher control registered — running without pausing watchers')
  depth++
  try {
    if (depth === 1 && stopFn) stopping = Promise.resolve(stopFn())
    if (stopping) await stopping
    return await fn()
  } finally {
    if (--depth === 0) {
      stopping = null
      try {
        await startFn?.()
      } catch (e) {
        console.warn(`[watchGate] restart after pause failed: ${e?.message || e}`)
      }
      try {
        notifyFn?.()
      } catch {}
    }
  }
}

// test hook: reset module state between unit tests
export function _resetWatchGateForTests() {
  stopFn = startFn = notifyFn = null
  depth = 0
  stopping = null
}
