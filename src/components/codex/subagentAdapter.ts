import type { ToolCallPart } from '../../../shared/types.d.ts'
import type { ThreadContext, ThreadItem, ThreadAdapter } from '../shared/SubagentThread.tsx'
// Codex adapter for the inline sub-agent thread (shared/SubagentThread.jsx).
//
// How a parent's spawn_agent call is linked to the child rollout:
//
// The parent's `spawn_agent` function_call takes { task_name, message } and its
// function_call_output is `{"task_name":"/root/<task_name>"}` — the agent PATH,
// not the bare name. The child rollout's first line (session_meta) carries
//   source.subagent.thread_spawn = { parent_thread_id, depth, agent_path, agent_nickname, agent_role }
// and agent_path equals that output value (checked in ~/.codex/sessions: the
// parent's output "/root/inspect_chrome_form" is the child's agent_path). The
// server exposes it as child.agentPath (server/providers/codex/paths.ts
// readHead → childrenOf), so the primary rule is output.task_name ===
// child.agentPath. Fallbacks, in order, for rollouts predating agent_path:
//   1. the call's input task_name equals the last segment of exactly one
//      unclaimed child's agentPath;
//   2. the earliest unclaimed child whose startTs lies within
//      [call ts − 2s, call ts + 120s] (a child rollout is created when the call
//      runs, so its first line is stamped moments after the call).
// No match → null, and the conversation renders nothing extra for that call.
//
// A child is a full session, so its transcript comes from GET /api/session.

export const accent = {
  border: 'border-sky-500/30',
  rail: 'border-sky-400/60',
  badge: 'bg-sky-500/15 text-sky-300',
  text: 'text-sky-300',
}

// mirrors the server-side "recently written" heuristic for running agents
const RECENT_MS = 60000

function outputPath(part: ToolCallPart) {
  const c = part.result?.content
  if (typeof c !== 'string' || !c.trimStart().startsWith('{')) return null
  try {
    const o = JSON.parse(c)
    return typeof o?.task_name === 'string' ? o.task_name : null
  } catch {
    return null
  }
}
const lastSeg = (p: string | null | undefined) => (typeof p === 'string' ? p.split('/').filter(Boolean).pop() || null : null)
const ms = (ts: string | number | Date | null | undefined) => (ts ? new Date(ts).getTime() : NaN)

export function resolve(part: ToolCallPart, ctx: ThreadContext): ThreadItem | null {
  if (part?.name !== 'spawn_agent' || !part.id) return null
  const children = ctx?.children || []
  if (!children.length) return null
  const free = children.filter((c) => !ctx.claimed?.has(c.id))
  const input = (part.input && typeof part.input === 'object' ? part.input : {}) as Record<string, unknown>

  let c = null
  const outPath = outputPath(part)
  if (outPath) c = free.find((x) => x.agentPath === outPath) || null
  if (!c && typeof input.task_name === 'string' && input.task_name) {
    const cands = free.filter((x) => lastSeg(x.agentPath) === input.task_name)
    if (cands.length === 1) c = cands[0]
  }
  if (!c && ctx.ev?.ts) {
    const t = ms(ctx.ev.ts)
    if (Number.isFinite(t)) {
      const cands = free.filter((x) => {
        const s = ms(x.startTs)
        return s >= t - 2000 && s <= t + 120000
      })
      if (cands.length) c = cands.sort((a, b) => ms(a.startTs) - ms(b.startTs))[0]
    }
  }
  if (!c) return null
  ctx.claimed?.add(c.id)

  const role = c.agentRole || lastSeg(c.agentPath) || (typeof input.task_name === 'string' ? input.task_name : '') || 'agent'
  const title = c.title || c.firstPrompt || ''
  return {
    key: c.id,
    childId: c.id,
    label: `${c.agentNickname ? `${c.agentNickname} · ` : ''}${title || role}`,
    type: role,
    status: c.mtimeMs && Date.now() - c.mtimeMs < RECENT_MS ? 'running' : 'done',
    elapsedMs: c.firstTs && c.lastTs ? Math.max(0, ms(c.lastTs) - ms(c.firstTs)) : 0,
    toolCalls: c.toolCalls ?? null,
    tokens: c.tokens || null,
    expandable: true,
  }
}

export function transcriptTarget(item: ThreadItem, ctx: ThreadContext): ReturnType<ThreadAdapter['transcriptTarget']> {
  return { kind: 'session', ref: { provider: ctx.provider || 'codex', root: ctx.root, id: item.childId } }
}
export default { accent, resolve, transcriptTarget }
