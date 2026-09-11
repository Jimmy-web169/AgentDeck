import type { ThreadAdapter } from './components/shared/SubagentThread.tsx'
import { useEffect, useMemo, useState } from 'react'
import type { Target, TimelineEvent } from '../shared/types.js'
import { legacySessionKey, legacyProjectSessionKey } from '../shared/identity.ts'
import SessionView, { type SessionViewContext } from './components/shared/SessionView.tsx'
import { useSessionFlow } from './lib/useSessionFlow.ts'
import type { SessionNavOptions } from './lib/useSessionNav.ts'
import { useFork, createApi } from './api/index.ts'
import useTerminalPanes from './lib/useTerminalPanes.ts'
import { mergeTerminalEntries, terminalFor } from './lib/terminalTarget.ts'
import { hasSubagentsNow } from './lib/liveSync.ts'

type Slots = Pick<SessionViewContext, 'Conversation' | 'ResourcesView' | 'SubagentsView' | 'MemoryView' | 'TerminalPanel' | 'RateLimitsBar' | 'Stats'>
export interface SessionProvider {
  id: string
  apiAddr: 'id' | 'slug+id'
  sessionTabs: SessionViewContext['SESSION_TABS']
  components: Slots
  docsBase: string
  docsTitle: string
  usageInfo: string
  capabilities: { subagentModel: 'nested' | 'independent-sessions' }
  fillConfig: boolean
  emptyStreamLabel?: string
  rawTypeOf?: SessionViewContext['rawTypeOf']
  subagentAdapter?: ThreadAdapter
  forkCut?: (timeline: TimelineEvent[], event: TimelineEvent) => string | number | null
}
interface Props {
  provider: SessionProvider
  active?: boolean
  providers: readonly { id: string }[]
  pendingOpen?: SessionNavOptions['pending']
  navigationTarget?: Target | null
  openTargets?: Target[]
  onConsumedPending?: () => void
  onNavigate?: SessionNavOptions['onNavigate']
  onOpenSession?: (provider: string, target: Target, options?: { newTab?: boolean }) => void
}

