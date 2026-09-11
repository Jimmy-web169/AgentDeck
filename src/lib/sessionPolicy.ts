import type { TimelineEvent } from '../../shared/types.js'
export function forkCutByUuid(timeline: TimelineEvent[], event: TimelineEvent) {
  const index = timeline.indexOf(event)
  if (index < 0) return null
  return timeline.slice(index + 1).find((item) => item.kind === 'user' && item.uuid)?.uuid || null
}
export function forkCutByOrdinal(timeline: TimelineEvent[], event: TimelineEvent) {
  const index = timeline.indexOf(event)
  if (index < 0) return null
  const next = timeline.slice(index + 1).find((item) => item.kind === 'user')
  return next ? timeline.filter((item) => item.kind === 'user').indexOf(next) + 1 : null
}
