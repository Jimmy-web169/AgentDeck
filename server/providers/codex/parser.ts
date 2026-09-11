import type { NormalizedSummary } from '../../shared/parserTypes.ts'
import fs from 'node:fs'
import { jsonRecord, jsonArray, optionalString, optionalTimestamp, numberOrZero } from '../../shared/json.ts'
import type { TimelineEvent } from '../../../shared/types.d.ts'
type Parts = NonNullable<TimelineEvent['parts']>
import { guardTranscriptSize } from '../../shared/transcriptGuard.ts'
import { withTotal } from '../../shared/tokens.ts'

/**
 * Parse a Codex "rollout" .jsonl into raw records.
 * Each line is one JSON event; tolerate malformed/truncated trailing lines.
 */
export function readRecords(file: string): unknown[] {
  guardTranscriptSize(file, 'rollout') // 413 instead of an OOM-risk whole-file read
  const text = fs.readFileSync(file, 'utf8')
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      out.push(JSON.parse(s))
    } catch {
      // skip a partial/corrupt line rather than failing the whole session
    }
  }
  return out
}

// ---- record normalisation ---------------------------------------------------
// Codex wrote rollouts in two shapes over time:
//   new: { timestamp, type: 'response_item'|'event_msg'|'turn_context'|'session_meta', payload: {...} }
//   old: bare records like { type: 'function_call'|'message'|'reasoning', ... }
// normalise() unwraps both into { ts, group, kind, body } where
//   group = 'response_item' | 'event_msg' | 'turn_context' | 'session_meta'
//   kind  = payload.type (e.g. 'message', 'function_call', 'user_message', …)
function normalize(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const rec = jsonRecord(value)
  const ts = optionalTimestamp(rec.timestamp) || optionalTimestamp(rec.ts) || null
  const wrappers = new Set(['response_item', 'event_msg', 'turn_context', 'session_meta'])
  if (wrappers.has(optionalString(rec.type) || '') && rec.payload && typeof rec.payload === 'object') {
    const p = jsonRecord(rec.payload)
    if (rec.type === 'turn_context' || rec.type === 'session_meta') {
      return { ts, group: rec.type, kind: rec.type, body: p }
    }
    return { ts, group: optionalString(rec.type), kind: optionalString(p.type) || null, body: p }
  }
  // bare records — the conversation items live at the top level
  if (
    rec.type === 'message' ||
    rec.type === 'function_call' ||
    rec.type === 'function_call_output' ||
    rec.type === 'reasoning' ||
    rec.type === 'custom_tool_call' ||
    rec.type === 'custom_tool_call_output'
  ) {
    return { ts, group: 'response_item', kind: rec.type, body: rec }
  }
  // legacy session header: { id, timestamp, instructions } with no type
  if (!rec.type && (rec.instructions !== undefined || rec.id)) {
    return { ts, group: 'session_meta', kind: 'session_meta', body: rec }
  }
  return { ts, group: optionalString(rec.type) || 'other', kind: optionalString(rec.type) || null, body: rec }
}

// ---- helpers ----------------------------------------------------------------

