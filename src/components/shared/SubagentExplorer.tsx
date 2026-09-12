import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import type { AgentSummary, SubagentIndex } from '../../api/models.ts'
import type { ConversationProps } from './Conversation.tsx'
import type { ThreadContext } from './SubagentThread.tsx'
import type { QueryRef } from '../../api/queryPolicy.ts'
import { useSubagents, useThreadTranscript } from '../../api/index.ts'
import { queryKeys } from '../../api/queryPolicy.ts'
import { useSessionPane } from '../../lib/useSessionPane.ts'
import { fmtTokens } from '../../lib/format.ts'
import { STATUS_DOT, fmtDur } from './SubagentThread.tsx'

type Entry = { key: string; agent: AgentSummary; group: string; target: { kind: 'session' | 'subagent'; ref: QueryRef } }

// Capability-based normalization includes agents that have no matched tool call.
export function explorerEntries(index: SubagentIndex | undefined, ref: QueryRef, nested: boolean): Entry[] {
  const entry = (agent: AgentSummary, run?: string, group = ''): Entry => {
    const target: Entry['target'] = nested
      ? { kind: 'subagent', ref: { ...ref, run, agent: agent.id } }
      : { kind: 'session', ref: { provider: ref.provider, root: ref.root, id: agent.id } }
    return { key: JSON.stringify(queryKeys[target.kind](target.ref)), agent, group, target }
  }
  return nested
    ? [
        ...(index?.agents || []).map((agent) => entry(agent)),
        ...(index?.runs || []).flatMap((run) => run.agents.map((agent) => entry(agent, run.runId, run.name || run.runId))),
      ]
    : (index?.children || []).map((agent) => entry(agent))
}

const labelOf = (agent: AgentSummary) => agent.description || agent.title || agent.label || agent.firstPrompt || `agent ${agent.id.slice(0, 8)}`
const badgeOf = (agent: AgentSummary) => [agent.agentType || agent.agentRole || agent.type, agent.agentNickname].filter(Boolean).join(' · ')
const elapsedOf = (agent: AgentSummary) => (agent.firstTs && agent.lastTs ? fmtDur(new Date(agent.lastTs).getTime() - new Date(agent.firstTs).getTime()) : '')

// The pane reads like the Sub-agents tab: every agent's status first, and one
// transcript only once a row is chosen. No child is fetched before that.
export default function SubagentExplorer({
  provider,
  ctx,
  nested,
  active,
  Conversation,
  onClose,
}: {
  provider: string
  ctx: ThreadContext
  nested: boolean
  active: boolean
  Conversation: ComponentType<ConversationProps>
  onClose: () => void
}) {
  const ref = useMemo(() => ({ provider, root: ctx.root, id: ctx.id, slug: ctx.slug }), [provider, ctx.root, ctx.id, ctx.slug])
  const index = useSubagents(ref, { enabled: active })
  const entries = useMemo(() => explorerEntries(index.data, ref, nested), [index.data, ref, nested])
  const [selected, setSelected] = useState<string | null>(null)
  // An agent that has left the index returns the pane to the list.
  const entry = selected === null ? undefined : entries.find((item) => item.key === selected)
  const status = entry?.agent.status || 'unknown'
  return (
    <aside aria-label="Sub-agent pane" className="subagent-explorer flex flex-col min-h-0 min-w-0 bg-ink-800">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800 shrink-0">
        {entry ? (
          <>
            <button
              type="button"
              aria-label="Back to subagent list"
              onClick={() => setSelected(null)}
              className="-ml-1.5 px-1.5 py-1 rounded text-[12px] text-sky-400 hover:bg-ink-600 hover:text-sky-300 shrink-0"
            >
              ‹ Subagents
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-zinc-200 truncate" title={labelOf(entry.agent)}>
                {labelOf(entry.agent)}
              </div>
              <div className="text-[10px] text-zinc-400 truncate">
                <span className="text-zinc-300">{status}</span>
                {badgeOf(entry.agent) ? ` · ${badgeOf(entry.agent)}` : ''}
                {' · '}
                <span className="font-mono">{entry.agent.id}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-zinc-200">
              Subagents <span className="text-zinc-400 font-normal">· {entries.length}</span>
            </div>
            <div className="text-[10px] text-zinc-400">Click an agent to read its transcript beside the main conversation</div>
          </div>
        )}
        <button
          type="button"
          aria-label="Close sub-agent pane"
          onClick={onClose}
          className="px-2 py-1 rounded text-zinc-400 hover:bg-ink-600 hover:text-zinc-100 shrink-0"
        >
          ×
        </button>
      </div>
      {entry ? (
        <AgentTranscript key={entry.key} entry={entry} ctx={ctx} active={active} Conversation={Conversation} />
      ) : (
        <AgentList entries={entries} index={index} onOpen={setSelected} />
      )}
    </aside>
  )
}

