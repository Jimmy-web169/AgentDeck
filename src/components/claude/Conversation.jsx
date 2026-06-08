import Markdown from '../shared/Markdown.jsx'
import ToolCall from './ToolCall.jsx'
import Thinking from '../shared/Thinking.jsx'
import AskQuestionForm from './AskQuestionForm.jsx'
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

// ---- live (in-flight) turn, streamed in via the /chat WebSocket ----
function LiveItem({ it, onPerm }) {
  if (it.role === 'user') return <UserMsg ev={{ text: it.text }} />
  if (it.role === 'assistant') {
    return (
      <div className="flex gap-3">
        <div className="mt-1 shrink-0 w-7 h-7 rounded-full bg-ink-600 border border-emerald-600/50 flex items-center justify-center text-emerald-300">
          <BotIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          {it.thinking && <Thinking text={it.thinking} />}
          {it.text ? <Markdown>{it.text}</Markdown> : <span className="text-zinc-600 text-sm">▍</span>}
        </div>
      </div>
    )
  }
  if (it.role === 'tool') {
    return (
      <div className="ml-10 min-w-0 max-w-full overflow-hidden rounded-lg border border-zinc-700/70 bg-ink-700/50 px-3 py-1.5 text-[12px]">
        <div className="flex gap-2 min-w-0">
          <span className="text-emerald-300 font-mono shrink-0">{it.name}</span>
          <span className="text-zinc-500 font-mono min-w-0 break-all line-clamp-2">{JSON.stringify(it.input).slice(0, 200)}</span>
        </div>
        {it.result != null && <pre className="mt-1 text-[11px] text-zinc-400 whitespace-pre-wrap break-all max-h-40 overflow-auto">{String(it.result).slice(0, 1000)}</pre>}
      </div>
    )
  }
  if (it.role === 'perm' && it.toolName === 'AskUserQuestion' && it.input?.questions) {
    // Claude is asking the user — render the options to pick, not an allow/deny gate
    return (
      <AskQuestionForm
        questions={it.input.questions}
        decided={it.decided}
        onSubmit={(answers) => onPerm(it.reqId, 'allow', undefined, answers)}
        onSkip={() => onPerm(it.reqId, 'deny')}
      />
    )
  }
  if (it.role === 'perm') {
    const summary = it.input?.command || it.input?.file_path || it.input?.path || JSON.stringify(it.input || {}).slice(0, 400)
    return (
      <div className="ml-10 min-w-0 max-w-full overflow-hidden rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-[13px]">
        <div className="text-amber-200">Claude wants to use <span className="font-mono">{it.toolName}</span></div>
        <pre className="text-[12px] text-zinc-300 whitespace-pre-wrap break-all max-h-32 overflow-auto mt-1 font-mono">{summary}</pre>
        {it.decided ? (
          <div className={`mt-1.5 text-[12px] ${it.decided === 'allow' ? 'text-emerald-300' : 'text-red-300'}`}>{it.decided === 'allow' ? '✓ allowed' : '✕ denied'}</div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5 max-w-md">
            <button onClick={() => onPerm(it.reqId, 'allow', 'once')} className="text-left text-[12px] px-2.5 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30">1 · Yes (allow once)</button>
            <button onClick={() => onPerm(it.reqId, 'allow', 'always')} className="text-left text-[12px] px-2.5 py-1.5 rounded bg-emerald-500/10 text-emerald-200/90 hover:bg-emerald-500/20">2 · Yes, allow all <span className="font-mono">{it.toolName}</span> this session</button>
            <button onClick={() => onPerm(it.reqId, 'deny')} className="text-left text-[12px] px-2.5 py-1.5 rounded bg-red-500/15 text-red-200 hover:bg-red-500/25">3 · No (deny)</button>
          </div>
        )}
      </div>
    )
  }
  return null
}

export default function Conversation({ data, live }) {
  const { summary, timeline } = data
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
        {timeline.map((ev, i) => {
          if (ev.kind === 'user') return <UserMsg key={i} ev={ev} />
          if (ev.kind === 'assistant') return <AssistantMsg key={i} ev={ev} />
          if (ev.kind === 'system') return <SystemMsg key={i} ev={ev} />
          if (ev.kind === 'attachment') return <AttachmentMsg key={i} ev={ev} />
          return null
        })}
        {timeline.length === 0 && !(live && live.items.length) && (
          <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>
        )}
        {live && live.items.map((it, i) => <LiveItem key={`live-${i}`} it={it} onPerm={live.onPerm} />)}
      </div>
    </div>
  )
}
