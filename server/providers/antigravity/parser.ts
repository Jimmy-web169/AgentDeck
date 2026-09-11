import type { NormalizedSummary } from '../../shared/parserTypes.ts'
import fs from 'node:fs'
import { jsonRecord, jsonArray, optionalString, optionalTimestamp, numberOrZero } from '../../shared/json.ts'
import type { TimelineEvent, ToolCallPart } from '../../../shared/types.d.ts'
type Part = NonNullable<TimelineEvent['parts']>[number]
import { guardTranscriptSize } from '../../shared/transcriptGuard.ts'
import { withTotal } from '../../shared/tokens.ts'

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

export function readRecords(file: string): unknown[] {
  guardTranscriptSize(file, 'transcript')
  const text = fs.readFileSync(file, 'utf8')
  const out: unknown[] = []
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

const RESULT_TYPES = new Set([
  'GENERIC',
  'RUN_COMMAND',
  'VIEW_FILE',
  'CODE_ACTION',
  'GREP_SEARCH',
  'SEARCH_WEB',
  'LIST_DIR',
  'LIST_DIRECTORY',
  'MCP_TOOL',
  'INVOKE_SUBAGENT',
  'BROWSER_SUBAGENT',
  'FIND_BY_NAME',
  'READ_URL_CONTENT',
  'WRITE_TO_FILE',
  'REPLACE_FILE_CONTENT',
])
const IGNORE_TYPES = new Set(['EPHEMERAL_MESSAGE', 'CONVERSATION_HISTORY', 'CHECKPOINT'])

const block = (name: string) => new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')
// the user's own words, without the metadata blocks agy appends
export function userText(content: unknown) {
  if (typeof content !== 'string') return ''
  const m = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/)
  if (m) return m[1].trim()
  return content.replace(block('ADDITIONAL_METADATA'), '').replace(block('USER_SETTINGS_CHANGE'), '').replace(block('SYSTEM_MESSAGE'), '').trim()
}
// "The user changed setting `Model Selection` from None to Gemini 3.8 Flash (High)." → "Gemini 3.8 Flash (High)"
export function modelLabel(content: unknown) {
  if (typeof content !== 'string') return null
  // "…from None to Gemini 3.8 Flash (High). No need to comment…" — the label
  // itself contains a dot, so stop at the first period followed by whitespace
  // (sentence end) or at the end of the line minus a trailing period
  const m = content.match(/`Model Selection`[^\n]*?\bto\s+(.+?)(?:\.(?=\s)|\.?\s*(?:\n|$))/)
  return m ? m[1].trim() : null
}
// tool results start with "Created At: …\nCompleted At: …\n" bookkeeping lines
const stripResultHeader = (s: unknown) => (typeof s === 'string' ? s.replace(/^(?:(?:Created|Completed) At: [^\n]*\n)+\n?/, '') : '')
const systemText = (s: unknown) =>
  typeof s === 'string'
    ? s
        .replace(/^The following is a <SYSTEM_MESSAGE>[^\n]*\n+/, '')
        .replace(/<\/?SYSTEM_MESSAGE>/g, '')
        .trim()
    : ''

export function buildTimeline(records: unknown[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let pending: ToolCallPart[] = [] // tool_call parts of the newest assistant event still waiting for a result
  const ordered = records.map(jsonRecord).sort((a, b) => numberOrZero(a.step_index) - numberOrZero(b.step_index))
  for (const rec of ordered) {
    const type = optionalString(rec.type) || ''
    const ts = optionalTimestamp(rec.created_at) || null
    if (IGNORE_TYPES.has(type)) continue
    if (type === 'USER_INPUT') {
      events.push({ kind: 'user', step: rec.step_index ?? null, ts, text: userText(rec.content) })
      pending = []
    } else if (type === 'PLANNER_RESPONSE') {
      const parts: Part[] = []
      if (rec.thinking) parts.push({ kind: 'thinking', text: String(rec.thinking) })
      if (rec.content) parts.push({ kind: 'text', text: String(rec.content) })
      const calls = jsonArray(rec.tool_calls).map(jsonRecord)
      const callParts = calls.map<ToolCallPart>((tc, i) => {
        const { toolAction, toolSummary, ...input } = jsonRecord(tc.args)
        return {
          kind: 'tool_call',
          id: `s${rec.step_index ?? events.length}.${i}`,
          name: optionalString(tc.name) || 'tool',
          summary: toolSummary || toolAction || null,
          input,
          result: null,
        }
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

export function summarize(records: unknown[], id: string): NormalizedSummary {
  let firstTs: string | number | null = null
  let lastTs: string | number | null = null
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  let firstPrompt = ''
  let lastUserPrompt = '',
    lastUserPromptTs: string | number | null = null
  const toolCounts: Record<string, number> = {}
  const models = new Set<string>()
  for (const rec of records.map(jsonRecord).sort((a, b) => numberOrZero(a.step_index) - numberOrZero(b.step_index))) {
    if (IGNORE_TYPES.has(optionalString(rec.type) || '')) continue
    if (rec.created_at) {
      if (!firstTs) firstTs = optionalTimestamp(rec.created_at) || null
      lastTs = optionalTimestamp(rec.created_at) || null
    }
    if (rec.type === 'USER_INPUT') {
      userTurns++
      const prompt = userText(rec.content)
      if (!firstPrompt) firstPrompt = prompt
      // A metadata-only USER_INPUT is not a new question. This native format
      // does not provide a reliable non-text attachment marker here.
      if (prompt) {
        lastUserPrompt = prompt.replace(/\s+/g, ' ').trim()
        if (lastUserPrompt.length > 140) lastUserPrompt = lastUserPrompt.slice(0, 140) + '…'
        lastUserPromptTs = optionalTimestamp(rec.created_at) || null
      }
      const m = modelLabel(rec.content)
      if (m) models.add(m)
    } else if (rec.type === 'PLANNER_RESPONSE') {
      assistantTurns++
      for (const tc of jsonArray(rec.tool_calls).map(jsonRecord)) {
        toolCalls++
        const n = optionalString(tc.name) || 'tool'
        toolCounts[n] = (toolCounts[n] || 0) + 1
      }
    }
  }
  const title = (firstPrompt.split('\n')[0] || id).slice(0, 120)
  return {
    id,
    title,
    firstPrompt,
    lastUserPrompt,
    lastUserPromptTs,
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
