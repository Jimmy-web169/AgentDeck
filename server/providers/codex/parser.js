import fs from 'node:fs'

/**
 * Parse a Codex "rollout" .jsonl into raw records.
 * Each line is one JSON event; tolerate malformed/truncated trailing lines.
 */
// Guard against a pathologically large rollout exhausting memory (we read the
// whole file at once). 128 MB is far beyond any real session.
const MAX_ROLLOUT_BYTES = 128 * 1024 * 1024

export function readRecords(file) {
  try {
    const { size } = fs.statSync(file)
    if (size > MAX_ROLLOUT_BYTES) {
      const e = new Error(`rollout too large to parse (${Math.round(size / 1e6)} MB)`)
      e.status = 413
      throw e
    }
  } catch (e) {
    if (e.status) throw e // surface our own size error; ignore stat races
  }
  const text = fs.readFileSync(file, 'utf8')
  const out = []
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
function normalize(rec) {
  if (!rec || typeof rec !== 'object') return null
  const ts = rec.timestamp || rec.ts || null
  const wrappers = new Set(['response_item', 'event_msg', 'turn_context', 'session_meta'])
  if (wrappers.has(rec.type) && rec.payload && typeof rec.payload === 'object') {
    const p = rec.payload
    if (rec.type === 'turn_context' || rec.type === 'session_meta') {
      return { ts, group: rec.type, kind: rec.type, body: p }
    }
    return { ts, group: rec.type, kind: p.type || null, body: p }
  }
  // bare records — the conversation items live at the top level
  if (rec.type === 'message' || rec.type === 'function_call' || rec.type === 'function_call_output' || rec.type === 'reasoning' || rec.type === 'custom_tool_call' || rec.type === 'custom_tool_call_output') {
    return { ts, group: 'response_item', kind: rec.type, body: rec }
  }
  // legacy session header: { id, timestamp, instructions } with no type
  if (!rec.type && (rec.instructions !== undefined || rec.id)) {
    return { ts, group: 'session_meta', kind: 'session_meta', body: rec }
  }
  return { ts, group: rec.type || 'other', kind: rec.type || null, body: rec }
}

// ---- helpers ----------------------------------------------------------------

const ENV_WRAP = /<environment_context>[\s\S]*?<\/environment_context>/g
const USER_INSTR_WRAP = /<user_instructions>[\s\S]*?<\/user_instructions>/g

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      if (typeof b === 'string') return b
      if (!b || typeof b !== 'object') return ''
      // Responses API content blocks: input_text (user) / output_text (assistant)
      if (b.type === 'input_text' || b.type === 'output_text' || b.type === 'text') return b.text || ''
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function cleanUserText(raw) {
  return (raw || '').replace(ENV_WRAP, '').replace(USER_INSTR_WRAP, '').trim()
}

function snippet(text, max = 140) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

function reasoningText(body) {
  const summary = Array.isArray(body.summary) ? body.summary : []
  const parts = summary.map((s) => (typeof s === 'string' ? s : s?.text || '')).filter(Boolean)
  if (parts.length) return parts.join('\n\n')
  // some reasoning items carry plain content blocks instead of a summary
  if (Array.isArray(body.content)) return textFromContent(body.content)
  return ''
}

// Parse a function_call's `arguments` (a JSON string) into an object.
function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return {}
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : { value: o }
  } catch {
    return { _raw: raw }
  }
}

// Normalise a tool call into { name, input } where input is always an object.
function toolInput(kind, body) {
  if (kind === 'custom_tool_call') {
    // freeform tools (e.g. apply_patch) carry a raw string `input`
    const raw = typeof body.input === 'string' ? body.input : ''
    if ((body.name || '').toLowerCase().includes('patch')) return { patch: raw }
    return raw ? { input: raw } : {}
  }
  return parseArgs(body.arguments)
}

