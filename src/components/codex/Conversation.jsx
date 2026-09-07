import { Fragment, memo, useMemo, useState } from 'react'
import Markdown from '../shared/Markdown.jsx'
import ToolCall from './ToolCall.jsx'
import Thinking from '../shared/Thinking.jsx'
import SubagentThread, { buildThreadMap, useSubagentIndex } from '../shared/SubagentThread.jsx'
import subagentAdapter from './subagentAdapter.js'
import { BotIcon } from '../shared/icons.jsx'
import { codexApi as api } from '../../api.js'
import { usePrefs } from '../../lib/prefs.js'
import { fmtTime, fmtTokens, totalTokens } from '../../lib/format.js'
import ContextMeter from './ContextMeter.jsx'

function UserMsg({ ev }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink-500 px-4 py-2.5">
        <div className="md whitespace-pre-wrap break-words text-[15px] leading-7">{ev.text}</div>
      </div>
    </div>
  )
}

// `threads` (Map call_id → resolved child rollout, see buildThreadMap) is null
// unless inline sub-agent threads are on and this session has children.
function AssistantMsg({ ev, threads, ctx }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 shrink-0 w-7 h-7 rounded-full bg-ink-600 border border-zinc-600 flex items-center justify-center text-zinc-300">
        <BotIcon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        {ev.parts.map((p, i) => {
          if (p.kind === 'thinking') return <Thinking key={i} text={p.text} label="reasoning" />
          if (p.kind === 'tool_use') {
            const thread = threads ? threads.get(p.id) : null
            if (!thread) return <ToolCall key={i} part={p} />
            return (
              <Fragment key={i}>
                <ToolCall part={p} />
                <SubagentThread item={thread} adapter={subagentAdapter} ctx={ctx} Conversation={MemoConversation} />
              </Fragment>
            )
          }
          return (
            <div key={i} className="my-1">
              <Markdown>{p.text}</Markdown>
            </div>
          )
        })}
        <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-600">
          {ev.model && <span className="font-mono">{ev.model}</span>}
          {ev.ts && <span>{fmtTime(ev.ts)}</span>}
        </div>
      </div>
    </div>
  )
}

function SystemMsg({ ev }) {
  return (
    <div className="text-center">
      <span className="inline-block text-[11px] text-zinc-500 bg-ink-700/60 border border-zinc-700/60 rounded-full px-3 py-1">
        ⚙ {ev.subtype || 'system'}
        {ev.text ? ` — ${ev.text}` : ''}
      </span>
    </div>
  )
}

// Mounting a long transcript parses + highlights every message synchronously;
// render only the tail by default so returning to a conversation stays instant.
const INITIAL_TAIL = 40

// `subagentCtx` (optional, from CodexApp) enables inline sub-agent threads:
// { root, id, onOpenSubagent, depth? }. Without it — or with the inlineSubagents
// preference off — the view renders exactly as before. Linking works from this
// session's own `children` (they ride on the session payload); the parent
// (depth 0) additionally fetches the rich children list for tokens / tool
// counts. A child rendered inline gets depth 1 and shows headers only.
// `compact` is the inline-child styling (tighter padding, smaller title).
function Conversation({ data, onOpenSession, subagentCtx = null, compact = false }) {
  const { summary, timeline } = data
  const children = data.children || []
  const [startIdx, setStartIdx] = useState(() => Math.max(0, timeline.length - INITIAL_TAIL))
  const visible = startIdx > 0 ? timeline.slice(startIdx) : timeline

  const { inlineSubagents } = usePrefs()
  const depth = subagentCtx?.depth || 0
  const inlineOn = !!subagentCtx && inlineSubagents && children.length > 0
  const wantIndex = inlineOn && depth === 0
  const index = useSubagentIndex({
    enabled: wantIndex,
    key: wantIndex ? `${subagentCtx.root}|${subagentCtx.id}` : null,
    version: data, // a refetched parent transcript is the cue to re-list its children
    fetcher: () => api.subagents(subagentCtx.root, subagentCtx.id),
  })
  const ctx = useMemo(() => {
    if (!inlineOn) return null
    // the rich list (tokens, tool calls) replaces the bare one once it arrives;
    // a nested child only ever has its own bare list
    const list = depth === 0 && index?.children?.length ? index.children : children
    return { ...subagentCtx, children: list, depth }
  }, [inlineOn, subagentCtx, index, children, depth])
  const threads = useMemo(() => (ctx ? buildThreadMap(timeline, subagentAdapter, ctx) : null), [timeline, ctx])

  return (
    <div className={compact ? 'px-3 py-3' : 'mx-auto max-w-3xl px-4 py-6'}>
      <div className={`${compact ? 'mb-3 pb-3' : 'mb-5 pb-4'} border-b border-zinc-700/60`}>
        <h1 className={`${compact ? 'text-[14px]' : 'text-lg'} font-semibold text-zinc-100`}>{summary.title}</h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-500">
          <span>{summary.userTurns} prompts</span>
          <span>{summary.assistantTurns} replies</span>
          <span>{summary.toolCalls} tool calls</span>
          {summary.models?.map((m) => (
            <span key={m} className="font-mono">{m}</span>
          ))}
          {totalTokens(summary.tokens) > 0 && (
            <span>Σ ↑{fmtTokens(summary.tokens.input)} ↓{fmtTokens(summary.tokens.output)} ⚡{fmtTokens(summary.tokens.cacheRead)} · {fmtTokens(totalTokens(summary.tokens))} total</span>
          )}
          <ContextMeter summary={summary} />
        </div>
        {summary.isSubagent && (
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">⤷ subagent{summary.agentRole ? ` · ${summary.agentRole}` : ''}{summary.agentNickname ? ` (${summary.agentNickname})` : ''}</span>
            {summary.parentId && onOpenSession && (
              <button onClick={() => onOpenSession(summary.parentId)} className="text-sky-400 hover:text-sky-300">↑ parent thread</button>
            )}
          </div>
        )}
        {children.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-zinc-500">spawned {children.length} subagent{children.length > 1 ? 's' : ''}:</span>
            {children.map((c) => (
              <button key={c.id} onClick={() => onOpenSession?.(c.id)} className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 font-mono" title={c.id}>
                ⤷ {c.agentRole || 'agent'}{c.agentNickname ? ` (${c.agentNickname})` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={compact ? 'space-y-4' : 'space-y-6'}>
        {startIdx > 0 && (
          <button
            onClick={() => setStartIdx(0)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-[13px] text-sky-200 hover:bg-sky-500/20 hover:border-sky-500/50 transition-colors"
            title="Only the latest messages are rendered at first; click to load the whole conversation"
          >
            <span aria-hidden>↑</span>
            Show {startIdx} earlier {startIdx > 1 ? 'messages' : 'message'}
            <span className="text-[11px] text-sky-300/70">· {timeline.length} in total</span>
          </button>
        )}
        {visible.map((ev, i) => {
          const k = startIdx + i
          if (ev.kind === 'user') return <UserMsg key={k} ev={ev} />
          if (ev.kind === 'assistant') return <AssistantMsg key={k} ev={ev} threads={threads} ctx={ctx} />
          if (ev.kind === 'system') return <SystemMsg key={k} ev={ev} />
          return null
        })}
        {timeline.length === 0 && <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>}
      </div>
    </div>
  )
}

const MemoConversation = memo(Conversation)
export default MemoConversation
