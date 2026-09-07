import fs from 'node:fs'
import { guardTranscriptSize } from '../../shared/transcriptGuard.js'
import { withTotal } from '../../shared/tokens.js'

// Antigravity CLI writes one *step* per line to
// brain/<id>/.system_generated/logs/transcript_full.jsonl:
//   { step_index, source: USER_EXPLICIT|MODEL|SYSTEM, type, status, created_at,
//     content?, thinking?, tool_calls?: [{ name, args }], error? }
// Types seen with agy 1.1.27: USER_INPUT, PLANNER_RESPONSE (text / thinking /
// tool_calls), GENERIC (every tool's result), SYSTEM_MESSAGE, ERROR_MESSAGE;
// the hub also wrote RUN_COMMAND / VIEW_FILE / CODE_ACTION / … for results.
// There is no tool-call id in the JSONL: a PLANNER_RESPONSE's N tool_calls are
// followed by N result steps, in order, so results are paired by adjacency.
// Model and tokens are not in the JSONL either (see sqlite.js); the parser
// leaves them empty and api.js fills them in.

export function readRecords(file) {
  guardTranscriptSize(file, 'transcript')
  const text = fs.readFileSync(file, 'utf8')
  const out = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      out.push(JSON.parse(s))
    } catch {
      // partial trailing line while agy is still writing
    }
  }
  return out
}

const RESULT_TYPES = new Set(['GENERIC', 'RUN_COMMAND', 'VIEW_FILE', 'CODE_ACTION', 'GREP_SEARCH', 'SEARCH_WEB', 'LIST_DIR', 'LIST_DIRECTORY', 'MCP_TOOL', 'INVOKE_SUBAGENT', 'BROWSER_SUBAGENT', 'FIND_BY_NAME', 'READ_URL_CONTENT', 'WRITE_TO_FILE', 'REPLACE_FILE_CONTENT'])
const IGNORE_TYPES = new Set(['EPHEMERAL_MESSAGE', 'CONVERSATION_HISTORY', 'CHECKPOINT'])

const block = (name) => new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')
// the user's own words, without the metadata blocks agy appends
export function userText(content) {
  if (typeof content !== 'string') return ''
  const m = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/)
  if (m) return m[1].trim()
  return content.replace(block('ADDITIONAL_METADATA'), '').replace(block('USER_SETTINGS_CHANGE'), '').replace(block('SYSTEM_MESSAGE'), '').trim()
}
// "The user changed setting `Model Selection` from None to Gemini 3.8 Flash (High)." → "Gemini 3.8 Flash (High)"
export function modelLabel(content) {
  if (typeof content !== 'string') return null
  // "…from None to Gemini 3.8 Flash (High). No need to comment…" — the label
  // itself contains a dot, so stop at the first period followed by whitespace
  // (sentence end) or at the end of the line minus a trailing period
  const m = content.match(/`Model Selection`[^\n]*?\bto\s+(.+?)(?:\.(?=\s)|\.?\s*(?:\n|$))/)
  return m ? m[1].trim() : null
}
// tool results start with "Created At: …\nCompleted At: …\n" bookkeeping lines
const stripResultHeader = (s) => (typeof s === 'string' ? s.replace(/^(?:(?:Created|Completed) At: [^\n]*\n)+\n?/, '') : '')
const systemText = (s) => (typeof s === 'string' ? s.replace(/^The following is a <SYSTEM_MESSAGE>[^\n]*\n+/, '').replace(/<\/?SYSTEM_MESSAGE>/g, '').trim() : '')

export function buildTimeline(records) {
  const events = []
  let pending = [] // tool_call parts of the newest assistant event still waiting for a result
  const ordered = [...records].sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0))
  for (const rec of ordered) {
    const type = rec.type
    const ts = rec.created_at || null
    if (IGNORE_TYPES.has(type)) continue
    if (type === 'USER_INPUT') {
      events.push({ kind: 'user', step: rec.step_index ?? null, ts, text: userText(rec.content) })
      pending = []
    } else if (type === 'PLANNER_RESPONSE') {
      const parts = []
      if (rec.thinking) parts.push({ kind: 'thinking', text: String(rec.thinking) })
      if (rec.content) parts.push({ kind: 'text', text: String(rec.content) })
      const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : []
      const callParts = calls.map((tc, i) => {
        const { toolAction, toolSummary, ...input } = tc.args && typeof tc.args === 'object' ? tc.args : {}
        return { kind: 'tool_call', id: `s${rec.step_index ?? events.length}.${i}`, name: tc.name || 'tool', summary: toolSummary || toolAction || null, input, result: null }
      })
      parts.push(...callParts)
      events.push({ kind: 'assistant', step: rec.step_index ?? null, ts, model: null, usage: null, parts })
      pending = callParts
    } else if (RESULT_TYPES.has(type)) {
      const content = stripResultHeader(rec.content)
      const isError = !!rec.error || rec.status === 'ERROR'
      const call = pending.shift()
      if (call) call.result = { content, isError, ...(rec.error ? { error: String(rec.error) } : {}) }
      else events.push({ kind: 'system', step: rec.step_index ?? null, ts, subtype: type.toLowerCase(), text: content.slice(0, 2000) })
    } else if (type === 'SYSTEM_MESSAGE' || type === 'ERROR_MESSAGE') {
      events.push({ kind: 'system', step: rec.step_index ?? null, ts, subtype: type === 'ERROR_MESSAGE' ? 'error' : 'message', text: systemText(rec.content) })
    }
  }
  return events
}

export function summarize(records, id) {
  let firstTs = null
  let lastTs = null
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  let firstPrompt = ''
  const toolCounts = {}
  const models = new Set()
  for (const rec of [...records].sort((a, b) => (a.step_index ?? 0) - (b.step_index ?? 0))) {
    if (IGNORE_TYPES.has(rec.type)) continue
    if (rec.created_at) {
      if (!firstTs) firstTs = rec.created_at
      lastTs = rec.created_at
    }
    if (rec.type === 'USER_INPUT') {
      userTurns++
      if (!firstPrompt) firstPrompt = userText(rec.content)
      const m = modelLabel(rec.content)
      if (m) models.add(m)
    } else if (rec.type === 'PLANNER_RESPONSE') {
      assistantTurns++
      for (const tc of Array.isArray(rec.tool_calls) ? rec.tool_calls : []) {
        toolCalls++
        const n = tc.name || 'tool'
        toolCounts[n] = (toolCounts[n] || 0) + 1
      }
    }
  }
  const title = (firstPrompt.split('\n')[0] || id).slice(0, 120)
  return {
    id,
    title,
    firstPrompt,
    firstTs,
    lastTs,
    cwd: null, // from sqlite.js, merged in api.js
    userTurns,
    assistantTurns,
    toolCalls,
    models: [...models],
    toolCounts,
    tokens: withTotal({ input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 }), // from sqlite.js, merged in api.js
  }
}
