import fs from 'node:fs'
import { jsonRecord, jsonArray, optionalTimestamp, numberOrZero } from '../../shared/json.ts'
interface Phase {
  title?: string
  [field: string]: unknown
}
interface ScriptMeta {
  name: unknown
  description: unknown
  phases: Phase[]
}
interface AgentSummary {
  id: string
  label: string | null
  model: string | null
  tokens: { input: number; output: number; cacheCreate: number; cacheRead: number }
  firstTs: string | number | null
  lastTs: string | number | null
  mtime: number
  activity: string | null
  toolCalls?: number
  endTurn?: boolean
  oversized?: boolean
  agentType?: unknown
  description?: unknown
  toolUseId?: string | null
  spawnDepth?: number | null
  status?: string
  hasResult?: boolean
  phase?: number | null
}
import path from 'node:path'
import { readRecords } from './parser.ts'
import { withOversizeFallback } from '../../shared/transcriptGuard.ts'
import { projectsDir, assertInside, listProjectSlugs } from './paths.ts'

// Parse `export const meta = { ... }` from a workflow script. meta is a pure
// JS literal (unquoted keys), so brace-match it and eval the object only.
export function parseScriptMeta(text: string): ScriptMeta | null {
  const i = text.indexOf('meta')
  if (i < 0) return null
  const braceStart = text.indexOf('{', i)
  if (braceStart < 0) return null
  let depth = 0
  let end = -1
  let inStr = null
  for (let j = braceStart; j < text.length; j++) {
    const c = text[j]
    if (inStr) {
      if (c === inStr && text[j - 1] !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') inStr = c
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = j
        break
      }
    }
  }
  if (end < 0) return null
  try {
    // eslint-disable-next-line no-new-func
    const value: unknown = Function('"use strict"; return (' + text.slice(braceStart, end + 1) + ')')()
    const obj = jsonRecord(value)
    return {
      name: obj.name,
      description: obj.description,
      phases: jsonArray(obj.phases).map((phase) => {
        const item = jsonRecord(phase)
        return { ...item, ...(typeof item.title === 'string' ? { title: item.title } : {}) }
      }),
    }
  } catch {
    return null
  }
}

function firstLabel(records: unknown[]) {
  for (const value of records) {
    const r = jsonRecord(value)
    const c = jsonRecord(r.message).content
    const blocks = Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : []
    for (const value of blocks) {
      const b = jsonRecord(value)
      const t = b?.type === 'text' ? b.text : b?.type === 'thinking' ? b.thinking : ''
      if (typeof t === 'string' && t.trim()) {
        return t
          .replace(/^#+\s*/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 90)
      }
    }
  }
  return null
}

function lastActivity(records: unknown[]) {
  for (let k = records.length - 1; k >= 0; k--) {
    const r = jsonRecord(records[k])
    if (r.type === 'assistant' || r.type === 'user') {
      const stop = jsonRecord(r.message).stop_reason
      return `${r.type}${stop ? ` · ${stop}` : ''}`
    }
  }
  return null
}

// Per-agent summary shared by workflow runs and plain Task/Agent sub-agents.
function summarizeAgentFile(file: string, id: string): AgentSummary {
  let mtime = 0
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {}
  // an over-the-cap agent transcript degrades to an empty-but-listed agent
  // instead of 413ing the whole run/subagent listing
  let oversized = false
  const recs = withOversizeFallback(
    () => readRecords(file),
    () => {
      oversized = true
      return []
    }
  )
  const tokens = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }
  let model: string | null = null
  let firstTs: string | number | null = null
  let lastTs: string | number | null = null
  let endTurn = false
  let toolCalls = 0
  for (const value of recs) {
    const r = jsonRecord(value)
    const timestamp = optionalTimestamp(r.timestamp)
    if (timestamp) {
      if (!firstTs) firstTs = timestamp
      lastTs = timestamp
    }
    if (r.type === 'assistant') {
      if (typeof jsonRecord(r.message).model === 'string') model = String(jsonRecord(r.message).model)
      endTurn = jsonRecord(r.message).stop_reason === 'end_turn'
      const u = jsonRecord(jsonRecord(r.message).usage)
      if (u) {
        tokens.input += numberOrZero(u.input_tokens)
        tokens.output += numberOrZero(u.output_tokens)
        tokens.cacheCreate += numberOrZero(u.cache_creation_input_tokens)
        tokens.cacheRead += numberOrZero(u.cache_read_input_tokens)
      }
      const c = jsonRecord(r.message).content
      if (Array.isArray(c)) {
        for (const b of c) if (b?.type === 'tool_use' || b?.type === 'server_tool_use') toolCalls++
      }
    }
  }
  return {
    id,
    label: oversized ? '(transcript too large)' : firstLabel(recs),
    model,
    tokens,
    toolCalls,
    firstTs,
    lastTs,
    mtime,
    activity: lastActivity(recs),
    endTurn,
    oversized,
  }
}

