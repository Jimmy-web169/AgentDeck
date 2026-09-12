import type { SessionDetails, ConversationData, SubagentIndex, SubagentsProps, RateLimitsProps, UsageReport, ResourceScopeProps } from '../../api/models.ts'
import type { ConversationProps } from './Conversation.tsx'
import type { TerminalProps } from './TerminalPanel.tsx'
import type { ThreadContext } from './SubagentThread.tsx'
import type { StatsProps } from './Stats.tsx'
import type { ComponentType, RefObject, UIEventHandler, CSSProperties } from 'react'
import type { Target, TimelineEvent, TerminalEntry } from '../../../shared/types.js'
import type { createApi } from '../../api/index.ts'
type Session = Partial<SessionDetails> & { id: string }
type SessionTab = { k: string; label: string; need?: string }
export interface SessionViewContext {
  api: ReturnType<typeof createApi>
  providerId: string
  SESSION_TABS: readonly SessionTab[]
  changeTab: (view: string) => void
  disabledTab: (tab: SessionTab) => boolean
  tab: string
  RateLimitsBar: ComponentType<RateLimitsProps>
  usage?: UsageReport | null
  usageInfo: string
  docsUrl: string
  docsTitle: string
  conn: string
  sinceEvent: number | null
  error: string | null
  setError: (message: string | null) => void
  root: string | null
  active: Session | null
  mainRef: RefObject<HTMLDivElement>
  onMainScroll: UIEventHandler<HTMLDivElement>
  termDraft: Target | null
  navigationTarget: Target | null
  terminalTarget: Target | null
  refetchActive: () => unknown
  sessionData?: ConversationData | null
  Conversation: ComponentType<ConversationProps>
  openSessionById: (id: string, options?: { view?: string }) => void
  subagentCtx: ThreadContext | null
  hasSubagents: boolean
  canFork: boolean
  forkFromReply: (event: TimelineEvent) => unknown
  shownPanes: Array<{ key: string; target: Target }>
  curTermKey: string | null
  TerminalPanel: ComponentType<TerminalProps>
  terminalOf: (target: Target) => TerminalEntry | undefined
  setTermDraft: (target: Target | null) => void
  refreshTerminals: () => unknown
  runningTermKeys: Set<string>
  ResourcesView: ComponentType<ResourceScopeProps>
  openSlug: string | null
  SubagentsView: ComponentType<SubagentsProps>
  appActive: boolean
  raw?: { records: unknown[] } | null
  rawTypeOf?: (record: unknown) => string
  Stats?: ComponentType<StatsProps>
  stats: StatsProps['stats']
  statsFocus: StatsProps['focus']
  MemoryView: ComponentType<{ root: string; slug?: string | null; cwd?: string | null }>
  nestedSubagents: boolean
  subagents: SubagentIndex | undefined
  termCtxUsed: number | null
  onOpenStats: (slug: string, session: Session) => void
  fillConfig: boolean
  emptyStreamLabel?: string
}
import { conversationBoundaryKey, viewBoundaryKey } from '../../../shared/identity.ts'
import { ProviderApiContext, providerLabelOf, useProviderLabel } from '../../api/index.ts'
import { MOD_WORD, ShortcutChips } from './ShortcutHints.tsx'
import RawView from './RawView.tsx'
import ConversationPending from './ConversationPending.tsx'
import InfoDot from './InfoDot.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'
import { ActivityIcon } from './icons.tsx'
import { useRef, useState } from 'react'
import SubagentExplorer from './SubagentExplorer.tsx'
import PaneDivider, { usePaneLayout } from './PaneDivider.tsx'
import { getPrefs, setPref } from '../../lib/prefs.ts'

