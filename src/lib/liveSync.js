export const sessionVersionKey = (provider, root, id) => `${provider}|${root}|${id}`

export const getSessionVersion = (versions, provider, root, id) => {
  if (!id) return 0
  return versions?.[sessionVersionKey(provider, root, id)] || 0
}

// The Sub-agents tab unlocks from the LIVE sessions list, not the click-time
// `active` snapshot — a session's first subagent can appear mid-view.
export const hasSubagentsNow = (active, sessions) =>
  !!active && (!!active.hasSubagents || (sessions || []).some((s) => s.id === active.id && s.hasSubagents))

// A Codex child rollout change carries parentId, so both the child transcript
// and its parent's subagent list become invalid in one immutable update.
export function bumpSessionVersions(previous, changes) {
  let changed = false
  const next = { ...previous }
  const bump = (provider, root, id) => {
    if (!provider || !root || !id) return
    const key = sessionVersionKey(provider, root, id)
    next[key] = (next[key] || 0) + 1
    changed = true
  }
  for (const change of changes || []) {
    bump(change.provider, change.root, change.id)
    bump(change.provider, change.root, change.parentId)
  }
  return changed ? next : previous
}

// Trailing debounce with a hard max wait. Continuous file events therefore
// coalesce, but can never postpone a refresh forever.
export function createDebounceWithMaxWait(
  fn,
  { waitMs, maxWaitMs, setTimer = setTimeout, clearTimer = clearTimeout } = {}
) {
  let waitTimer = null
  let maxTimer = null
  const invoke = () => {
    if (waitTimer) clearTimer(waitTimer)
    if (maxTimer) clearTimer(maxTimer)
    waitTimer = maxTimer = null
    fn()
  }
  const schedule = () => {
    if (waitTimer) clearTimer(waitTimer)
    waitTimer = setTimer(invoke, waitMs)
    if (!maxTimer) maxTimer = setTimer(invoke, maxWaitMs)
  }
  schedule.cancel = () => {
    if (waitTimer) clearTimer(waitTimer)
    if (maxTimer) clearTimer(maxTimer)
    waitTimer = maxTimer = null
  }
  schedule.flush = () => {
    if (waitTimer || maxTimer) invoke()
  }
  return schedule
}

export function startFallbackPoll(fn, intervalMs, { setEvery = setInterval, clearEvery = clearInterval } = {}) {
  const timer = setEvery(fn, intervalMs)
  return () => clearEvery(timer)
}

export function subscribeToPageResume(fn, { doc = document, win = window } = {}) {
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') fn('visibility')
  }
  const onFocus = () => fn('focus')
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('focus', onFocus)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('focus', onFocus)
  }
}

export const isLiveAuthoritative = (slice) => !!slice?.ready

export const reconnectDelayMs = (attempt) => Math.min(1000 * 2 ** Math.max(0, attempt), 10000)

export function scheduleReconnect(meta, reconnect, { setTimer = setTimeout } = {}) {
  if (!meta || meta.closed || meta.timer) return false
  const delay = reconnectDelayMs(meta.attempt++)
  meta.timer = setTimer(() => {
    meta.timer = null
    if (!meta.closed) reconnect()
  }, delay)
  return true
}

export function cancelReconnect(meta, { clearTimer = clearTimeout } = {}) {
  if (!meta) return
  meta.closed = true
  if (meta.timer) clearTimer(meta.timer)
  meta.timer = null
}
