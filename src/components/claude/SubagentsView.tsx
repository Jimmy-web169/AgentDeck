import type { AgentSummary, SubagentRun, ConversationData, SubagentsProps } from '../../api/models.ts'
type OpenAgent = (agent: AgentSummary, runId: string | null) => void
interface Selection {
  root?: string
  slug?: string | null
  parentId?: string
  agent: AgentSummary
  runId: string | null
}
interface Transcript {
  agent: AgentSummary
  data?: ConversationData
  loading: boolean
  error?: string
}
import { useEffect, useState } from 'react'
import { useSubagent } from '../../api/index.ts'
import useEscToClose from '../../lib/useEscToClose.ts'
import Conversation from './Conversation.tsx'
import { fmtTokens } from '../../lib/format.ts'

const STATUS: Record<string, { dot: string; label: string; text: string }> = {
  done: { dot: 'bg-emerald-400', label: 'done', text: 'text-emerald-300' },
  running: { dot: 'bg-amber-400 animate-pulse', label: 'running', text: 'text-amber-300' },
  starting: { dot: 'bg-sky-400 animate-pulse', label: 'starting', text: 'text-sky-300' },
  stalled: { dot: 'bg-zinc-600', label: 'stalled', text: 'text-zinc-500' },
  unknown: { dot: 'bg-zinc-500', label: '?', text: 'text-zinc-400' },
}
const RUN_BADGE: Record<string, string> = {
  done: 'bg-emerald-500/15 text-emerald-300',
  running: 'bg-amber-500/15 text-amber-300',
  idle: 'bg-zinc-500/15 text-zinc-400',
}

