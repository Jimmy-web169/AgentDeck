import { memo, useMemo, useState } from 'react'
import Markdown from '../shared/Markdown.jsx'
import ToolCall from './ToolCall.jsx'
import Thinking from '../shared/Thinking.jsx'
import { BotIcon } from '../shared/icons.jsx'
import CopyButton from '../shared/CopyButton.jsx'
import InfoDot from '../shared/InfoDot.jsx'
import { fmtTime, fmtTokens, totalTokens } from '../../lib/format.js'
import ContextMeter from './ContextMeter.jsx'

const assistantText = (ev) => ev.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n')

function UserMsg({ ev, onEdit }) {
  return (
    <div className="group flex flex-col items-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink-500 px-4 py-2.5">
        <div className="md whitespace-pre-wrap break-words text-[15px] leading-7">{ev.text}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-3 pr-1">
        {onEdit && (
          <button
            onClick={() => onEdit(ev)}
            title="Edit this prompt and resend on a fork (the original session is untouched)"
            className="text-[11px] text-zinc-500 hover:text-sky-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            ✎ edit & resend
          </button>
        )}
        <CopyButton text={ev.text} title="Copy this prompt" />
      </div>
    </div>
  )
}

function AssistantMsg({ ev, onFork }) {
  return (
    <div className="group flex gap-3">
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
          {ev.parts.some((p) => p.kind === 'text') && <CopyButton text={() => assistantText(ev)} title="Copy this reply" />}
          {onFork && (
            <button
              onClick={() => onFork(ev)}
              title="Fork a new session from this reply (keeps the history up to here)"
              className="text-[11px] text-zinc-500 hover:text-sky-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
            >
              ⑂ fork from here
            </button>
          )}
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

// ---- live (in-flight) items, streamed in via the /chat WebSocket ----
function LiveItem({ it }) {
  if (it.kind === 'user') return <UserMsg ev={{ text: it.text }} />
  if (it.kind === 'thinking') {
    return (
      <div className="flex gap-3">
        <div className="mt-1 shrink-0 w-7 h-7 rounded-full bg-ink-600 border border-emerald-600/50 flex items-center justify-center text-emerald-300">
          <BotIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">{it.text ? <Thinking text={it.text} label="reasoning" /> : <span className="text-zinc-600 text-sm">▍</span>}</div>
      </div>
    )
  }
  if (it.kind === 'message') {
    return (
      <div className="flex gap-3">
        <div className="mt-1 shrink-0 w-7 h-7 rounded-full bg-ink-600 border border-emerald-600/50 flex items-center justify-center text-emerald-300">
          <BotIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">{it.text ? <Markdown>{it.text}</Markdown> : <span className="text-zinc-600 text-sm">▍</span>}</div>
      </div>
    )
  }
  if (it.kind === 'tool') {
    const running = it.status && it.status !== 'completed' && it.status !== 'failed'
    return (
      <div className={`ml-10 min-w-0 max-w-full overflow-hidden rounded-lg border ${it.isError ? 'border-red-500/40' : 'border-zinc-700/70'} bg-ink-700/50 px-3 py-1.5 text-[12px]`}>
        <div className="flex gap-2 min-w-0 items-center">
          <span className="text-emerald-300 font-mono shrink-0">{it.name}</span>
          <span className="text-zinc-500 font-mono min-w-0 break-all line-clamp-2">{(typeof it.input === 'object' ? JSON.stringify(it.input) : String(it.input || '')).slice(0, 200)}</span>
          {running && <span className="ml-auto shrink-0 text-amber-300/80">running…</span>}
          {it.exitCode != null && <span className={`ml-auto shrink-0 ${it.isError ? 'text-red-300' : 'text-zinc-500'}`}>exit {it.exitCode}</span>}
        </div>
        {it.result != null && it.result !== '' && <pre className="mt-1 text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-40 overflow-auto">{String(it.result).slice(0, 2000)}</pre>}
      </div>
    )
  }
  if (it.kind === 'error') {
    return <div className="ml-10 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">⚠ {it.text}</div>
  }
  return null
}

// Mounting a long transcript parses + highlights every message synchronously;
// render only the tail by default so returning to a conversation stays instant.
const INITIAL_TAIL = 40

function Conversation({ data, live, onOpenSession, onEdit, onFork }) {
  const { summary, timeline } = data
  const children = data.children || []
  // fork cuts at turn boundaries, so only the LAST assistant bubble of each
  // turn gets the button — a mid-turn (tool-call) bubble would fork identically
  // and just muddle where the cut lands
  const turnEnds = useMemo(() => {
    const s = new Set()
    let last = -1
    timeline.forEach((ev, i) => {
      if (ev.kind === 'assistant') last = i
      if (ev.kind === 'user') {
        if (last >= 0) s.add(last)
        last = -1
      }
    })
    if (last >= 0) s.add(last)
    return s
  }, [timeline])
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
            <span className="inline-flex items-center gap-1.5">
              Σ ↑{fmtTokens(summary.tokens.input)} ↓{fmtTokens(summary.tokens.output)} ⚡{fmtTokens(summary.tokens.cacheRead)} · {fmtTokens(totalTokens(summary.tokens))} total
              <InfoDot
                align="left"
                text={
                  <>
                    Session token totals:<br />
                    <b>↑</b> input — prompts + context sent to the model<br />
                    <b>↓</b> output — text the model generated<br />
                    <b>⚡</b> cache read — context re-served from the prompt cache instead of being reprocessed (much cheaper than fresh input)<br />
                    <b>total</b> — all of the above combined
                  </>
                }
              />
            </span>
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
          if (ev.kind === 'user') return <UserMsg key={k} ev={ev} onEdit={onEdit} />
          if (ev.kind === 'assistant') return <AssistantMsg key={k} ev={ev} onFork={turnEnds.has(k) ? onFork : undefined} />
          if (ev.kind === 'system') return <SystemMsg key={k} ev={ev} />
          return null
        })}
        {timeline.length === 0 && !(live && live.items.length) && (
          <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>
        )}
        {live && live.items.map((it, i) => <LiveItem key={it.id || `live-${i}`} it={it} />)}
      </div>
    </div>
  )
}

export default memo(Conversation)