function AgentList({ entries, index, onOpen }: { entries: Entry[]; index: ReturnType<typeof useSubagents>; onOpen: (key: string) => void }) {
  // Workflow runs keep their own heading, as on the Sub-agents tab; direct
  // agents lead the list and take a heading only when runs follow them.
  const groups = entries.reduce<{ name: string; items: Entry[] }[]>((list, item) => {
    const last = list[list.length - 1]
    if (last && last.name === item.group) last.items.push(item)
    else list.push({ name: item.group, items: [item] })
    return list
  }, [])
  return (
    <section aria-label="Subagent list" className="flex-1 min-h-0 overflow-y-auto">
      {groups.map((group) => (
        <div key={`${group.name}:${group.items[0].key}`}>
          {(group.name || groups.length > 1) && (
            <div className="sticky top-0 bg-ink-800/95 px-3 py-1 text-[11px] text-zinc-400 border-b border-zinc-800 backdrop-blur">
              <span className="text-zinc-200 font-medium">{group.name || 'Direct agents'}</span>
              <span className="text-zinc-500"> · {group.items.length} agents</span>
            </div>
          )}
          {group.items.map((item) => (
            <AgentRow key={item.key} entry={item} onOpen={() => onOpen(item.key)} />
          ))}
        </div>
      ))}
      {index.isPending && <p className="p-3 text-[12px] text-zinc-400">Loading subagents…</p>}
      {index.error && (
        <div className="p-3 text-[12px] text-red-300">
          {index.error.message}{' '}
          <button type="button" className="underline" onClick={() => void index.refetch()}>
            Retry
          </button>
        </div>
      )}
      {index.isSuccess && !entries.length && (
        <p className="p-3 text-[12px] text-zinc-400">No subagents in this session yet. New agents appear here as the session updates.</p>
      )}
    </section>
  )
}

function AgentRow({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const agent = entry.agent
  const status = agent.status || 'unknown'
  const badge = badgeOf(agent)
  const elapsed = elapsedOf(agent)
  const label = labelOf(agent)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left px-3 py-2 hover:bg-ink-700/50 flex items-center gap-2.5 border-b border-zinc-800/50 group"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status] || STATUS_DOT.unknown}`} />
      {badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 shrink-0 font-mono">{badge}</span>}
      <span className="text-[12.5px] text-zinc-200 truncate flex-1 group-hover:text-white" title={label}>
        {label}
      </span>
      {!!agent.tokens?.output && <span className="text-[10px] text-zinc-400 font-mono shrink-0">↓{fmtTokens(agent.tokens.output)}</span>}
      {elapsed && <span className="text-[10px] text-zinc-400 shrink-0">{elapsed}</span>}
      {!elapsed && agent.assistantTurns != null && <span className="text-[10px] text-zinc-400 shrink-0">{agent.assistantTurns} replies</span>}
      {/* The dot carries the status colour; the word stays neutral because no
          amber tone reaches 4.5:1 on the light theme's pane at 10px. */}
      <span className="text-[10px] shrink-0 w-12 text-right text-zinc-300">{status}</span>
      <span className="text-[10px] text-sky-400 opacity-0 group-hover:opacity-100 shrink-0">view →</span>
    </button>
  )
}

function AgentTranscript({
  entry,
  ctx,
  active,
  Conversation,
}: {
  entry: Entry
  ctx: ThreadContext
  active: boolean
  Conversation: ComponentType<ConversationProps>
}) {
  const query = useThreadTranscript(entry.target, { enabled: active && !entry.agent.oversized })
  const { mainRef, onScroll } = useSessionPane({
    provider: entry.target.ref.provider,
    root: ctx.root,
    id: entry.target.ref.agent || entry.target.ref.id || null,
    view: 'conversation',
    active,
    data: query.data,
  })
  const childCtx = useMemo(() => ({ ...ctx, id: entry.target.ref.id || ctx.id, depth: 1, active }), [ctx, entry.target.ref.id, active])
  return (
    <section ref={mainRef} onScroll={onScroll} aria-label="Subagent transcript" className="flex-1 min-h-0 overflow-y-auto">
      {entry.agent.oversized ? (
        <p className="p-4 text-[12px] text-zinc-400">This transcript exceeds the parse limit, so it cannot be displayed.</p>
      ) : query.data ? (
        <Conversation data={query.data} active={active} subagentCtx={childCtx} />
      ) : query.isPending ? (
        <p className="p-4 text-[12px] text-zinc-400">Loading transcript…</p>
      ) : null}
      {query.error && (
        <div className="p-4 text-[12px] text-red-300">
          {query.error.message}{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      )}
    </section>
  )
}