// Best-effort phase inference from an agent's first-line label. phase↔agent is
// NOT persisted on disk (see spec/DATA-MODEL.md) — this is a heuristic, surfaced as
// "inferred" in the UI, that degrades to ungrouped when labels don't echo phases.
const PHASE_SYN = {
  scope: ['scope', 'decompos', 'angle', 'plan'],
  search: ['search', 'searcher', 'google', 'query'],
  fetch: ['fetch', 'extract', 'source', 'crawl', 'retriev'],
  verify: ['verif', 'refute', 'voter', 'adversari', 'skeptic'],
  synthes: ['synthes', 'synthesis', 'merge', 'rank', 'final report'],
}
function phaseTokens(title?: string) {
  const t = (title || '').toLowerCase()
  const toks = new Set<string>()
  if (t) {
    toks.add(t)
    if (t.length >= 4) toks.add(t.slice(0, 5))
  }
  for (const [k, arr] of Object.entries(PHASE_SYN)) {
    if (t.includes(k) || k.startsWith(t.slice(0, 4)))
      arr.forEach((x) => {
        toks.add(x)
      })
  }
  return [...toks].filter(Boolean)
}
// Word-boundary match so e.g. "searc" matches "searcher" but NOT "research".
function matchTok(L: string, tok: string) {
  try {
    return new RegExp('\\b' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(L)
  } catch {
    return L.includes(tok)
  }
}
function inferPhase(label: string | null, phases: Phase[]) {
  if (!label || !phases?.length) return null
  const L = label.toLowerCase()
  for (let i = 0; i < phases.length; i++) {
    if (phaseTokens(phases[i].title).some((tok) => matchTok(L, tok))) return i
  }
  return null
}

/** Plain Task/Agent sub-agents: <sessionId>/subagents/agent-*.jsonl (NOT workflows/). */
export function discoverPlainAgents(rootDir: string, slug: string, sessionId: string) {
  const base = path.join(projectsDir(rootDir), slug, sessionId, 'subagents')
  assertInside(rootDir, base)
  let names = []
  try {
    names = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isFile() && /^agent-.*\.jsonl$/.test(e.name)) // dirs (workflows/) excluded
      .map((e) => e.name)
  } catch {
    return []
  }
  const RECENT_MS = 60000
  const now = Date.now()
  return names
    .map((name) => {
      const id = name.replace(/^agent-/, '').replace(/\.jsonl$/, '')
      const a = summarizeAgentFile(path.join(base, name), id)
      let meta: Record<string, unknown> | null = null
      try {
        meta = jsonRecord(JSON.parse(fs.readFileSync(path.join(base, `agent-${id}.meta.json`), 'utf8')) as unknown)
      } catch {}
      a.agentType = meta?.agentType || null
      a.description = meta?.description || null
      // Claude Code writes the sidecar when the Agent/Task tool spawns the
      // agent; `toolUseId` is the parent transcript's tool_use block id, which
      // is what lets the Conversation view link a tool call to its agent
      // exactly (see src/components/claude/subagentAdapter.ts).
      a.toolUseId = typeof meta?.toolUseId === 'string' ? meta.toolUseId : null
      a.spawnDepth = typeof meta?.spawnDepth === 'number' && Number.isFinite(meta.spawnDepth) ? meta.spawnDepth : null
      a.status = a.endTurn ? 'done' : a.mtime && now - a.mtime < RECENT_MS ? 'running' : 'stalled'
      return a
    })
    .sort((x, y) => (y.mtime || 0) - (x.mtime || 0))
}

