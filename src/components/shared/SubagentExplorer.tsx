import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import type { AgentSummary, SubagentIndex } from '../../api/models.ts'
import type { ConversationProps } from './Conversation.tsx'
import type { ThreadContext } from './SubagentThread.tsx'
import type { QueryRef } from '../../api/queryPolicy.ts'
import { useSubagents, useThreadTranscript } from '../../api/index.ts'
import { queryKeys } from '../../api/queryPolicy.ts'
import { useSessionPane } from '../../lib/useSessionPane.ts'
import { STATUS_DOT } from './SubagentThread.tsx'

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
  const entry = entries.find((item) => item.key === selected) || entries[0]
  return (
    <aside aria-label="Subagent multi-view" className="subagent-explorer flex flex-col min-h-0 min-w-0 bg-ink-800 border-zinc-700/70">
      <div className="px-3 py-2 flex items-center justify-between border-b border-zinc-800 shrink-0">
        <div>
          <div className="text-[12px] font-semibold text-zinc-200">
            Subagents <span className="text-zinc-400 font-normal">· {entries.length}</span>
          </div>
          <div className="text-[10px] text-zinc-400">Watch alongside the main conversation</div>
        </div>
        <button type="button" aria-label="Close multi-view" onClick={onClose} className="px-2 py-1 rounded text-zinc-400 hover:bg-ink-600 hover:text-zinc-100">
          ×
        </button>
      </div>
      <section className="max-h-40 overflow-y-auto border-b border-zinc-800 shrink-0" aria-label="Subagent list">
        {entries.map((item) => {
          const agent = item.agent
          const status = agent.status || 'unknown'
          const label = agent.description || agent.title || agent.label || agent.firstPrompt || agent.id
          return (
            <button
              type="button"
              key={item.key}
              aria-pressed={entry?.key === item.key}
              onClick={() => setSelected(item.key)}
              className={`flex items-center gap-2 w-full text-left px-3 py-2 border-l-2 ${entry?.key === item.key ? 'border-sky-400 bg-ink-600/70' : 'border-transparent hover:bg-ink-700/60'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status] || STATUS_DOT.unknown}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-zinc-200" title={label}>
                  {label}
                </span>
                <span className="block truncate text-[10px] text-zinc-400">
                  {[item.group, agent.agentNickname, agent.agentType || agent.agentRole || agent.type].filter(Boolean).join(' · ') || agent.id}
                </span>
              </span>
              <span className="text-[10px] text-zinc-400 shrink-0">{status}</span>
            </button>
          )
        })}
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
      {entry && <AgentTranscript key={entry.key} entry={entry} ctx={ctx} active={active} Conversation={Conversation} />}
    </aside>
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