// Shared session layout preserves mounted conversations and terminal panes.
export default function SessionView(ctx: SessionViewContext) {
  const [subagentPane, setSubagentPane] = useState(false)
  // The pane's share follows the pointer locally; the preference store takes
  // one value when the gesture ends.
  const [paneShares, setPaneShares] = useState(() => getPrefs().subagentPane)
  const paneLayout = usePaneLayout()
  const panesRef = useRef<HTMLDivElement>(null)
  const resizePane = (size: number) => setPaneShares((old) => ({ ...old, [paneLayout]: size }))
  const commitPane = (size: number) => setPref('subagentPane', { ...paneShares, [paneLayout]: size })
  const {
    api,
    SESSION_TABS,
    changeTab,
    disabledTab,
    tab,
    RateLimitsBar,
    usage,
    usageInfo,
    docsUrl,
    docsTitle,
    conn,
    sinceEvent,
    error,
    setError,
    root,
    active,
    mainRef,
    onMainScroll,
    termDraft,
    navigationTarget,
    terminalTarget,
    refetchActive,
    sessionData,
    Conversation,
    openSessionById,
    subagentCtx,
    hasSubagents,
    canFork,
    forkFromReply,
    shownPanes,
    curTermKey,
    TerminalPanel,
    terminalOf,
    setTermDraft,
    refreshTerminals,
    runningTermKeys,
    ResourcesView,
    openSlug,
    SubagentsView,
    appActive,
    raw,
    rawTypeOf,
    Stats,
    providerId,
    stats,
    statsFocus,
    MemoryView,
    nestedSubagents,
    subagents,
    termCtxUsed,
    onOpenStats,
    fillConfig,
    emptyStreamLabel,
  } = ctx
  // Only a session that has spawned agents offers the pane; the toggle's
  // state survives across sessions but never shows an empty pane.
  const split = subagentPane && !!subagentCtx && hasSubagents
  return (
    <ProviderApiContext.Provider value={api}>
      <main className="h-full flex flex-col min-w-0">
        <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800 bg-ink-900/70 overflow-x-auto whitespace-nowrap [&>*]:shrink-0">
          <div className="flex gap-1 items-center">
            {SESSION_TABS.map((t) => (
              <button
                type="button"
                key={t.k}
                onClick={() => changeTab(t.k)}
                disabled={disabledTab(t)}
                className={`text-[13px] px-3 py-1.5 rounded-md ${tab === t.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'conversation' && subagentCtx && sessionData && hasSubagents && (
            <button
              type="button"
              aria-pressed={subagentPane}
              onClick={() => setSubagentPane(!subagentPane)}
              title="See every sub-agent's status beside this conversation and open one to read it"
              className={`text-[12px] px-2.5 py-1.5 rounded-md border ${subagentPane ? 'border-sky-500/50 bg-sky-500/10 text-zinc-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'}`}
            >
              {subagentPane ? 'Hide sub-agents' : 'Show sub-agents'}
            </button>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <RateLimitsBar usage={usage?.rateLimits} ts={usage?.ts} />
            <InfoDot text={usageInfo} />
          </div>
          <a href={docsUrl} target="_blank" rel="noreferrer" className="text-[12px] text-zinc-500 hover:text-sky-400" title={docsTitle}>
            docs ↗
          </a>
          <div className="flex items-center gap-2 text-[12px]">
            <span className={`w-2 h-2 rounded-full ${conn === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-zinc-500">
              {conn === 'live' ? 'connected' : 'reconnecting'}
              {sinceEvent != null && conn === 'live' ? ` · ${sinceEvent}s ago` : ''}
            </span>
          </div>
        </div>

        {error && (
          <div className="m-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3 flex justify-between shrink-0">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-400">
              ×
            </button>
          </div>
        )}

        {/* the conversation stays mounted (hidden) while another tab shows, so its
            expanded threads stay mounted; returning to Conversation shows latest */}
        <ErrorBoundary label="this conversation" resetKey={conversationBoundaryKey(root || '', active?.id || '', nestedSubagents ? openSlug || '' : undefined)}>
          <div className={tab === 'conversation' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
            <div
              ref={panesRef}
              className={`conversation-panes flex-1 min-h-0 min-w-0 flex ${split ? 'is-split' : ''}`}
              style={split ? ({ '--subagent-pane': `${Math.round(paneShares[paneLayout] * 1000) / 10}%` } as CSSProperties) : undefined}
            >
              <section ref={mainRef} onScroll={onMainScroll} aria-label="Main transcript" className="flex-1 min-h-0 min-w-0 overflow-y-auto">
                {termDraft ||
                (active && !active.oversized && !sessionData) ||
                (navigationTarget &&
                  (navigationTarget.root !== root || (navigationTarget.id ? navigationTarget.id !== active?.id : navigationTarget.draft))) ? (
                  <ConversationPending target={terminalTarget} error={error} onRetry={refetchActive} />
                ) : active?.oversized ? (
                  <Empty active={active} streamLabel={emptyStreamLabel} />
                ) : sessionData ? (
                  <Conversation
                    key={active?.id}
                    data={sessionData}
                    active={appActive && tab === 'conversation'}
                    onOpenSession={openSessionById}
                    subagentCtx={subagentCtx}
                    onFork={canFork ? forkFromReply : null}
                  />
                ) : (
                  <Empty active={active} streamLabel={emptyStreamLabel} />
                )}
              </section>
              {split && <PaneDivider containerRef={panesRef} layout={paneLayout} size={paneShares[paneLayout]} onSize={resizePane} onCommit={commitPane} />}
              {split && (
                <SubagentExplorer
                  key={conversationBoundaryKey(root || '', active?.id || '', openSlug || '')}
                  provider={providerId}
                  ctx={subagentCtx}
                  nested={nestedSubagents}
                  active={appActive && tab === 'conversation'}
                  Conversation={Conversation}
                  onClose={() => setSubagentPane(false)}
                />
              )}
            </div>
            {shownPanes.map((pane) => {
              const p = pane.target
              const isCur = pane.key === curTermKey
              return (
                <div key={pane.key} className={isCur ? 'contents' : 'hidden'}>
                  <TerminalPanel
                    {...p}
                    paneKey={pane.key}
                    isNew={!p.id}
                    terminalKey={terminalOf(p)?.key || p.terminalKey}
                    transcriptReady={isCur && !!sessionData && active?.id === p.id && root === p.root}
                    contextSummary={isCur ? sessionData?.summary : null}
                    contextUsed={isCur ? termCtxUsed : null}
                    onClose={() => {
                      if (!p.id) setTermDraft(null)
                    }}
                    onChange={refreshTerminals}
                    runningKeys={runningTermKeys}
                    onOpenTool={(what: string) => api.open({ root: p.root || '', id: p.id || null, slug: p.slug || undefined }, { what, cwd: p.cwd })}
                  />
                </div>
              )
            })}
          </div>
        </ErrorBoundary>
        {tab === 'config' && fillConfig && (
          <div className="flex-1 min-h-0">
            <ErrorBoundary label="this view" resetKey={viewBoundaryKey(tab)}>
              <ResourcesView key={`cfg-${root}-${openSlug}`} root={root || ''} scope="project" slug={openSlug} />
            </ErrorBoundary>
          </div>
        )}
        {tab !== 'conversation' && (tab !== 'config' || !fillConfig) && (
          <div className="flex-1 overflow-y-auto">
            <ErrorBoundary label="this view" resetKey={viewBoundaryKey(tab)}>
              {tab === 'subagents' &&
                active &&
                (nestedSubagents ? (
                  <SubagentsView key={active.id} data={subagents} active={appActive} />
                ) : (
                  <SubagentsView key={active.id} root={root} parent={active} active={appActive} onOpenSession={openSessionById} />
                ))}
              {tab === 'raw' && raw && <RawView records={raw.records} typeOf={rawTypeOf} />}
              {tab === 'stats' && active && Stats && (
                <Stats apiClient={api} providerLabel={providerLabelOf(providerId)} root={root} stats={stats} focus={statsFocus} onOpenSession={onOpenStats} />
              )}
              {tab === 'config' && !fillConfig && root && openSlug && <ResourcesView key={`cfg-${root}-${openSlug}`} root={root} slug={openSlug} />}
              {tab === 'memory' && root && openSlug && <MemoryView key={`mem-${root}-${openSlug}`} root={root} cwd={openSlug} slug={openSlug} />}
            </ErrorBoundary>
          </div>
        )}
      </main>
    </ProviderApiContext.Provider>
  )
}

function Empty({ active, streamLabel }: { active: Session | null; streamLabel?: string }) {
  const label = useProviderLabel()
  if (active?.oversized) {
    return (
      <div className="h-full flex items-center justify-center text-center text-zinc-600 px-6">
        <div>
          <div className="flex justify-center mb-3 text-amber-400/80 text-3xl">⚠</div>
          <div className="text-sm text-zinc-400">{active.title}</div>
          <div className="text-[12px] mt-1 text-zinc-600">
            This transcript exceeds the parse limit, so it can't be displayed. Other sessions are unaffected.
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="h-full flex items-center justify-center text-center text-zinc-600">
      <div>
        <div className="flex justify-center mb-3 text-zinc-700">
          <ActivityIcon className="w-10 h-10" />
        </div>
        <div className="text-sm">{active ? 'Loading session…' : 'Pick a project on the left, or press ' + MOD_WORD + '+K to jump anywhere.'}</div>
        <div className="text-[12px] mt-1 text-zinc-700">Live updates stream in as {streamLabel || label} writes to disk.</div>
        {!active && <ShortcutChips className="justify-center mt-5 max-w-lg mx-auto" />}
      </div>
    </div>
  )
}