function aggregateRun(runDir: string, scriptMeta: ScriptMeta | null) {
  const journal = fs.existsSync(path.join(runDir, 'journal.jsonl'))
    ? withOversizeFallback(
        () => readRecords(path.join(runDir, 'journal.jsonl')),
        () => []
      )
    : []
  const started = new Set<string>()
  const results = new Map()
  for (const value of journal) {
    const e = jsonRecord(value)
    if (typeof e.agentId !== 'string' || !e.agentId) continue
    if (e.type === 'started') started.add(e.agentId)
    if (e.type === 'result') results.set(e.agentId, e.result ?? null)
  }

  let files: string[] = []
  try {
    files = fs.readdirSync(runDir).filter((f) => /^agent-.*\.jsonl$/.test(f))
  } catch {}

  const phases = scriptMeta?.phases || []
  const agents: AgentSummary[] = []
  for (const f of files) {
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '')
    const a = summarizeAgentFile(path.join(runDir, f), id)
    a.status = results.has(id) ? 'done' : started.has(id) ? 'running' : 'unknown'
    a.hasResult = results.has(id)
    a.phase = inferPhase(a.label, phases)
    agents.push(a)
  }
  // agents announced in journal but whose transcript file hasn't appeared yet
  for (const id of started) {
    if (!agents.some((a) => a.id === id)) {
      agents.push({
        id,
        label: null,
        status: results.has(id) ? 'done' : 'starting',
        model: null,
        tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
        firstTs: null,
        lastTs: null,
        mtime: 0,
        activity: null,
        hasResult: results.has(id),
        phase: null,
      })
    }
  }

  // Reclassify by recency: a "started" agent with no result is only *running*
  // if its transcript was written recently. Stalled/retried agents (the deep-
  // research run leaves these behind) otherwise look perpetually running.
  const RECENT_MS = 60000
  const now = Date.now()
  for (const a of agents) {
    if (a.hasResult) a.status = 'done'
    else if (a.mtime && now - a.mtime < RECENT_MS) a.status = 'running'
    else a.status = 'stalled'
  }

  const totals = agents.reduce(
    (a, x) => {
      a.input += x.tokens.input
      a.output += x.tokens.output
      a.cacheCreate += x.tokens.cacheCreate
      a.cacheRead += x.tokens.cacheRead
      return a
    },
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }
  )
  const ts = agents
    .flatMap((a) => [a.firstTs, a.lastTs])
    .filter((value): value is string | number => value !== null)
    .sort()
  const elapsedMs = ts.length >= 2 ? new Date(ts[ts.length - 1]).getTime() - new Date(ts[0]).getTime() : 0
  const anyRunning = agents.some((a) => a.status === 'running')
  const allDone = agents.length > 0 && agents.every((a) => a.status === 'done')
  // 'idle' = no recent writes but not all agents reported a result (stalls/retries).
  // Authoritative "done" needs the session's <task-notification> (see README).
  const runStatus = allDone ? 'done' : anyRunning ? 'running' : 'idle'

  return { agents, totals, elapsedMs, agentCount: agents.length, runStatus }
}

