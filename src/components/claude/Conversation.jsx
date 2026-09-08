import { Fragment, memo, useMemo, useRef } from 'react'
import Markdown from '../shared/Markdown.jsx'
import ToolCall from './ToolCall.jsx'
import Thinking from '../shared/Thinking.jsx'
import EarlierBar from '../shared/EarlierBar.jsx'
import { useEarlier } from '../../lib/useEarlier.js'
import SubagentThread, { buildThreadMap, useSubagentIndex } from '../shared/SubagentThread.jsx'
import subagentAdapter from './subagentAdapter.js'
import { BotIcon } from '../shared/icons.jsx'
import { claudeApi as api } from '../../api.js'
import { usePrefs } from '../../lib/prefs.js'
import CopyButton from '../shared/CopyButton.jsx'
import { fmtTime, fmtTokens, totalTokens } from '../../lib/format.js'

// the text of a reply, for the copy button (thinking and tool calls left out)
const assistantText = (ev) => ev.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n')

function UserMsg({ ev }) {
  return (
    <div className="group flex flex-col items-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink-500 px-4 py-2.5">
        <div className="md whitespace-pre-wrap break-words text-[15px] leading-7">{ev.text}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-3 pr-1">
        <CopyButton text={ev.text} title="Copy this prompt" />
      </div>
    </div>
  )
}

// `threads` (Map tool_use id → resolved sub-agent, see buildThreadMap) is null
// unless inline sub-agent threads are on and the agent index has loaded.
function AssistantMsg({ ev, threads, ctx, onFork }) {
  return (
    <div className="group flex gap-3">
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
          if (p.kind === 'tool_call') {
            const thread = threads ? threads.get(p.id) : null
            if (!thread) return <ToolCall key={i} part={p} />
            return (
              <Fragment key={i}>
                <ToolCall part={p} />
                <SubagentThread item={thread} adapter={subagentAdapter} ctx={ctx} Conversation={MemoConversation} />
              </Fragment>
            )
          }
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
          {ev.parts.some((p) => p.kind === 'text') && <CopyButton text={() => assistantText(ev)} title="Copy this reply" />}
          {onFork && (
            <button
              onClick={() => onFork(ev)}
              title="Fork a new session from this reply — keeps the history up to here, opens the fork in its own tab; the original is untouched"
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
// only the tail renders at first (lib/useEarlier.js); earlier messages come in
// chunks without moving what the reader is looking at.

// `subagentCtx` (optional, from ClaudeApp) enables inline sub-agent threads:
// { root, slug, id, depth?, index? }. Without it — or with the
// inlineSubagents preference off — the view renders exactly as before. The
// parent (depth 0) fetches the agent index once; a child transcript rendered
// inline receives the same index one level deeper and shows headers only.
// `compact` is the inline-child styling (tighter padding, smaller title).
function Conversation({ data, subagentCtx = null, compact = false, onFork = null }) {
  const { summary, timeline } = data
  // "fork from here" cuts at turn boundaries, so only the LAST assistant bubble
  // of each turn gets the button — a mid-turn (tool-call) bubble would fork
  // identically and only muddle where the cut lands
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
  const rootRef = useRef(null)
  const { startIdx, visible, showEarlier, topRef, chunk } = useEarlier(timeline, rootRef, { memoKey: summary?.id })

  const { inlineSubagents } = usePrefs()
  const depth = subagentCtx?.depth || 0
  const inlineOn = !!subagentCtx && inlineSubagents
  const wantIndex = inlineOn && depth === 0 && !!summary.hasSubagents
  const index = useSubagentIndex({
    enabled: wantIndex,
    key: wantIndex ? `${subagentCtx.root}|${subagentCtx.slug}|${subagentCtx.id}` : null,
    version: data, // a refetched parent transcript is the cue to re-list its agents
    fetcher: () => api.subagents(subagentCtx.root, subagentCtx.slug, subagentCtx.id),
  })
  const ctx = useMemo(() => {
    if (!inlineOn) return null
    const idx = depth === 0 ? index : subagentCtx.index || null
    return idx ? { ...subagentCtx, index: idx, depth } : null
  }, [inlineOn, subagentCtx, index, depth])
  const threads = useMemo(() => (ctx ? buildThreadMap(timeline, subagentAdapter, ctx) : null), [timeline, ctx])

  return (
    <div ref={rootRef} className={compact ? 'px-3 py-3' : 'mx-auto max-w-3xl px-4 py-6'}>
      <div className={`${compact ? 'mb-3 pb-3' : 'mb-5 pb-4'} border-b border-zinc-700/60`}>
        <h1 className={`${compact ? 'text-[14px]' : 'text-lg'} font-semibold text-zinc-100`}>{summary.title}</h1>
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

      <div className={compact ? 'space-y-4' : 'space-y-6'}>
        <EarlierBar startIdx={startIdx} chunk={chunk} total={timeline.length} onMore={() => showEarlier(false)} onAll={() => showEarlier(true)} topRef={topRef} />
        {visible.map((ev, i) => {
          const k = startIdx + i
          if (ev.kind === 'user') return <UserMsg key={k} ev={ev} />
          if (ev.kind === 'assistant') return <AssistantMsg key={k} ev={ev} threads={threads} ctx={ctx} onFork={onFork && turnEnds.has(k) ? onFork : undefined} />
          if (ev.kind === 'system') return <SystemMsg key={k} ev={ev} />
          if (ev.kind === 'attachment') return <AttachmentMsg key={k} ev={ev} />
          return null
        })}
        {timeline.length === 0 && <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>}
      </div>
    </div>
  )
}

const MemoConversation = memo(Conversation)
export default MemoConversation
