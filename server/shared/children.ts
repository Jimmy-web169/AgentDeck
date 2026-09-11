// One shape for "the sub-agents of a session", whatever the provider stores on
// disk: Claude nests agent-*.jsonl sidecars under the session (and groups some
// under workflow runs), Codex spawns whole child rollouts, Antigravity spawns
// whole child conversations. GET /api/subagents returns `children[]` in this
// shape for every provider (plus optional `groups[]` for Claude's workflow
// runs); the provider-specific lists (`runs[]`, `agents[]`) stay on the payload
// so nothing the UI shows today changes.
//
//   { id, parentId, kind: 'agent' | 'session', label, type, status,
//     firstTs, lastTs, toolCalls, tokens, model, depth, group, oversized, ...provider extras }
//
//   status: 'done' | 'running' | 'stalled' | 'unknown'
//   group:  a workflow run id (Claude) or null
interface ChildInput {
  id: string
  parentId?: string | null
  kind?: string
  label?: string | null
  type?: string | null
  status?: string | null
  firstTs?: string | number | null
  lastTs?: string | number | null
  toolCalls?: number | null
  tokens?: Record<string, number> | null
  model?: string | null
  depth?: number | null
  group?: string | null
  oversized?: boolean
  extra?: Record<string, unknown>
}
export function child(x: ChildInput) {
  return {
    id: x.id,
    parentId: x.parentId ?? null,
    kind: x.kind === 'session' ? 'session' : 'agent',
    label: x.label || x.id,
    type: x.type ?? null,
    status: x.status || 'unknown',
    firstTs: x.firstTs ?? null,
    lastTs: x.lastTs ?? null,
    toolCalls: typeof x.toolCalls === 'number' ? x.toolCalls : null,
    tokens: x.tokens ?? null,
    model: x.model ?? null,
    depth: x.depth ?? null,
    group: x.group ?? null,
    oversized: !!x.oversized,
    ...x.extra,
  }
}

export const CHILD_FIELDS = [
  'id',
  'parentId',
  'kind',
  'label',
  'type',
  'status',
  'firstTs',
  'lastTs',
  'toolCalls',
  'tokens',
  'model',
  'depth',
  'group',
  'oversized',
]
