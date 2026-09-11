import type { SessionSummary } from '../../shared/types.js'
import type { QueryRef } from './queryPolicy.ts'
import { providerMetadata } from '../providers/metadata.ts'
import { useProjects, useSessions, useSession, useRaw, useSubagents, useStats, useUsage, useTerminals, useActiveSessions } from './queries.ts'

interface Options extends QueryRef {
  active?: boolean
  view?: string
  oversized?: boolean
  liveProvider?: string
  nestedSubagents?: boolean
}

// Server state stays in Query. Navigation and scroll state are separate owners.
// ID-addressed providers discover their project from the transcript response;
// that enrichment must not produce a second cache key for the same transcript.
export function useSessionData({ active = true, view = 'conversation', oversized = false, liveProvider, nestedSubagents = false, ...target }: Options) {
  const native = providerMetadata(target.provider).apiAddr === 'slug+id' ? target : { ...target, slug: null }
  const session = useSession(native, { enabled: active && !oversized })
  const discoveredSlug = typeof session.data?.slug === 'string' ? session.data.slug : null
  const slug = target.slug || discoveredSlug
  const ref = { ...target, slug }
  const projects = useProjects(target.provider, target.root, { enabled: active })
  const sessions = useSessions(ref, { enabled: active })
  const raw = useRaw(native, { enabled: active && view === 'raw' && !oversized })
  const subagents = useSubagents(native, { enabled: active && nestedSubagents && view === 'subagents' && !oversized })
  const stats = useStats(target.provider, target.root, { enabled: active && view === 'stats' })
  const usage = useUsage(target.provider, target.root, { enabled: active })
  const terminals = useTerminals(target.provider, { enabled: active })
  // All mounted consumers choose the same first registered provider for this
  // global endpoint. Their observers therefore share one request and timer.
  const activeSessions = useActiveSessions(liveProvider || target.provider, { enabled: active })
  const listed = sessions.data?.sessions.find((item) => item.id === target.id)
  const summary = session.data?.summary as SessionSummary | undefined
  const selected: (Partial<SessionSummary> & { id: string }) | null = target.id ? { ...listed, ...summary, id: target.id } : null
  return { ref, selected, projects, sessions, session, raw, subagents, stats, usage, terminals, activeSessions }
}
