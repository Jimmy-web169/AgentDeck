import type { ToolCallPart } from '../../../shared/types.d.ts'
import type { ThreadContext, ThreadItem, ThreadAdapter } from '../shared/SubagentThread.tsx'
// Claude adapter for the inline sub-agent thread (shared/SubagentThread.jsx).
//
// How a parent transcript's tool call is linked to a sub-agent on disk:
//
// Agent / Task tool calls → projects/<slug>/<session>/subagents/agent-<id>.jsonl
//   Claude Code writes agent-<id>.meta.json next to that transcript:
//     { agentType, description, toolUseId, spawnDepth }
//   and `toolUseId` IS the parent's tool_use block id (checked against
//   ~/.claude: the sidecar's "toolu_014Mf9…" equals the Agent tool_use id in
//   the parent .jsonl, whose tool_result carries the agent's final text). The
//   server surfaces it as agent.toolUseId (server/providers/claude/runs.ts), so
//   the primary rule is an exact id match. Fallback for agents written before
//   the sidecar carried toolUseId: an unclaimed agent whose description (and,
//   when both are present, agentType) equals the call's input — used only when
//   exactly one candidate matches. Anything else stays unlinked and the
//   conversation renders nothing extra for that call.
//
// Workflow tool calls → subagents/workflows/wf_<runId>/ (one run, many agents)
//   The Workflow launch result prints the run id, so a run whose runId appears
//   in the tool result text is linked — the same pairing runs.js
//   findRunCompletion relies on. A run has no single transcript: it renders as
//   a header-only block whose "Open in Sub-agents" shows the run.

export const accent = {
  border: 'border-emerald-500/30',
  rail: 'border-emerald-400/60',
  badge: 'bg-emerald-500/15 text-emerald-300',
  text: 'text-emerald-300',
}

const SPAWN_TOOLS = new Set(['Agent', 'Task'])

const elapsedOf = (a: import('../../api/models.ts').AgentSummary) =>
  a.firstTs && a.lastTs ? Math.max(0, new Date(a.lastTs).getTime() - new Date(a.firstTs).getTime()) : 0

export function resolve(part: ToolCallPart, ctx: ThreadContext): ThreadItem | null {
  const index = ctx?.index
  if (!index || !part?.id) return null

  if (SPAWN_TOOLS.has(part.name)) {
    const agents = index.agents || []
    const input = (part.input && typeof part.input === 'object' ? part.input : {}) as Record<string, unknown>
    let a = agents.find((x) => x.toolUseId === part.id) || null
    if (!a) {
      const desc = typeof input.description === 'string' ? input.description.trim() : ''
      if (desc) {
        const cands = agents.filter(
          (x) =>
            !x.toolUseId &&
            !ctx.claimed?.has(x.id) &&
            (x.description || '').trim() === desc &&
            (!x.agentType || !(typeof input.subagent_type === 'string' ? input.subagent_type : '') || x.agentType === input.subagent_type)
        )
        if (cands.length === 1) a = cands[0]
      }
    }
    if (!a) return null
    ctx.claimed?.add(a.id)
    return {
      key: a.id,
      agentId: a.id,
      runId: null,
      label: a.description || a.label || (typeof input.description === 'string' ? input.description : '') || `agent ${a.id.slice(0, 8)}`,
      type: a.agentType || (typeof input.subagent_type === 'string' ? input.subagent_type : '') || 'agent',
      status: a.status || 'unknown',
      elapsedMs: elapsedOf(a),
      toolCalls: a.toolCalls ?? null,
      tokens: a.tokens || null,
      expandable: !a.oversized,
      note: a.oversized ? 'transcript too large' : null,
    }
  }

  if (part.name === 'Workflow') {
    const text = typeof part.result?.content === 'string' ? part.result.content : ''
    if (!text) return null
    const run = (index.runs || []).find((r) => r.runId && !ctx.claimed?.has(r.runId) && text.includes(r.runId))
    if (!run) return null
    ctx.claimed?.add(run.runId)
    const auth = run.authoritative
    return {
      key: run.runId,
      agentId: null,
      runId: run.runId,
      label: run.name || run.description || run.runId,
      type: 'workflow',
      status: run.runStatus === 'idle' ? 'stalled' : run.runStatus || 'unknown',
      elapsedMs: auth?.durationMs ?? run.elapsedMs,
      agentCount: auth?.agentCount ?? run.agentCount,
      toolCalls: auth?.toolUses ?? null,
      tokens: run.totals || null,
      expandable: false,
    }
  }
  return null
}

export function transcriptTarget(item: ThreadItem, ctx: ThreadContext): ReturnType<ThreadAdapter['transcriptTarget']> {
  return {
    kind: 'subagent',
    ref: { provider: 'claude', root: ctx.root, slug: ctx.slug, id: ctx.id, run: item.runId || undefined, agent: item.agentId || undefined },
  }
}
export default { accent, resolve, transcriptTarget }
