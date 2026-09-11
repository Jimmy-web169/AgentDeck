import type { ConversationProps, MessageProps } from '../shared/Conversation.tsx'
import type { TextPart, ThinkingPart, AdvisorPart } from '../../../shared/types.d.ts'
import { useSubagents } from '../../api/index.ts'
import SharedConversation, { UserMsg, SystemMsg, AssistantMessage } from '../shared/Conversation.tsx'
import { memo, useMemo } from 'react'
import Markdown from '../shared/Markdown.tsx'
import ToolCall from './ToolCall.tsx'
import { buildThreadMap } from '../shared/SubagentThread.tsx'
import subagentAdapter from './subagentAdapter.ts'
import { useProviderApi } from '../../api/index.ts'
import { usePrefs } from '../../lib/prefs.ts'
import { fmtTokens, totalTokens } from '../../lib/format.ts'
import ContextMeter from './ContextMeter.tsx'

// `threads` (Map call_id → resolved child rollout, see buildThreadMap) is null
// unless inline sub-agent threads are on and this session has children.
function MessagePart({ part: p }: { part: TextPart | ThinkingPart | AdvisorPart }) {
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
      adapter={ctx?.adapter || subagentAdapter}
      Conversation={MemoConversation}
      Part={MessagePart}
      thinkingLabel="reasoning"
    />
  )
}

// Mounting a long transcript parses + highlights every message synchronously;
// only the tail renders at first (lib/useEarlier.js); earlier messages come in
// chunks without moving what the reader is looking at.

// `subagentCtx` (optional, from SessionApp) enables inline sub-agent threads:
// { root, id, depth? }. Without it — or with the inlineSubagents
// preference off — the view renders exactly as before. Linking works from this
// session's own `children` (they ride on the session payload); the parent
// (depth 0) additionally fetches the rich children list for tokens / tool
// counts. A child rendered inline gets depth 1 and shows headers only.
// `compact` is the inline-child styling (tighter padding, smaller title).
function Conversation({ data, onOpenSession, subagentCtx = null, compact = false, onFork = null, active = true }: ConversationProps) {
  const api = useProviderApi()
  const { summary, timeline } = data
  const children = data.children || []
  const { inlineSubagents } = usePrefs()
  const depth = subagentCtx?.depth || 0
  const inlineOn = !!subagentCtx && inlineSubagents && children.length > 0
  const wantIndex = inlineOn && depth === 0
  const index = useSubagents(
    { provider: api.provider, root: subagentCtx?.root || '', id: subagentCtx?.id || '' },
    { enabled: wantIndex && active && subagentCtx?.active !== false }
  ).data
  const ctx = useMemo(() => {
    if (!inlineOn) return null
    // the rich list (tokens, tool calls) replaces the bare one once it arrives;
    // a nested child only ever has its own bare list
    const list = depth === 0 && index?.children?.length ? index.children : children
    return { ...subagentCtx, children: list, depth, active }
  }, [inlineOn, subagentCtx, index, children, depth, active])
  // the adapter rides on the ctx so an id-addressed provider (Antigravity) can
  // reuse this view with its own linking rules; Codex's is the default
  const adapter = subagentCtx?.adapter || subagentAdapter
  const threads = useMemo(() => (ctx ? buildThreadMap(timeline, adapter, ctx) : null), [timeline, ctx, adapter])

  return (
    <SharedConversation
      data={data}
      compact={compact}
      active={active}
      onFork={onFork}
      headerExtras={
        <>
          {/* Provider token/context details retain their exact original markup. */}
          {totalTokens(summary.tokens) > 0 && (
            <span>
              Σ ↑{fmtTokens(summary.tokens.input)} ↓{fmtTokens(summary.tokens.output)} ⚡{fmtTokens(summary.tokens.cacheRead)} ·{' '}
              {fmtTokens(totalTokens(summary.tokens))} total
            </span>
          )}
          <ContextMeter summary={summary} />
        </>
      }
      headerRelations={
        <>
          {summary.isSubagent && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
                ⤷ subagent{summary.agentRole ? ` · ${summary.agentRole}` : ''}
                {summary.agentNickname ? ` (${summary.agentNickname})` : ''}
              </span>
              {summary.parentId && onOpenSession && (
                <button type="button" onClick={() => summary.parentId && onOpenSession(summary.parentId)} className="text-sky-400 hover:text-sky-300">
                  ↑ parent thread
                </button>
              )}
            </div>
          )}
          {children.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-zinc-500">
                spawned {children.length} subagent{children.length > 1 ? 's' : ''}:
              </span>
              {children.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => onOpenSession?.(c.id)}
                  className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 font-mono"
                  title={c.id}
                >
                  ⤷ {c.agentRole || 'agent'}
                  {c.agentNickname ? ` (${c.agentNickname})` : ''}
                </button>
              ))}
            </div>
          )}
        </>
      }
      renderEvent={(ev, key, fork) => {
        if (ev.kind === 'user') return <UserMsg key={key} ev={ev} />
        if (ev.kind === 'assistant') return <AssistantMsg key={key} ev={ev} threads={threads} ctx={ctx} onFork={fork} />
        if (ev.kind === 'system') return <SystemMsg key={key} ev={ev} />

        return null
      }}
    />
  )
}

const MemoConversation = memo(Conversation)
export default MemoConversation