function fmtDur(ms: number) {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function AgentRow({ a, onOpen, badge }: { a: AgentSummary; onOpen: (agent: AgentSummary) => void; badge?: string }) {
  const s = STATUS[a.status || 'unknown'] || STATUS.unknown
  const elapsed = a.firstTs && a.lastTs ? Math.round((new Date(a.lastTs).getTime() - new Date(a.firstTs).getTime()) / 1000) : null
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className="w-full text-left px-3 py-2 hover:bg-ink-700/50 flex items-center gap-2.5 border-b border-zinc-800/50 group"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
      {badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 shrink-0">{badge}</span>}
      <span className="text-[12.5px] text-zinc-200 truncate flex-1 group-hover:text-white">
        {a.description || a.label || <span className="text-zinc-600 italic">agent {a.id.slice(0, 8)}</span>}
      </span>
      {a.model && <span className="text-[10px] text-zinc-600 font-mono hidden sm:inline">{a.model.replace('claude-', '')}</span>}
      <span className="text-[10px] text-zinc-500 font-mono">↓{fmtTokens(a.tokens?.output)}</span>
      {elapsed != null && <span className="text-[10px] text-zinc-600 w-12 text-right">{elapsed}s</span>}
      <span className={`text-[10px] ${s.text} w-14 text-right`}>{s.label}</span>
      <span className="text-[10px] text-sky-400 opacity-0 group-hover:opacity-100 w-12 text-right">view →</span>
    </button>
  )
}

function Run({ run, onOpenAgent }: { run: SubagentRun; onOpenAgent: OpenAgent }) {
  const hasPhases = run.phases?.length > 0
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [grouped, setGrouped] = useState(hasPhases)
  const counts = run.agents.reduce(
    (m, a) => {
      m[a.status || 'unknown'] = (m[a.status || 'unknown'] || 0) + 1
      return m
    },
    {} as Record<string, number>
  )
  const auth = run.authoritative
  const agentCountDisp = auth?.agentCount ?? run.agentCount
  const tokensDisp = auth?.subagentTokens ?? run.totals.output
  const durMs = auth?.durationMs ?? run.elapsedMs
  const pct = run.runStatus === 'done' ? 100 : Math.round(((counts.done || 0) / Math.max(1, run.agentCount)) * 100)

  const match = (a: AgentSummary) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    if (q && !(a.label || a.description || '').toLowerCase().includes(q.toLowerCase()) && !a.id.includes(q)) return false
    return true
  }
  const agents = run.agents.filter(match)
  const open = (a: AgentSummary) => onOpenAgent(a, run.runId)

  return (
    <div className="rounded-lg border border-zinc-800 bg-ink-900/40 mb-5">
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-rose-300 font-semibold">{run.name || run.runId}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${RUN_BADGE[run.runStatus || 'idle'] || RUN_BADGE.idle}`}
            title={run.runStatus === 'idle' ? 'no recent writes; some agents have no result (stalled/retried)' : ''}
          >
            {run.runStatus}
          </span>
          <span className="text-[11px] text-zinc-600 font-mono">{run.runId}</span>
        </div>
        {run.description && <div className="text-[12px] text-zinc-500 mt-1">{run.description}</div>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-zinc-500">
          <span className="text-zinc-300">
            {agentCountDisp} agents{auth ? ' (authoritative)' : ''}
          </span>
          <span>
            {counts.done || 0} done{counts.running ? ` · ${counts.running} running` : ''}
            {counts.stalled ? ` · ${counts.stalled} stalled` : ''}
          </span>
          <span>
            Σ {fmtTokens(tokensDisp)} {auth ? 'subagent tokens' : '↓ output'}
          </span>
          {durMs > 0 && <span>{fmtDur(durMs)}</span>}
        </div>
        <div className="mt-2 h-1.5 bg-ink-900 rounded overflow-hidden">
          <div className={`h-full ${run.runStatus === 'done' ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[10px] text-zinc-600 mt-2">Click any agent to open its full transcript — prompt, tool calls, step-by-step process.</div>
      </div>

      <div className="flex items-center gap-2 p-2 border-b border-zinc-800/60">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter agents…"
          className="flex-1 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 placeholder-zinc-600"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-ink-700 border border-zinc-700 rounded px-2 text-[12px] text-zinc-300"
        >
          <option value="all">all ({run.agents.length})</option>
          <option value="done">done</option>
          <option value="running">running</option>
          <option value="stalled">stalled</option>
        </select>
        {hasPhases && (
          <button
            type="button"
            onClick={() => setGrouped(!grouped)}
            className="text-[11px] px-2 py-1 rounded bg-ink-700 text-zinc-300 hover:text-white"
            title="toggle phase grouping"
          >
            {grouped ? 'by phase' : 'flat'}
          </button>
        )}
      </div>

      {grouped && hasPhases && (
        <div className="px-3 py-1.5 text-[10px] text-zinc-600 border-b border-zinc-800/60">
          ⓘ phase → agent grouping is <span className="text-amber-400/80">inferred</span> from each agent's prompt (not stored on disk); may misplace agents in
          unusual workflows.
        </div>
      )}

      <div className="max-h-[60vh] overflow-y-auto">
        {grouped && hasPhases ? (
          <>
            {run.phases.map((p, i) => {
              const inPhase = agents.filter((a) => a.phase === i)
              if (inPhase.length === 0) return null
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: Phase ordinals are the workflow linkage identity used by each agent; labels may repeat.
                <div key={i}>
                  <div className="sticky top-0 bg-ink-800/95 px-3 py-1 text-[11px] text-zinc-400 border-b border-zinc-800 backdrop-blur">
                    <span className="text-zinc-200 font-medium">
                      {i + 1}. {p.title}
                    </span>
                    <span className="text-zinc-600"> · {inPhase.length} agents</span>
                    <span className="text-zinc-700"> · inferred</span>
                  </div>
                  {inPhase.map((a) => (
                    <AgentRow key={a.id} a={a} onOpen={open} />
                  ))}
                </div>
              )
            })}
            {(() => {
              const ung = agents.filter((a) => a.phase == null)
              if (ung.length === 0) return null
              return (
                <div>
                  <div className="sticky top-0 bg-ink-800/95 px-3 py-1 text-[11px] text-zinc-500 border-b border-zinc-800 backdrop-blur">
                    Ungrouped · {ung.length} agents
                  </div>
                  {ung.map((a) => (
                    <AgentRow key={a.id} a={a} onOpen={open} />
                  ))}
                </div>
              )
            })()}
          </>
        ) : (
          agents.map((a) => <AgentRow key={a.id} a={a} onOpen={open} />)
        )}
        {agents.length === 0 && <div className="px-3 py-4 text-[12px] text-zinc-600">No agents match.</div>}
      </div>
    </div>
  )
}

function PlainAgents({ agents, onOpenAgent }: { agents: AgentSummary[]; onOpenAgent: OpenAgent }) {
  if (!agents?.length) return null
  return (
    <div className="rounded-lg border border-zinc-800 bg-ink-900/40 mb-5">
      <div className="p-3 border-b border-zinc-800">
        <span className="text-violet-300 font-semibold">Task / Agent sub-agents</span>
        <span className="text-[11px] text-zinc-600 ml-2">{agents.length} · spawned directly (not via a workflow)</span>
        <div className="text-[10px] text-zinc-600 mt-1">Click to open the agent's full transcript.</div>
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        {agents.map((a) => (
          <AgentRow key={a.id} a={a} onOpen={() => onOpenAgent(a, null)} badge={a.agentType || 'agent'} />
        ))}
      </div>
    </div>
  )
}

function TranscriptModal({ tx, onClose }: { tx: Transcript; onClose: () => void }) {
  useEscToClose(onClose)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Backdrop dismissal supplements the dialog Close button and Escape handler; the backdrop itself is not a keyboard control.
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
        else e.stopPropagation()
      }}
    >
      <div className="w-[860px] max-w-[95vw] h-[88vh] bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <div className="text-[13px] text-zinc-100 font-medium truncate">{tx.agent.description || tx.agent.label || `agent ${tx.agent.id.slice(0, 8)}`}</div>
            <div className="text-[11px] text-zinc-500 font-mono truncate">
              {tx.agent.agentType ? `${tx.agent.agentType} · ` : ''}agent {tx.agent.id}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200 text-xl leading-none shrink-0 ml-3">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tx.loading && <div className="p-8 text-center text-zinc-600">Loading transcript…</div>}
          {tx.error && <div className="p-8 text-center text-red-300">{tx.error}</div>}
          {tx.data && <Conversation data={tx.data} />}
        </div>
      </div>
    </div>
  )
}

export default function SubagentsView({ data, active = true }: SubagentsProps) {
  const [selected, setSelected] = useState<Selection | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A child selection belongs to one exact account and parent session.
  useEffect(() => setSelected(null), [data?.root, data?.slug, data?.id])
  const current = selected?.root === data?.root && selected?.slug === data?.slug && selected?.parentId === data?.id ? selected : null
  const transcript = useSubagent(
    { provider: 'claude', root: data?.root || '', slug: data?.slug, id: data?.id || '', run: current?.runId || undefined, agent: current?.agent.id },
    { enabled: active && !!current }
  )
  const tx = current ? { ...current, data: transcript.data, loading: transcript.isPending, error: transcript.error?.message } : null
  const openAgent: OpenAgent = (agent, runId) => {
    if (data) setSelected({ root: data.root, slug: data.slug, parentId: data.id, agent, runId })
  }

  if (!data) return <div className="p-8 text-zinc-600">Loading sub-agents…</div>
  const runs = data.runs || []
  const plain = data.agents || []

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {runs.length === 0 && plain.length === 0 ? (
        <div className="text-center text-zinc-600 py-10">This session has no workflow runs or sub-agents.</div>
      ) : (
        <>
          {runs.map((r) => (
            <Run key={r.runId} run={r} onOpenAgent={openAgent} />
          ))}
          <PlainAgents agents={plain} onOpenAgent={openAgent} />
        </>
      )}
      {tx && <TranscriptModal tx={tx} onClose={() => setSelected(null)} />}
    </div>
  )
}
