import type { ConversationProps, MessageProps } from '../shared/Conversation.tsx'
import type { TextPart, ThinkingPart, AdvisorPart } from '../../../shared/types.d.ts'
import { useSubagents } from '../../api/index.ts'
import SharedConversation, { UserMsg, SystemMsg, AssistantMessage } from '../shared/Conversation.tsx'
import { memo, useMemo } from 'react'
import Markdown from '../shared/Markdown.tsx'
import ToolCall from './ToolCall.tsx'
import { buildThreadMap } from '../shared/SubagentThread.tsx'
import subagentAdapter from './subagentAdapter.ts'
import { usePrefs } from '../../lib/prefs.ts'
import { fmtTokens, totalTokens } from '../../lib/format.ts'

// `threads` (Map tool_use id → resolved sub-agent, see buildThreadMap) is null
// unless inline sub-agent threads are on and the agent index has loaded.
function MessagePart({ part: p }: { part: TextPart | ThinkingPart | AdvisorPart }) {
  if (p.kind === 'advisor')
    return (
      <div className="my-2 border-l-2 border-sky-500/40 pl-3 text-[13px] text-sky-200/80">
        <div className="text-[11px] uppercase tracking-wide text-sky-400/70">advisor</div>
        <div className="whitespace-pre-wrap">{p.text}</div>
      </div>
    )
  return (
    <div className="my-1">
      <Markdown>{p.text}</Markdown>
    </div>
  )
}

function AssistantMsg({ ev, threads, ctx, onFork }: MessageProps) {
  return (
    <AssistantMessage
      ev={ev}
      threads={threads}
      ctx={ctx}
      onFork={onFork}
      ToolCall={ToolCall}
      adapter={subagentAdapter}
      Conversation={MemoConversation}
      Part={MessagePart}
      lead={ev.isError && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 mb-2">API error message</div>}
      usage={
        ev.usage &&
        totalTokens(ev.usage) > 0 && (
          <span>
            ↑{fmtTokens(ev.usage.input)} ↓{fmtTokens(ev.usage.output)}
            {ev.usage.cacheRead ? ` ⚡${fmtTokens(ev.usage.cacheRead)}` : ''}
          </span>
        )
      }
      flags={ev.isSidechain && <span className="text-violet-400">sidechain</span>}
    />
  )
}

function AttachmentMsg({ ev }: { ev: import('../../api/models.ts').ConversationEvent }) {
  return (
    <div className="text-center">
      <span className="inline-block text-[11px] text-zinc-400 bg-ink-700/60 border border-zinc-700/60 rounded-full px-3 py-1">
        📎 {ev.name} {ev.detail && <span className="text-zinc-600">({ev.detail})</span>}
      </span>
    </div>
  )
}

// Mounting a long transcript parses + highlights every message synchronously;
// only the tail renders at first (lib/useEarlier.js); earlier messages come in
// chunks without moving what the reader is looking at.

// `subagentCtx` (optional, from SessionApp) enables inline sub-agent threads:
// { root, slug, id, depth?, index? }. Without it — or with the
// inlineSubagents preference off — the view renders exactly as before. The
// parent (depth 0) fetches the agent index once; a child transcript rendered
// inline receives the same index one level deeper and shows headers only.
// `compact` is the inline-child styling (tighter padding, smaller title).
function Conversation({ data, subagentCtx = null, compact = false, onFork = null, active = true }: ConversationProps) {
  const { summary, timeline } = data
  const { inlineSubagents } = usePrefs()
  const depth = subagentCtx?.depth || 0
  const inlineOn = !!subagentCtx && inlineSubagents
  const wantIndex = inlineOn && depth === 0 && !!summary.hasSubagents
  const index = useSubagents(
    { provider: 'claude', root: subagentCtx?.root || '', id: subagentCtx?.id || '', slug: subagentCtx?.slug },
    { enabled: wantIndex && active && subagentCtx?.active !== false }
  ).data
  const ctx = useMemo(() => {
    if (!inlineOn) return null
    const idx = depth === 0 ? index : subagentCtx.index || null
    return idx ? { ...subagentCtx, index: idx, depth, active } : null
  }, [inlineOn, subagentCtx, index, depth, active])
  const threads = useMemo(() => (ctx ? buildThreadMap(timeline, subagentAdapter, ctx) : null), [timeline, ctx])

  return (
    <SharedConversation
      data={data}
      compact={compact}
      onFork={onFork}
      headerExtras={
        <>
          {/* Provider token/context details retain their exact original markup. */}
          <span>
            Σ ↑{fmtTokens(summary.tokens.input)} ↓{fmtTokens(summary.tokens.output)} ⚡{fmtTokens(summary.tokens.cacheRead)}
          </span>
          {summary.hasSidechain && <span className="text-violet-400">has sub-agents</span>}
        </>
      }
      headerRelations={<></>}
      renderEvent={(ev, key, fork) => {
        if (ev.kind === 'user') return <UserMsg key={key} ev={ev} />
        if (ev.kind === 'assistant') return <AssistantMsg key={key} ev={ev} threads={threads} ctx={ctx} onFork={fork} />
        if (ev.kind === 'system') return <SystemMsg key={key} ev={ev} />
        if (ev.kind === 'attachment') return <AttachmentMsg key={key} ev={ev} />
        return null
      }}
    />
  )
}

const MemoConversation = memo(Conversation)
export default MemoConversation