// Authoritative completion: the session jsonl records a <task-notification> with
// status=completed + <usage> when a run finishes. This is the only reliable
// "done" signal (the journal has no completion/error event). Match it to this
// run via the runId->taskId link printed in the Workflow launch tool result.
function tag(s: string, key: string) {
  const m = s.match(new RegExp(`<${key}>(\\d+)</${key}>`))
  return m ? Number(m[1]) : null
}
function findRunCompletion(rootDir: string, slug: string, sessionId: string, runId: string) {
  const f = path.join(projectsDir(rootDir), slug, sessionId + '.jsonl')
  let text: string
  try {
    text = fs.readFileSync(f, 'utf8')
  } catch {
    return null
  }
  let taskId = null
  const i = text.indexOf(runId)
  if (i >= 0) {
    const w = text.slice(Math.max(0, i - 3000), i + 3000)
    const m = w.match(/[Tt]ask ID:\s*([\w.-]+)/) || w.match(/"taskId"\s*:\s*"([^"]+)"/)
    if (m) taskId = m[1]
  }
  const notifs = text.match(/<task-notification>[\s\S]*?<\/task-notification>/g) || []
  const completed = notifs.filter((n) => /<status>\s*completed\s*<\/status>/.test(n))
  let pick: string | null | undefined = null
  if (taskId) pick = completed.find((n) => n.includes(taskId))
  if (!pick && !taskId && completed.length === 1) pick = completed[0]
  if (!pick) return null
  return {
    agentCount: tag(pick, 'agent_count'),
    subagentTokens: tag(pick, 'subagent_tokens'),
    toolUses: tag(pick, 'tool_uses'),
    durationMs: tag(pick, 'duration_ms'),
  }
}

// Find a run's script across any project slug (cwd may have changed mid-session).
function findScript(rootDir: string, sessionId: string, runId: string) {
  for (const s of listProjectSlugs(rootDir)) {
    const dir = path.join(projectsDir(rootDir), s, sessionId, 'workflows', 'scripts')
    let names = []
    try {
      names = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    } catch {
      continue
    }
    const hit = names.find((f) => f.endsWith(`-${runId}.js`)) || names.find((f) => f.includes(runId))
    if (hit) return path.join(dir, hit)
  }
  return null
}

/** Discover all workflow runs for a session (subagents/workflows/wf_*). */
export function discoverRuns(rootDir: string, slug: string, sessionId: string) {
  const base = path.join(projectsDir(rootDir), slug, sessionId, 'subagents', 'workflows')
  assertInside(rootDir, base)
  let dirs = []
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('wf_'))
  } catch {
    return []
  }
  return dirs.map((d) => {
    const runDir = path.join(base, d.name)
    // The script lives in <slug>/<sessionId>/workflows/scripts, but if the cwd
    // changed mid-session the script can land under a *different* slug for the
    // same sessionId. So search across all slugs for this run's script.
    const scriptPath = findScript(rootDir, sessionId, d.name)
    let meta: ScriptMeta | null = null
    if (scriptPath) {
      try {
        meta = parseScriptMeta(fs.readFileSync(scriptPath, 'utf8'))
      } catch {}
    }
    const scriptFile = scriptPath ? path.basename(scriptPath) : null
    const agg = aggregateRun(runDir, meta)
    const out: {
      runId: string
      script: string | null
      name: unknown
      description: unknown
      phases: Phase[]
      authoritative?: ReturnType<typeof findRunCompletion>
    } & ReturnType<typeof aggregateRun> = {
      runId: d.name,
      script: scriptFile || null,
      name: meta?.name || null,
      description: meta?.description || null,
      phases: meta?.phases || [],
      ...agg,
    }
    const completion = findRunCompletion(rootDir, slug, sessionId, d.name)
    if (completion) {
      out.runStatus = 'done' // authoritative completion overrides the mtime heuristic
      out.authoritative = completion
    }
    return out
  })
}
