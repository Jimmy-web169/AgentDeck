import { memo, useState } from 'react'
import Markdown from '../shared/Markdown.jsx'
import ToolCall from './ToolCall.jsx'
import Thinking from '../shared/Thinking.jsx'
import { BotIcon } from '../shared/icons.jsx'
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

function AssistantMsg({ ev }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 shrink-0 w-7 h-7 rounded-full bg-ink-600 border border-zinc-600 flex items-center justify-center text-zinc-300">
        <BotIcon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        {ev.parts.map((p, i) => {
          if (p.kind === 'thinking') return <Thinking key={i} text={p.text} label="reasoning" />
          if (p.kind === 'tool_use') return <ToolCall key={i} part={p} />
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

function Conversation({ data, onOpenSession }) {
  const { summary, timeline } = data
  const children = data.children || []
  const [startIdx, setStartIdx] = useState(() => Math.max(0, timeline.length - INITIAL_TAIL))
  const visible = startIdx > 0 ? timeline.slice(startIdx) : timeline
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5 pb-4 border-b border-zinc-700/60">
        <h1 className="text-lg font-semibold text-zinc-100">{summary.title}</h1>
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

      <div className="space-y-6">
        {startIdx > 0 && (
          <div className="text-center">
            <button onClick={() => setStartIdx(0)} className="text-[12px] text-zinc-400 hover:text-zinc-200 bg-ink-700/60 border border-zinc-700/60 rounded-full px-3 py-1">
              Show {startIdx} earlier {startIdx > 1 ? 'messages' : 'message'}
            </button>
          </div>
        )}
        {visible.map((ev, i) => {
          const k = startIdx + i
          if (ev.kind === 'user') return <UserMsg key={k} ev={ev} />
          if (ev.kind === 'assistant') return <AssistantMsg key={k} ev={ev} />
          if (ev.kind === 'system') return <SystemMsg key={k} ev={ev} />
          return null
        })}
        {timeline.length === 0 && <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>}
      </div>
    </div>
  )
}

export default memo(Conversation)
