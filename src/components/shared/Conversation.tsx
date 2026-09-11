import type { ConversationData, ConversationEvent } from '../../api/models.ts'
import type { ToolCallPart, TextPart, ThinkingPart, AdvisorPart } from '../../../shared/types.d.ts'
import type { ThreadItem, ThreadContext, ThreadAdapter } from './SubagentThread.tsx'
export type ForkAction = (event: ConversationEvent) => unknown
export interface ConversationProps {
  data: ConversationData
  compact?: boolean
  active?: boolean
  subagentCtx?: ThreadContext | null
  onFork?: ForkAction | null
  onOpenSession?: (id: string) => void
}
export interface MessageProps {
  ev: ConversationEvent
  threads?: Map<string, ThreadItem> | null
  ctx?: ThreadContext | null
  onFork?: ForkAction
}
interface AssistantProps extends MessageProps {
  ToolCall: React.ComponentType<{ part: ToolCallPart }>
  adapter: ThreadAdapter
  Conversation: React.ComponentType<ConversationProps>
  thinkingLabel?: string
  lead?: React.ReactNode
  usage?: React.ReactNode
  flags?: React.ReactNode
  Part: React.ComponentType<{ part: TextPart | ThinkingPart | AdvisorPart }>
}
import Thinking from './Thinking.tsx'
import SubagentThread from './SubagentThread.tsx'
import { BotIcon } from './icons.tsx'
import { fmtTime } from '../../lib/format.ts'
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './conversationLayout.css'
import EarlierBar from './EarlierBar.tsx'
import CopyButton from './CopyButton.tsx'
import { scrollParentOf, useEarlier } from '../../lib/useEarlier.ts'
import ConversationNavigator from './ConversationNavigator.tsx'

export function UserMsg({ ev }: { ev: ConversationEvent }) {
  return (
    <div className="group flex flex-col items-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-ink-500 px-4 py-2.5">
        <div className="md whitespace-pre-wrap break-words text-[15px] leading-7">{ev.text}</div>
      </div>
      <div className="mt-0.5 flex items-center gap-3 pr-1">
        <CopyButton text={ev.text || ''} title="Copy this prompt" />
      </div>
    </div>
  )
}

export function SystemMsg({ ev }: { ev: ConversationEvent }) {
  return (
    <div className="text-center">
      <span className="inline-block text-[11px] text-zinc-500 bg-ink-700/60 border border-zinc-700/60 rounded-full px-3 py-1">
        ⚙ {ev.subtype || 'system'}
        {ev.text ? ` — ${ev.text}` : ''}
      </span>
    </div>
  )
}

