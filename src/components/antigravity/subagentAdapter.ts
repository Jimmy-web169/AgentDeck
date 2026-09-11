import type { ToolCallPart } from '../../../shared/types.d.ts'
import type { ThreadContext, ThreadItem, ThreadAdapter } from '../shared/SubagentThread.tsx'
// Antigravity adapter for the inline sub-agent thread (shared/SubagentThread.jsx).
//
// A parent's `invoke_subagent` tool call has no id in the JSONL; its GENERIC
// result (paired by adjacency in server/providers/antigravity/parser.ts) is a
// JSON blob carrying the child's conversation id:
//   { "conversationId": "<child>", "logAbsoluteUri": …, "workspaceUris": [...] }
// so the primary rule is result.conversationId === child.id. The fallback for
// a result that was cut short is the earliest unclaimed child whose first
// timestamp lies within [call ts − 2s, call ts + 120s].
//
// A child is a full conversation, so its transcript comes from GET /api/session.

export const accent = {
  border: 'border-violet-500/30',
  rail: 'border-violet-400/60',
  badge: 'bg-violet-500/15 text-violet-300',
  text: 'text-violet-300',
}

const ms = (ts: string | number | Date | null | undefined) => (ts ? new Date(ts).getTime() : NaN)
const UUID = /"conversationId"\s*:\s*"([0-9a-f-]{36})"/i

function childIdOf(part: ToolCallPart) {
  const c = part.result?.content
  if (typeof c !== 'string') return null
  const m = c.match(UUID)
  return m ? m[1] : null
}

export function resolve(part: ToolCallPart, ctx: ThreadContext): ThreadItem | null {
  if (part?.name !== 'invoke_subagent' || !part.id) return null
  const children = ctx?.children || []
  if (!children.length) return null
  const free = children.filter((c) => !ctx.claimed?.has(c.id))

  let c = null
  const id = childIdOf(part)
  if (id) c = free.find((x: { id: string }) => x.id === id) || null
  if (!c && ctx.ev?.ts) {
    const t = ms(ctx.ev.ts)
    if (Number.isFinite(t)) {
      const cands = free.filter((x) => {
        const s = ms(x.firstTs)
        return s >= t - 2000 && s <= t + 120000
      })
      if (cands.length) c = cands.sort((a, b) => ms(a.firstTs) - ms(b.firstTs))[0]
    }
  }
  if (!c) return null
  ctx.claimed?.add(c.id)

  const input = (part.input && typeof part.input === 'object' ? part.input : {}) as Record<string, unknown>
  const title = c.title || c.label || (typeof input.prompt === 'string' ? input.prompt.slice(0, 80) : '') || ''
  return {
    key: c.id,
    childId: c.id,
    label: title || `subagent ${c.id.slice(0, 8)}`,
    type: c.type || 'subagent',
    status: c.status === 'running' ? 'running' : 'done',
    elapsedMs: c.firstTs && c.lastTs ? Math.max(0, ms(c.lastTs) - ms(c.firstTs)) : 0,
    toolCalls: c.toolCalls ?? null,
    tokens: c.tokens || null,
    expandable: true,
  }
}

export function transcriptTarget(item: ThreadItem, ctx: ThreadContext): ReturnType<ThreadAdapter['transcriptTarget']> {
  return { kind: 'session', ref: { provider: 'antigravity', root: ctx.root, id: item.childId } }
}
export default { accent, resolve, transcriptTarget }
