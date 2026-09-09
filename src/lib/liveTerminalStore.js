// Shared, race-safe snapshot. File bursts coalesce and only one request can run.
export function createLiveTerminalStore(fetchList, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let snapshot = []
  const listeners = new Set()
  let inFlight = null, queued = false, timer = null, revision = 0
  const publish = (next) => {
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const refresh = () => {
    if (inFlight) { queued = true; return inFlight }
    const started = revision
    inFlight = Promise.resolve().then(fetchList).then((next) => {
      if (started === revision) publish(next)
    }).catch(() => {}).finally(() => {
      inFlight = null
      if (queued) { queued = false; refresh() }
    })
    return inFlight
  }
  const schedule = () => {
    // Fixed trailing window: a continuous stream cannot defer this forever.
    if (timer !== null) return
    timer = setTimer(() => { timer = null; refresh() }, 600)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    refresh, schedule,
    upsert: (entry) => {
      if (!entry?.key || !entry.provider || !entry.root) return
      revision++
      const { requestedTarget, ...persistent } = entry
      const old = snapshot.find((t) => t.key === entry.key)
      publish([...snapshot.filter((t) => t.key !== entry.key), { ...old, ...persistent }])
      schedule()
    },
    remove: (key) => { revision++; publish(snapshot.filter((t) => t.key !== key)); schedule() },
    cancel: () => { revision++; queued = false; if (timer !== null) clearTimer(timer); timer = null },
  }
}