// Provider configuration supplies presentation; navigation and Query own state.
export default function SessionApp({
  provider: cfg,
  active: appActive = true,
  providers,
  pendingOpen,
  navigationTarget = null,
  openTargets = [],
  onConsumedPending,
  onNavigate,
  onOpenSession,
}: Props) {
  const views = useMemo(() => cfg.sessionTabs.map((tab) => tab.k), [cfg.sessionTabs])
  const api = useMemo(() => createApi(cfg.id), [cfg.id])
  const nestedSubagents = cfg.capabilities.subagentModel === 'nested'
  const flow = useSessionFlow({
    provider: cfg.id,
    addressing: cfg.apiAddr,
    active: appActive,
    views,
    pending: pendingOpen,
    onConsumed: onConsumedPending,
    onNavigate,
    nestedSubagents,
    liveProvider: providers[0]?.id || cfg.id,
  })
  const { nav, data, pane, connection } = flow
  const { root, id, view: tab } = nav.selection,
    openSlug = data.ref.slug || null
  const active = data.selected,
    sessionData = data.session.data
  const termDraft = nav.selection.draft ? nav.selection : null
  const pool = data.terminals.data?.terminals || [],
    live = data.activeSessions.data?.tmux || []
  const terminalEntries = mergeTerminalEntries(pool, live)
  const terminalTarget = navigationTarget || (termDraft ? termDraft : active ? { ...active, root, slug: openSlug } : null)
  const { panes: shownPanes, currentKey: curTermKey } = useTerminalPanes(cfg.id, terminalTarget, terminalEntries, openTargets)
  const runningTermKeys = new Set<string>(terminalEntries.map((entry) => entry.key).filter(Boolean))
  for (const entry of terminalEntries)
    if (entry.provider === cfg.id && entry.id)
      runningTermKeys.add(
        cfg.apiAddr === 'slug+id' ? legacyProjectSessionKey(entry.root || '', entry.slug || '', entry.id) : legacySessionKey(entry.root || '', entry.id)
      )
  const [actionError, setActionError] = useState<string | null>(null)
  const [dismissedIssue, setDismissedIssue] = useState<{ message: string | null; at: number } | null>(null)
  const issue = actionError || flow.error
  const dismissed = dismissedIssue?.message === issue && dismissedIssue?.at === data.session.errorUpdatedAt
  const setError = (message: string | null) => {
    if (message) {
      setActionError(message)
      setDismissedIssue(null)
    } else {
      setActionError(null)
      nav.clearError()
      setDismissedIssue({ message: flow.error, at: data.session.errorUpdatedAt })
    }
  }
  const fork = useFork(cfg.id)
  const openSessionById = (nextId: string, options?: { view?: string }) => nav.select({ root, slug: openSlug, id: nextId, view: options?.view })
  const onOpenStats: SessionViewContext['onOpenStats'] = (slug, session) => {
    if (cfg.apiAddr === 'slug+id') onOpenSession?.(cfg.id, { root, slug, id: session.id, title: session.title })
    else openSessionById(session.id)
  }
  const forkFromReply = async (event: TimelineEvent) => {
    const timeline = sessionData?.timeline || []
    if (!cfg.forkCut || !root || !id || !timeline.includes(event)) return
    try {
      const result = await fork.mutateAsync({ ref: { root, slug: openSlug || undefined, id }, cut: cfg.forkCut(timeline, event) })
      if (typeof result.id !== 'string') throw new Error('Fork response did not include a session ID')
      onOpenSession?.(
        cfg.id,
        { root, slug: openSlug, id: result.id, title: typeof result.title === 'string' ? result.title : `${active?.title || id.slice(0, 8)} (fork)` },
        { newTab: true }
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  const hasSubagents = nestedSubagents
    ? hasSubagentsNow(active, data.sessions.data?.sessions || [])
    : !!active && (Number(active.childCount) > 0 || active.hasSubagents === true)
  useEffect(() => {
    if (!nestedSubagents && tab === 'subagents' && id && !hasSubagents) nav.changeView('conversation')
  }, [nestedSubagents, tab, id, hasSubagents, nav.changeView])
  const subagentCtx = useMemo(
    () =>
      root && id
        ? nestedSubagents
          ? openSlug
            ? { root, slug: openSlug, id }
            : null
          : { root, id, provider: cfg.id, api, adapter: cfg.subagentAdapter }
        : null,
    [root, id, openSlug, nestedSubagents, cfg.id, cfg.subagentAdapter, api]
  )
  const usage = data.usage.data
  const contextWindow = usage?.contextWindow
  const used = contextWindow && typeof contextWindow === 'object' && 'used_percentage' in contextWindow ? contextWindow.used_percentage : null
  const termCtxUsed = usage?.sessionId === id && typeof used === 'number' ? Math.min(100, Math.round(used)) : null
  const ctx: SessionViewContext = {
    ...cfg.components,
    api,
    providerId: cfg.id,
    SESSION_TABS: cfg.sessionTabs,
    changeTab: nav.changeView,
    disabledTab: (entry) => (entry.need === 'session' && !active) || (entry.need === 'subagents' && !hasSubagents) || (entry.need === 'project' && !openSlug),
    tab,
    usage,
    usageInfo: cfg.usageInfo,
    docsUrl: cfg.docsBase,
    docsTitle: cfg.docsTitle,
    conn: connection.connection,
    sinceEvent: connection.lastEvent ? Math.round((Date.now() - connection.lastEvent) / 1000) : null,
    error: dismissed ? null : issue,
    setError,
    root,
    active,
    mainRef: pane.mainRef,
    onMainScroll: pane.onScroll,
    termDraft,
    navigationTarget,
    terminalTarget,
    refetchActive: () => data.session.refetch(),
    sessionData,
    openSessionById,
    subagentCtx,
    canFork: !!cfg.forkCut,
    forkFromReply,
    shownPanes,
    curTermKey,
    terminalOf: (target) => terminalFor(terminalEntries, cfg.id, target),
    setTermDraft: (target) => nav.select(target || { root, slug: openSlug }),
    refreshTerminals: () => data.terminals.refetch(),
    runningTermKeys,
    openSlug,
    appActive,
    raw: data.raw.data,
    rawTypeOf: cfg.rawTypeOf,
    stats: data.stats.data,
    statsFocus: active && openSlug ? { slug: openSlug, id: active.id } : null,
    nestedSubagents,
    subagents: data.subagents.data,
    termCtxUsed,
    onOpenStats,
    fillConfig: cfg.fillConfig,
    emptyStreamLabel: cfg.emptyStreamLabel,
  }
  return <SessionView {...ctx} />
}
