// The directory watchers keep open handles on every watched folder. On
// Windows that blocks moving a watched folder to the recycle bin — the OS
// denies the delete while a handle exists — so deleting a session (whose
// subagents sidecar is a watched directory) 500s against our own watcher.
// index.js registers its stop/start pair here; deletion handlers wrap their
// trash calls in withWatchersPaused() to stand the watchers down for the
// few milliseconds the recycle-bin move needs.
let stopFn = null
let startFn = null

export function registerWatchControl(stop, start) {
  stopFn = stop
  startFn = start
}

export async function withWatchersPaused(fn) {
  if (stopFn) await stopFn()
  try {
    return await fn()
  } finally {
    startFn?.()
  }
}
