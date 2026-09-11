import type { AgentSummary, SubagentIndex, ConversationEvent } from '../../api/models.ts'
import type { ToolCallPart } from '../../../shared/types.d.ts'
import type { QueryRef } from '../../api/queryPolicy.ts'
import type { ConversationProps } from './Conversation.tsx'
export interface ThreadContext {
  root: string
  id?: string
  slug?: string | null
  provider?: string
  depth?: number
  active?: boolean
  index?: SubagentIndex | null
  children?: AgentSummary[]
  claimed?: Set<string>
  ev?: ConversationEvent
  adapter?: ThreadAdapter
}
export interface ThreadItem {
  key: string
  agentId?: string | null
  runId?: string | null
  childId?: string
  label: string
  type: string
  status: string
  elapsedMs?: number
  toolCalls?: number | null
  tokens?: import('../../lib/format.ts').Tokens | null
  expandable?: boolean
  note?: string | null
  agentCount?: number
}
export interface ThreadAdapter {
  accent: { border: string; rail: string; badge: string; text: string }
  resolve: (part: ToolCallPart, ctx: ThreadContext) => ThreadItem | null
  transcriptTarget: (item: ThreadItem, ctx: ThreadContext) => { kind: 'session' | 'subagent'; ref: QueryRef }
}
import { useThreadTranscript } from '../../api/index.ts'
import { memo, useMemo, useState } from 'react'
import { fmtTokens } from '../../lib/format.ts'

// Inline sub-agent thread: the collapsible block rendered right under the tool
// call that spawned a sub-agent. This file is presentation + lazy loading only;
// what counts as "the spawning call" and how a child transcript is fetched is
// the per-provider adapter's business (claude/subagentAdapter.js,
// codex/subagentAdapter.js), which supplies:
//   resolve(part, ctx)         → item | null   (ctx.claimed = ids already linked, ctx.ev = the assistant event)
//   transcriptTarget(item, ctx) → { kind, ref } for the shared Query cache
// The thread never navigates away: the Sub-agents tab is a separate way in,
// and the maintainer did not want the conversation to jump while reading.
//   accent                     → { border, rail, badge, text } theme-token classes
// item: { key, label, type, status, elapsedMs, toolCalls, tokens, expandable, agentCount?, note? }
//
// Nested sub-agents (a child spawning its own) render the header only — no
// recursion — which is what `ctx.depth >= 1` means here.

export const STATUS_DOT: Record<string, string> = {
  done: 'bg-emerald-400',
  running: 'bg-amber-400 animate-pulse',
  starting: 'bg-sky-400 animate-pulse',
  stalled: 'bg-zinc-600',
  idle: 'bg-zinc-500',
  unknown: 'bg-zinc-500',
}

// Same wording as the provider apps' oversized-session placeholder.
const OVERSIZED_MSG = "This transcript exceeds the parse limit, so it can't be displayed."

export function fmtDur(ms: number) {
  if (!ms || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`
}

// Resolve every tool_use of a timeline once (the caller memoises the result)
// so rows stay cheap: AssistantMsg just looks its part id up in the map.
// `claimed` stops two calls from linking to the same agent when a fallback
// rule (description / timestamp) is used.
export function buildThreadMap(timeline: ConversationEvent[], adapter: ThreadAdapter, ctx: ThreadContext) {
  const map = new Map<string, ThreadItem>()
  const claimed = new Set<string>()
  for (const ev of timeline) {
    if (ev.kind !== 'assistant' || !ev.parts?.length) continue
    let rctx = null
    for (const p of ev.parts) {
      if (p.kind !== 'tool_call' || !p.id) continue
      if (!rctx) rctx = { ...ctx, claimed, ev }
      const item = adapter.resolve(p, rctx)
      if (item) map.set(p.id, item)
    }
  }
  return map
}

function SubagentThread({
  item,
  adapter,
  ctx,
  Conversation,
}: {
  item: ThreadItem
  adapter: ThreadAdapter
  ctx: ThreadContext
  Conversation: React.ComponentType<ConversationProps>
}) {
  const [open, setOpen] = useState(false)
  const depth = ctx?.depth || 0
  const canExpand = depth === 0 && item.expandable !== false && !!Conversation
  const accent = adapter.accent
  const dot = STATUS_DOT[item.status] || STATUS_DOT.unknown
  // the child transcript resolves its own tool calls against the same index,
  // one level deeper (header-only there)
  const childCtx = useMemo(() => ({ ...ctx, depth: depth + 1 }), [ctx, depth])
  const query = useThreadTranscript(adapter.transcriptTarget(item, ctx), { enabled: open && canExpand && ctx?.active !== false, done: item.status === 'done' })
  const tx = {
    data: query.data,
    loading: query.isPending,
    error: query.error?.message,
    status: query.error && 'status' in query.error ? query.error.status : undefined,
  }
  const load = () => query.refetch()
  const toggle = () => setOpen((previous) => !previous)

  return (
    <div className={`my-2 rounded-lg border ${accent.border} bg-ink-800/40`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[12px] min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} title={item.status} />
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${accent.badge}`}>⤷ {item.type}</span>
        <span className="text-zinc-200 truncate flex-1 min-w-[8rem]" title={item.label}>
          {item.label}
        </span>
        {(item.elapsedMs || 0) > 0 && <span className="text-[11px] text-zinc-500 shrink-0">{fmtDur(item.elapsedMs || 0)}</span>}
        {item.agentCount != null && <span className="text-[11px] text-zinc-500 shrink-0">{item.agentCount} agents</span>}
        {item.toolCalls != null && (
          <span className="text-[11px] text-zinc-500 shrink-0">
            {item.toolCalls} tool{item.toolCalls === 1 ? '' : 's'}
          </span>
        )}
        {item.tokens && <span className="text-[11px] text-zinc-500 font-mono shrink-0">↓{fmtTokens(item.tokens.output)}</span>}
        {item.note && <span className="text-[11px] text-amber-400/80 shrink-0">{item.note}</span>}
        {canExpand && (
          <button type="button" onClick={toggle} className={`shrink-0 text-[11px] ${accent.text} hover:underline`}>
            {open ? '▾ hide thread' : '▸ show thread'}
          </button>
        )}
        {open && tx && !tx.loading && (
          <button type="button" onClick={() => load()} title="Refetch this thread" className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200">
            ↻
          </button>
        )}
      </div>
      {open && (
        <div className={`mx-2 mb-2 border-l-2 ${accent.rail} bg-ink-900/40 rounded-r-md max-h-[60vh] overflow-y-auto`}>
          {tx?.loading && <div className="p-4 text-center text-[12px] text-zinc-600">Loading thread…</div>}
          {tx?.error && <div className="p-4 text-center text-[12px] text-red-300">{tx.status === 413 ? OVERSIZED_MSG : tx.error}</div>}
          {tx?.data && <Conversation data={tx.data} compact subagentCtx={childCtx} />}
        </div>
      )}
    </div>
  )
}

export default memo(SubagentThread)