const ENV_WRAP = /<environment_context>[\s\S]*?<\/environment_context>/g
const USER_INSTR_WRAP = /<user_instructions>[\s\S]*?<\/user_instructions>/g

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((value: unknown) => {
      const b = jsonRecord(value)
      if (typeof value === 'string') return value
      if (!b || typeof b !== 'object') return ''
      // Responses API content blocks: input_text (user) / output_text (assistant)
      if (b.type === 'input_text' || b.type === 'output_text' || b.type === 'text') return optionalString(b.text) || ''
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function cleanUserText(raw: unknown) {
  return (optionalString(raw) || '').replace(ENV_WRAP, '').replace(USER_INSTR_WRAP, '').trim()
}

function snippet(text: string, max = 140) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

function reasoningText(body: Record<string, unknown>) {
  const summary = Array.isArray(body.summary) ? body.summary : []
  const parts = summary.map((s) => (typeof s === 'string' ? s : optionalString(jsonRecord(s).text) || '')).filter(Boolean)
  if (parts.length) return parts.join('\n\n')
  // some reasoning items carry plain content blocks instead of a summary
  if (Array.isArray(body.content)) return textFromContent(body.content)
  return ''
}

// Parse a function_call's `arguments` (a JSON string) into an object.
function parseArgs(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return {}
  try {
    const o: unknown = JSON.parse(raw)
    return o && typeof o === 'object' ? o : { value: o }
  } catch {
    return { _raw: raw }
  }
}

// Normalise a tool call into { name, input } where input is always an object.
function toolInput(kind: string, body: Record<string, unknown>) {
  if (kind === 'custom_tool_call') {
    // freeform tools (e.g. apply_patch) carry a raw string `input`
    const raw = typeof body.input === 'string' ? body.input : ''
    if ((optionalString(body.name) || '').toLowerCase().includes('patch')) return { patch: raw }
    return raw ? { input: raw } : {}
  }
  return parseArgs(body.arguments)
}

// Normalise a tool result payload. Codex stores the output as a JSON string like
//   {"output":"…","metadata":{"exit_code":0,"duration_seconds":0.1}}
// but older/bare records may store a plain string or object.
function parseToolOutput(output: unknown) {
  let o = output
  if (typeof output === 'string') {
    try {
      o = JSON.parse(output)
    } catch {
      return { content: output, isError: false, meta: null }
    }
  }
  if (o && typeof o === 'object' && 'output' in o) {
    const metadata = jsonRecord(o).metadata
    const meta = metadata && typeof metadata === 'object' ? jsonRecord(metadata) : null
    const exit = meta && typeof meta.exit_code === 'number' ? meta.exit_code : null
    return { content: String(o.output ?? ''), isError: exit != null && exit !== 0, meta }
  }
  if (o && typeof o === 'object') return { content: JSON.stringify(o, null, 2), isError: false, meta: null }
  return { content: String(o ?? ''), isError: false, meta: null }
}

// ---- timeline ---------------------------------------------------------------

/**
 * Build a normalised, ChatGPT-style timeline from raw rollout records.
 *
 * Codex duplicates conversation text across two layers: clean UI events
 * (event_msg.user_message / agent_message / agent_reasoning) and the raw model
 * I/O (response_item.message / reasoning). We prefer the clean event layer when
 * present and fall back to response_item for older rollouts that predate it.
 * Tool calls (function_call / custom_tool_call) only exist on the response_item
 * layer and are paired with their *_output by call_id.
 */
export function buildTimeline(records: unknown[]): TimelineEvent[] {
  const items = records.map(normalize).filter((item) => item !== null)

  // Which text layer to trust. The clean event layer (user_message/agent_message)
  // and reasoning were added to rollouts at different times, so we decide per
  // layer independently — otherwise an assistant turn that only exists as a
  // response_item.message (e.g. an aborted turn with no agent_message) would be
  // dropped just because some *other* turn had a user_message event.
  const hasEventUser = items.some((it) => it.group === 'event_msg' && it.kind === 'user_message')
  const hasEventAssistant = items.some((it) => it.group === 'event_msg' && it.kind === 'agent_message')
  const hasRiReasoning = items.some((it) => it.group === 'response_item' && it.kind === 'reasoning')

  // 1) collect tool outputs by call_id
  const outputs = new Map<string, ReturnType<typeof parseToolOutput>>()
  for (const it of items) {
    if (it.group === 'response_item' && (it.kind === 'function_call_output' || it.kind === 'custom_tool_call_output')) {
      const id = optionalString(it.body.call_id) || optionalString(it.body.id)
      if (id) outputs.set(id, parseToolOutput(it.body.output))
    }
  }

  const events: TimelineEvent[] = []
  let cur: (TimelineEvent & { parts: Parts }) | null = null // open assistant turn (accumulates reasoning/tools/text parts)
  let model: string | null = null

  const flush = () => {
    if (cur?.parts.length) events.push(cur)
    cur = null
  }
  const ensureAsst = (ts: string | number | null) => {
    if (!cur) cur = { kind: 'assistant', ts, model, usage: null, parts: [] }
    else if (ts) cur.ts = ts
    return cur
  }

  for (const it of items) {
    const { group, kind, body, ts } = it

    if (group === 'turn_context') {
      if (body.model) model = body.effort ? `${body.model} (${body.effort})` : optionalString(body.model) || null
      continue
    }
    if (group === 'session_meta') {
      if (body.model) model = optionalString(body.model) || null
      continue
    }

    if (group === 'event_msg') {
      if (kind === 'user_message') {
        const text = cleanUserText(body.message)
        if (!text) continue
        flush()
        events.push({ kind: 'user', ts, text })
      } else if (kind === 'agent_message') {
        const text = optionalString(body.message)
        if (text?.trim()) ensureAsst(ts).parts.push({ kind: 'text', text })
      } else if (kind === 'agent_reasoning' && !hasRiReasoning) {
        const text = optionalString(body.text)
        if (text?.trim()) ensureAsst(ts).parts.push({ kind: 'thinking', text })
      } else if (kind === 'turn_aborted') {
        flush()
        events.push({ kind: 'system', ts, subtype: 'turn aborted', text: optionalString(body.reason) || '' })
      }
      continue
    }

    if (group === 'response_item') {
      if (kind === 'message') {
        const role = body.role
        const text = textFromContent(body.content)
        if (role === 'user') {
          if (hasEventUser) continue // clean copy already came from event_msg
          const clean = cleanUserText(text)
          if (!clean) continue
          flush()
          events.push({ kind: 'user', ts, text: clean })
        } else if (role === 'assistant') {
          if (hasEventAssistant) continue // clean copy already came from event_msg
          if (text.trim()) ensureAsst(ts).parts.push({ kind: 'text', text })
        }
      } else if (kind === 'reasoning') {
        const text = reasoningText(body)
        if (text.trim()) ensureAsst(ts).parts.push({ kind: 'thinking', text })
      } else if (kind === 'function_call' || kind === 'custom_tool_call') {
        const id = optionalString(body.call_id) || optionalString(body.id)
        ensureAsst(ts).parts.push({
          kind: 'tool_call',
          id,
          name: optionalString(body.name) || 'tool',
          input: toolInput(kind, body),
          result: id ? outputs.get(id) || null : null,
        })
      }
    }
  }
  flush()
  return events
}

// ---- session summary (list view) -------------------------------------------

export function summarize(records: unknown[], id: string): NormalizedSummary {
  const items = records.map(normalize).filter((item) => item !== null)
  const hasEventUser = items.some((it) => it.group === 'event_msg' && it.kind === 'user_message')
  const hasEventAssistant = items.some((it) => it.group === 'event_msg' && it.kind === 'agent_message')

  let title: string | null = null
  let firstPrompt: string | null = null
  let lastUserPrompt = '',
    lastUserPromptTs: string | number | null = null
  let firstTs: string | number | null = null
  let lastTs: string | number | null = null
  let cwd: string | null = null
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  const models = new Set<string>()
  const toolCounts: Record<string, number> = {}
  let tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, reasoning: 0, total: 0 }
  let contextWindow = 0 // model_context_window for this session's model
  let lastUsage: Record<string, unknown> | null = null // last_token_usage — the most recent request's token breakdown
  let rateLimits: Record<string, unknown> | null = null // newest rate_limits snapshot (5-hour primary / weekly secondary)

  for (const it of items) {
    const { group, kind, body, ts } = it
    if (ts) {
      if (!firstTs) firstTs = ts
      lastTs = ts
    }
    if (group === 'session_meta') {
      if (typeof body.cwd === 'string' && !cwd) cwd = body.cwd
      if (typeof body.model === 'string' && body.model) models.add(body.model)
    } else if (group === 'turn_context') {
      if (typeof body.cwd === 'string' && !cwd) cwd = body.cwd
      if (typeof body.model === 'string' && body.model) models.add(body.model)
    } else if (group === 'event_msg') {
      if (kind === 'thread_name_updated' && body.thread_name) title = optionalString(body.thread_name) || null
      else if (kind === 'user_message') {
        const t = cleanUserText(body.message) || (jsonArray(body.images).length || jsonArray(body.local_images).length ? '(Image or attachment)' : '')
        if (t) {
          userTurns++
          if (!firstPrompt) firstPrompt = snippet(t)
          lastUserPrompt = snippet(t)
          lastUserPromptTs = ts || null
        }
      } else if (kind === 'agent_message') {
        assistantTurns++
      } else if (kind === 'token_count' && body.info) {
        const usage = jsonRecord(body.info).total_token_usage
        const u = usage ? jsonRecord(usage) : null
        if (u) {
          tokens = {
            input: numberOrZero(u.input_tokens),
            output: numberOrZero(u.output_tokens),
            cacheRead: numberOrZero(u.cached_input_tokens),
            cacheCreate: 0,
            reasoning: numberOrZero(u.reasoning_output_tokens),
            total: numberOrZero(u.total_tokens),
          }
        }
        // keep the newest values (records are in chronological order)
        if (jsonRecord(body.info).model_context_window) contextWindow = numberOrZero(jsonRecord(body.info).model_context_window)
        if (jsonRecord(body.info).last_token_usage) lastUsage = jsonRecord(jsonRecord(body.info).last_token_usage)
        if (body.rate_limits) rateLimits = jsonRecord(body.rate_limits)
      }
    } else if (group === 'response_item') {
      if (kind === 'message') {
        if (body.role === 'user') {
          if (hasEventUser) continue
          const t =
            cleanUserText(textFromContent(body.content)) ||
            (jsonArray(body.content).some((p) => ['input_image', 'image', 'input_file'].includes(optionalString(jsonRecord(p).type) || ''))
              ? '(Image or attachment)'
              : '')
          if (t) {
            userTurns++
            if (!firstPrompt) firstPrompt = snippet(t)
            lastUserPrompt = snippet(t)
            lastUserPromptTs = ts || null
          }
        } else if (body.role === 'assistant') {
          if (hasEventAssistant) continue
          if (textFromContent(body.content).trim()) assistantTurns++
        }
      } else if (kind === 'function_call' || kind === 'custom_tool_call') {
        toolCalls++
        const name = optionalString(body.name) || 'tool'
        toolCounts[name] = (toolCounts[name] || 0) + 1
      }
    }
  }

  return {
    id,
    title: title || firstPrompt || '(untitled session)',
    firstPrompt: firstPrompt || '',
    lastUserPrompt,
    lastUserPromptTs,
    firstTs,
    lastTs,
    cwd,
    userTurns,
    assistantTurns,
    toolCalls,
    models: [...models],
    toolCounts,
    tokens: withTotal(tokens), // Codex reports its own total; the sum is only the fallback (server/shared/tokens.ts)
    contextWindow,
    lastTokenUsage: lastUsage,
    rateLimits,
  }
}