// One rendering/pagination owner; provider wrappers supply message details,
// transcript relations and inline-thread adapters without changing the layout.
export default function Conversation({
  data,
  compact = false,
  active = true,
  onFork = null,
  headerExtras,
  headerRelations,
  renderEvent,
}: ConversationProps & {
  headerExtras?: React.ReactNode
  headerRelations?: React.ReactNode
  renderEvent: (event: ConversationEvent, index: number, fork?: ForkAction) => React.ReactNode
}) {
  const { summary, timeline } = data
  // Fork only at the last assistant bubble before the next user turn.
  const turnEnds = useMemo(() => {
    const ends = new Set()
    let last = -1
    timeline.forEach((event: { kind: string }, index: number) => {
      if (event.kind === 'assistant') last = index
      if (event.kind === 'user') {
        if (last >= 0) ends.add(last)
        last = -1
      }
    })
    if (last >= 0) ends.add(last)
    return ends
  }, [timeline])
  const rootRef = useRef<HTMLDivElement>(null)
  const { startIdx, visible, showEarlier, topRef, chunk, reveal } = useEarlier(timeline, rootRef, { memoKey: summary?.id })
  const [jump, setJump] = useState<{ index: number | 'top' | 'bottom' } | null>(null)
  const navigate = (index: number | 'top' | 'bottom') => {
    if (index !== 'bottom') reveal(index === 'top' ? 0 : index)
    setJump({ index })
  }
  useLayoutEffect(() => {
    if (!jump || !active) return
    const root = rootRef.current
    const pane = scrollParentOf(root)
    if (!root || !pane) return
    if (jump.index === 'top') pane.scrollTop = 0
    else if (jump.index === 'bottom') pane.scrollTop = pane.scrollHeight
    else {
      const target = [...root.querySelectorAll<HTMLElement>(`[data-conversation-index="${jump.index}"]`)].find(
        (element) => element.closest('.conversation-content') === root
      )
      if (!target) return
      pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16
      target.tabIndex = -1
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
      target.focus({ preventScroll: true })
    }
    // Update the pane's bottom-follow intent before a ResizeObserver fires.
    pane.dispatchEvent(new Event('scroll'))
    setJump(null)
  }, [jump, active])
  return (
    <div ref={rootRef} className={`conversation-content ${compact ? 'px-3 py-3' : 'mx-auto max-w-3xl px-4 py-6'}`}>
      {active && !compact && <ConversationNavigator timeline={timeline} onJump={navigate} />}
      <div className={`${compact ? 'mb-3 pb-3' : 'mb-5 pb-4'} border-b border-zinc-700/60`}>
        <h1 className={`${compact ? 'text-[14px]' : 'text-lg'} font-semibold text-zinc-100`}>{summary.title}</h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-500">
          <span>{summary.userTurns} prompts</span>
          <span>{summary.assistantTurns} replies</span>
          <span>{summary.toolCalls} tool calls</span>
          {summary.models?.map((model) => (
            <span key={model} className="font-mono">
              {model}
            </span>
          ))}
          {headerExtras}
        </div>
        {headerRelations}
      </div>
      <div className={compact ? 'space-y-4' : 'space-y-6'}>
        <EarlierBar
          startIdx={startIdx}
          chunk={chunk}
          total={timeline.length}
          onMore={() => showEarlier(false)}
          onAll={() => showEarlier(true)}
          topRef={topRef}
        />
        {visible.map((event, index) => {
          const row = renderEvent(event, startIdx + index, onFork && turnEnds.has(startIdx + index) ? onFork : undefined)
          if (row == null || typeof row === 'boolean') return null
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Transcript ordinals are stable as events append and earlier chunks are revealed.
              key={startIdx + index}
              data-conversation-index={startIdx + index}
              className="outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 rounded"
            >
              {row}
            </div>
          )
        })}
        {timeline.length === 0 && <div className="text-center text-zinc-600 py-10">No renderable events in this session.</div>}
      </div>
    </div>
  )
}

// Copy replies without thinking or tool calls, preserving the existing text.
const assistantText = (event: ConversationEvent) =>
  (event.parts || [])
    .filter((part: { kind: string }) => part.kind === 'text')
    .map((part) => ('text' in part ? part.text : ''))
    .join('\n\n')

export function AssistantMessage({
  ev,
  threads,
  ctx,
  onFork,
  ToolCall,
  adapter,
  Conversation: ChildConversation,
  thinkingLabel,
  lead,
  usage,
  flags,
  Part,
}: AssistantProps) {
  return (
    <div className="group flex gap-3">
      <div className="mt-1 shrink-0 w-7 h-7 rounded-full bg-ink-600 border border-zinc-600 flex items-center justify-center text-zinc-300">
        <BotIcon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        {lead}
        {(ev.parts || []).map((p, i) => {
          // biome-ignore lint/suspicious/noArrayIndexKey: Transcript parts append in immutable source order; streaming text has no separate identity.
          if (p.kind === 'thinking') return <Thinking key={i} text={p.text} label={thinkingLabel} />
          if (p.kind === 'tool_call') {
            const thread = threads ? threads.get(p.id || '') : null
            // biome-ignore lint/suspicious/noArrayIndexKey: Parts retain their immutable ordinal as a live reply grows.
            if (!thread || !ctx) return <ToolCall key={i} part={p} />
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: Parts retain their immutable ordinal as a live reply grows.
              <Fragment key={i}>
                <ToolCall part={p} />
                <SubagentThread item={thread} adapter={adapter} ctx={ctx} Conversation={ChildConversation} />
              </Fragment>
            )
          }
          // biome-ignore lint/suspicious/noArrayIndexKey: Parts retain their immutable ordinal as a live reply grows.
          return <Part key={i} part={p} />
        })}
        <div className="conversation-message-meta mt-1 flex items-center gap-3 text-[11px] text-zinc-600">
          {ev.model && <span className="font-mono">{ev.model}</span>}
          {usage}
          {ev.ts && <span>{fmtTime(ev.ts)}</span>}
          {flags}
          {(ev.parts || []).some((p: { kind: string }) => p.kind === 'text') && <CopyButton text={() => assistantText(ev)} title="Copy this reply" />}
          {onFork && (
            <button
              type="button"
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