// Normalise a tool result payload. Codex stores the output as a JSON string like
//   {"output":"…","metadata":{"exit_code":0,"duration_seconds":0.1}}
// but older/bare records may store a plain string or object.
function parseToolOutput(output) {
  let o = output
  if (typeof output === 'string') {
    try {
      o = JSON.parse(output)
    } catch {
      return { content: output, isError: false, meta: null }
    }
  }
  if (o && typeof o === 'object' && 'output' in o) {
    const meta = o.metadata || null
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
export function buildTimeline(records) {
  const items = records.map(normalize).filter(Boolean)

  // Which text layer to trust. The clean event layer (user_message/agent_message)
  // and reasoning were added to rollouts at different times, so we decide per
  // layer independently — otherwise an assistant turn that only exists as a
  // response_item.message (e.g. an aborted turn with no agent_message) would be
  // dropped just because some *other* turn had a user_message event.
  const hasEventUser = items.some((it) => it.group === 'event_msg' && it.kind === 'user_message')
  const hasEventAssistant = items.some((it) => it.group === 'event_msg' && it.kind === 'agent_message')
  const hasRiReasoning = items.some((it) => it.group === 'response_item' && it.kind === 'reasoning')

  // 1) collect tool outputs by call_id
  const outputs = new Map()
  for (const it of items) {
    if (it.group === 'response_item' && (it.kind === 'function_call_output' || it.kind === 'custom_tool_call_output')) {
      const id = it.body.call_id || it.body.id
      if (id) outputs.set(id, parseToolOutput(it.body.output))
    }
  }

  const events = []
  let cur = null // open assistant turn (accumulates reasoning/tools/text parts)
  let model = null

  const flush = () => {
    if (cur && cur.parts.length) events.push(cur)
    cur = null
  }
  const ensureAsst = (ts) => {
    if (!cur) cur = { kind: 'assistant', ts, model, usage: null, parts: [] }
    else if (ts) cur.ts = ts
    return cur
  }

  for (const it of items) {
    const { group, kind, body, ts } = it

    if (group === 'turn_context') {
      if (body.model) model = body.effort ? `${body.model} (${body.effort})` : body.model
      continue
    }
    if (group === 'session_meta') {
      if (body.model) model = body.model
      continue
    }

    if (group === 'event_msg') {
      if (kind === 'user_message') {
        const text = cleanUserText(body.message)
        if (!text) continue
        flush()
        events.push({ kind: 'user', ts, text })
      } else if (kind === 'agent_message') {
        if (body.message?.trim()) ensureAsst(ts).parts.push({ kind: 'text', text: body.message })
      } else if (kind === 'agent_reasoning' && !hasRiReasoning) {
        if (body.text?.trim()) ensureAsst(ts).parts.push({ kind: 'thinking', text: body.text })
      } else if (kind === 'turn_aborted') {
        flush()
        events.push({ kind: 'system', ts, subtype: 'turn aborted', text: body.reason || '' })
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
        const id = body.call_id || body.id
        ensureAsst(ts).parts.push({
          kind: 'tool_use',
          id,
          name: body.name || 'tool',
          input: toolInput(kind, body),
          result: id ? outputs.get(id) || null : null,
        })
      }
      continue
    }
  }
  flush()
  return events
}

// ---- session summary (list view) -------------------------------------------

export function summarize(records, id) {
  const items = records.map(normalize).filter(Boolean)
  const hasEventUser = items.some((it) => it.group === 'event_msg' && it.kind === 'user_message')
  const hasEventAssistant = items.some((it) => it.group === 'event_msg' && it.kind === 'agent_message')

  let title = null
  let firstPrompt = null
  let firstTs = null
  let lastTs = null
  let cwd = null
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  const models = new Set()
  const toolCounts = {}
  let tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, reasoning: 0, total: 0 }
  let contextWindow = 0 // model_context_window for this session's model
  let lastUsage = null // last_token_usage — the most recent request's token breakdown
  let rateLimits = null // newest rate_limits snapshot (5-hour primary / weekly secondary)

  for (const it of items) {
    const { group, kind, body, ts } = it
    if (ts) {
      if (!firstTs) firstTs = ts
      lastTs = ts
    }
    if (group === 'session_meta') {
      if (typeof body.cwd === 'string' && !cwd) cwd = body.cwd
      if (body.model) models.add(body.model)
    } else if (group === 'turn_context') {
      if (typeof body.cwd === 'string' && !cwd) cwd = body.cwd
      if (body.model) models.add(body.model)
    } else if (group === 'event_msg') {
      if (kind === 'thread_name_updated' && body.thread_name) title = body.thread_name
      else if (kind === 'user_message') {
        const t = cleanUserText(body.message)
        if (t) {
          userTurns++
          if (!firstPrompt) firstPrompt = snippet(t)
        }
      } else if (kind === 'agent_message') {
        assistantTurns++
      } else if (kind === 'token_count' && body.info) {
        const u = body.info.total_token_usage
        if (u) {
          tokens = {
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheRead: u.cached_input_tokens || 0,
            cacheCreate: 0,
            reasoning: u.reasoning_output_tokens || 0,
            total: u.total_tokens || 0,
          }
        }
        // keep the newest values (records are in chronological order)
        if (body.info.model_context_window) contextWindow = body.info.model_context_window
        if (body.info.last_token_usage) lastUsage = body.info.last_token_usage
        if (body.rate_limits) rateLimits = body.rate_limits
      }
    } else if (group === 'response_item') {
      if (kind === 'message') {
        if (body.role === 'user') {
          if (hasEventUser) continue
          const t = cleanUserText(textFromContent(body.content))
          if (t) {
            userTurns++
            if (!firstPrompt) firstPrompt = snippet(t)
          }
        } else if (body.role === 'assistant') {
          if (hasEventAssistant) continue
          if (textFromContent(body.content).trim()) assistantTurns++
        }
      } else if (kind === 'function_call' || kind === 'custom_tool_call') {
        toolCalls++
        const name = body.name || 'tool'
        toolCounts[name] = (toolCounts[name] || 0) + 1
      }
    }
  }

  return {
    id,
    title: title || firstPrompt || '(untitled session)',
    firstPrompt: firstPrompt || '',
    firstTs,
    lastTs,
    cwd,
    userTurns,
    assistantTurns,
    toolCalls,
    models: [...models],
    toolCounts,
    tokens,
    contextWindow,
    lastTokenUsage: lastUsage,
    rateLimits,
  }
}
