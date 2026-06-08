import fs from 'node:fs'
import path from 'node:path'
import { readRecords } from './parser.js'
import { projectsDir, assertInside, listProjectSlugs } from './paths.js'

// Parse `export const meta = { ... }` from a workflow script. meta is a pure
// JS literal (unquoted keys), so brace-match it and eval the object only.
export function parseScriptMeta(text) {
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
    const obj = Function('"use strict"; return (' + text.slice(braceStart, end + 1) + ')')()
    return { name: obj.name, description: obj.description, phases: obj.phases || [] }
  } catch {
    return null
  }
}

function firstLabel(records) {
  for (const r of records) {
    const c = r.message?.content
    const blocks = Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : []
    for (const b of blocks) {
      const t = b?.type === 'text' ? b.text : b?.type === 'thinking' ? b.thinking : ''
      if (t && t.trim()) {
        return t.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 90)
      }
    }
  }
  return null
}

function lastActivity(records) {
  for (let k = records.length - 1; k >= 0; k--) {
    const r = records[k]
    if (r.type === 'assistant' || r.type === 'user') {
      const stop = r.message?.stop_reason
      return `${r.type}${stop ? ` · ${stop}` : ''}`
    }
  }
  return null
}

// Per-agent summary shared by workflow runs and plain Task/Agent sub-agents.
function summarizeAgentFile(file, id) {
  let mtime = 0
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {}
  const recs = readRecords(file)
  const tokens = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }
  let model = null
  let firstTs = null
  let lastTs = null
  let endTurn = false
  for (const r of recs) {
    if (r.timestamp) {
      if (!firstTs) firstTs = r.timestamp
      lastTs = r.timestamp
    }
    if (r.type === 'assistant') {
      if (r.message?.model) model = r.message.model
      endTurn = r.message?.stop_reason === 'end_turn'
      const u = r.message?.usage
      if (u) {
        tokens.input += u.input_tokens || 0
        tokens.output += u.output_tokens || 0
        tokens.cacheCreate += u.cache_creation_input_tokens || 0
        tokens.cacheRead += u.cache_read_input_tokens || 0
      }
    }
  }
  return { id, label: firstLabel(recs), model, tokens, firstTs, lastTs, mtime, activity: lastActivity(recs), endTurn }
}

// Best-effort phase inference from an agent's first-line label. phase↔agent is
// NOT persisted on disk (see DATA-MODEL.md) — this is a heuristic, surfaced as
// "inferred" in the UI, that degrades to ungrouped when labels don't echo phases.
const PHASE_SYN = {
  scope: ['scope', 'decompos', 'angle', 'plan'],
  search: ['search', 'searcher', 'google', 'query'],
  fetch: ['fetch', 'extract', 'source', 'crawl', 'retriev'],
  verify: ['verif', 'refute', 'voter', 'adversari', 'skeptic'],
  synthes: ['synthes', 'synthesis', 'merge', 'rank', 'final report'],
}
function phaseTokens(title) {
  const t = (title || '').toLowerCase()
  const toks = new Set()
  if (t) {
    toks.add(t)
    if (t.length >= 4) toks.add(t.slice(0, 5))
  }
  for (const [k, arr] of Object.entries(PHASE_SYN)) {
    if (t.includes(k) || k.startsWith(t.slice(0, 4))) arr.forEach((x) => toks.add(x))
  }
  return [...toks].filter(Boolean)
}
// Word-boundary match so e.g. "searc" matches "searcher" but NOT "research".
function matchTok(L, tok) {
  try {
    return new RegExp('\\b' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(L)
  } catch {
    return L.includes(tok)
  }
}
function inferPhase(label, phases) {
  if (!label || !phases?.length) return null
  const L = label.toLowerCase()
  for (let i = 0; i < phases.length; i++) {
    if (phaseTokens(phases[i].title).some((tok) => matchTok(L, tok))) return i
  }
  return null
}

/** Plain Task/Agent sub-agents: <sessionId>/subagents/agent-*.jsonl (NOT workflows/). */
export function discoverPlainAgents(rootDir, slug, sessionId) {
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
      let meta = null
      try {
        meta = JSON.parse(fs.readFileSync(path.join(base, `agent-${id}.meta.json`), 'utf8'))
      } catch {}
      a.agentType = meta?.agentType || null
      a.description = meta?.description || null
      a.status = a.endTurn ? 'done' : a.mtime && now - a.mtime < RECENT_MS ? 'running' : 'stalled'
      return a
    })
    .sort((x, y) => (y.mtime || 0) - (x.mtime || 0))
}

function aggregateRun(runDir, scriptMeta) {
  const journal = fs.existsSync(path.join(runDir, 'journal.jsonl'))
    ? readRecords(path.join(runDir, 'journal.jsonl'))
    : []
  const started = new Set()
  const results = new Map()
  for (const e of journal) {
    if (!e.agentId) continue
    if (e.type === 'started') started.add(e.agentId)
    if (e.type === 'result') results.set(e.agentId, e.result ?? null)
  }

  let files = []
  try {
    files = fs.readdirSync(runDir).filter((f) => /^agent-.*\.jsonl$/.test(f))
  } catch {}

  const phases = scriptMeta?.phases || []
  const agents = []
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
  const ts = agents.flatMap((a) => [a.firstTs, a.lastTs]).filter(Boolean).sort()
  const elapsedMs = ts.length >= 2 ? new Date(ts[ts.length - 1]) - new Date(ts[0]) : 0
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
function tag(s, key) {
  const m = s.match(new RegExp(`<${key}>(\\d+)</${key}>`))
  return m ? Number(m[1]) : null
}
function findRunCompletion(rootDir, slug, sessionId, runId) {
  const f = path.join(projectsDir(rootDir), slug, sessionId + '.jsonl')
  let text
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
  let pick = null
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
function findScript(rootDir, sessionId, runId) {
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
export function discoverRuns(rootDir, slug, sessionId) {
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
    let meta = null
    if (scriptPath) {
      try {
        meta = parseScriptMeta(fs.readFileSync(scriptPath, 'utf8'))
      } catch {}
    }
    const scriptFile = scriptPath ? path.basename(scriptPath) : null
    const agg = aggregateRun(runDir, meta)
    const out = {
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
