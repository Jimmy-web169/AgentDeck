// The Sub-agents tab unlocks from the LIVE sessions list, not the click-time
// `active` snapshot — a session's first subagent can appear mid-view.
export const hasSubagentsNow = (active: { id: string; hasSubagents?: boolean } | null, sessions: { id: string; hasSubagents?: boolean }[] | null | undefined) =>
  !!active && (!!active.hasSubagents || (sessions || []).some((s) => s.id === active.id && s.hasSubagents))

// Trailing debounce with a hard max wait. Continuous file events therefore
// coalesce, but can never postpone a refresh forever.
export function createDebounceWithMaxWait(
  fn: () => void,
  {
    waitMs,
    maxWaitMs,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }: {
    waitMs?: number
    maxWaitMs?: number
    setTimer?: (fn: () => void, delay?: number) => number | ReturnType<typeof setTimeout>
    clearTimer?: (timer: number | ReturnType<typeof setTimeout>) => void
  } = {}
) {
  let waitTimer: number | ReturnType<typeof setTimeout> | null = null
  let maxTimer: number | ReturnType<typeof setTimeout> | null = null
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
