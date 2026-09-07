import { memo, useState } from 'react'
import Markdown from '../shared/Markdown.jsx'
import ToolCall from './ToolCall.jsx'
import Thinking from '../shared/Thinking.jsx'
import { BotIcon } from '../shared/icons.jsx'
import { fmtTime, fmtTokens, totalTokens } from '../../lib/format.js'

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
        {ev.isError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 mb-2">
            API error message
          </div>
        )}
        {ev.parts.map((p, i) => {
          if (p.kind === 'thinking') return <Thinking key={i} text={p.text} />
          if (p.kind === 'tool_use') return <ToolCall key={i} part={p} />
          if (p.kind === 'advisor')
            return (
              <div key={i} className="my-2 border-l-2 border-sky-500/40 pl-3 text-[13px] text-sky-200/80">
                <div className="text-[11px] uppercase tracking-wide text-sky-400/70">advisor</div>
                <div className="whitespace-pre-wrap">{p.text}</div>
              </div>
            )
          return (
            <div key={i} className="my-1">
              <Markdown>{p.text}</Markdown>
            </div>
          )
        })}
        <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-600">
          {ev.model && <span className="font-mono">{ev.model}</span>}
          {ev.usage && totalTokens(ev.usage) > 0 && (
            <span>
              ↑{fmtTokens(ev.usage.input)} ↓{fmtTokens(ev.usage.output)}
              {ev.usage.cacheRead ? ` ⚡${fmtTokens(ev.usage.cacheRead)}` : ''}
            </span>
          )}
          {ev.ts && <span>{fmtTime(ev.ts)}</span>}
          {ev.isSidechain && <span className="text-violet-400">sidechain</span>}
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

function AttachmentMsg({ ev }) {
  return (
    <div className="text-center">
      <span className="inline-block text-[11px] text-zinc-400 bg-ink-700/60 border border-zinc-700/60 rounded-full px-3 py-1">
        📎 {ev.name} {ev.detail && <span className="text-zinc-600">({ev.detail})</span>}
      </span>
    </div>
  )
}

// Mounting a long transcript parses + highlights every message synchronously;
// render only the tail by default so returning to a conversation stays instant.
const INITIAL_TAIL = 40

function Conversation({ data }) {
  const { summary, timeline } = data
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
          <span>Σ ↑{fmtTokens(summary.tokens.input)} ↓{fmtTokens(summary.tokens.output)} ⚡{fmtTokens(summary.tokens.cacheRead)}</span>
          {summary.hasSidechain && <span className="text-violet-400">has sub-agents</span>}
        </div>
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
          if (ev.kind === 'attachment') return <AttachmentMsg key={k} ev={ev} />
          return null
        })}
        {timeline.length === 0 && <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>}
      </div>
    </div>
  )
}

export default memo(Conversation)
