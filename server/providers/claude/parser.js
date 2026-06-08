import fs from 'node:fs'

/**
 * Parse a Claude Code session .jsonl into raw records.
 * Each line is one JSON event; tolerate malformed/truncated trailing lines.
 */
export function readRecords(file) {
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

// ---- helpers ----------------------------------------------------------------

const STRIP_TAGS = /<(command-name|command-message|command-args|local-command-stdout|system-reminder)[\s\S]*?<\/\1>/g

// Internal protocol/meta attachments — noise in a conversation view (Raw keeps them).
const NOISE_ATTACHMENTS = new Set([
  'deferred_tools_delta',
  'mcp_instructions_delta',
  'turn_duration',
  'task_reminder',
  'skill_listing',
  'queued_command',
])

/** Flatten a message.content (string | block[]) to plain text. */
function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && (b.type === 'text' || typeof b === 'string'))
    .map((b) => (typeof b === 'string' ? b : b.text || ''))
    .join('\n')
}

function cleanSnippet(text, max = 140) {
  const t = (text || '').replace(STRIP_TAGS, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** Sum authoritative token usage from one assistant message.usage (no iterations[]). */
function usageOf(usage) {
  if (!usage) return null
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheCreate: usage.cache_creation_input_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
  }
}

function addUsage(a, b) {
  if (!b) return a
  a.input += b.input
  a.output += b.output
  a.cacheCreate += b.cacheCreate
  a.cacheRead += b.cacheRead
  return a
}

// A user record is really a tool-result carrier (not a human turn) when its
// content is an array of tool_result blocks, or it carries toolUseResult.
function isToolResultCarrier(rec) {
  if (rec.toolUseResult !== undefined) return true
  const c = rec.message?.content
  if (Array.isArray(c) && c.length && c.every((b) => b?.type === 'tool_result')) return true
  return false
}

// Some user records are slash-command / meta envelopes with no real prose.
function isMetaUser(rec) {
  const text = contentToText(rec.message?.content)
  const stripped = text.replace(STRIP_TAGS, '').trim()
  return stripped.length === 0 && /<command-name>|<local-command-stdout>/.test(text)
}

// ---- timeline ---------------------------------------------------------------

/**
 * Build a normalized, ChatGPT-style timeline from raw records.
 * Pairs tool_use -> tool_result by tool_use_id across messages.
 */
export function buildTimeline(records) {
  // 1) collect tool results by tool_use_id (from carrier user messages)
  const toolResults = new Map()
  for (const rec of records) {
    const c = rec.message?.content
    if (Array.isArray(c)) {
      for (const b of c) {
        if (b?.type === 'tool_result' && b.tool_use_id) {
          toolResults.set(b.tool_use_id, {
            content: normalizeResultContent(b.content),
            isError: !!b.is_error,
          })
        }
      }
    }
    // legacy/top-level toolUseResult — keep raw for the inspector
  }

  // 2) walk records in file (chronological) order, emitting events
  const events = []
  for (const rec of records) {
    const t = rec.type
    if (t === 'assistant') {
      events.push(assistantEvent(rec, toolResults))
    } else if (t === 'user') {
      if (isToolResultCarrier(rec) || isMetaUser(rec)) continue // merged into tool cards
      events.push(userEvent(rec))
    } else if (t === 'system') {
      const ev = systemEvent(rec)
      if (ev) events.push(ev)
    } else if (t === 'attachment') {
      // internal protocol deltas carry no conversational value -> keep them out
      // of the main timeline (still visible in the Raw tab).
      const atype = rec.attachment?.type || ''
      if (NOISE_ATTACHMENTS.has(atype)) continue
      events.push({
        kind: 'attachment',
        uuid: rec.uuid,
        ts: rec.timestamp,
        name: rec.attachment?.fileName || atype || 'attachment',
        detail: atype,
      })
    }
    // ignored for the main timeline (still available in raw view):
    // ai-title, mode, permission-mode, last-prompt, file-history-snapshot, queue-operation
  }
  return events
}

function normalizeResultContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : b.type === 'text' ? b.text : JSON.stringify(b)))
      .join('\n')
  }
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}

function userEvent(rec) {
  return {
    kind: 'user',
    uuid: rec.uuid,
    ts: rec.timestamp,
    origin: rec.origin || null,
    text: contentToText(rec.message?.content).replace(STRIP_TAGS, '').trim(),
  }
}

function assistantEvent(rec, toolResults) {
  const parts = []
  const content = rec.message?.content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || !b.type) continue
      if (b.type === 'text') {
        if (b.text?.trim()) parts.push({ kind: 'text', text: b.text })
      } else if (b.type === 'thinking') {
        parts.push({ kind: 'thinking', text: b.thinking || b.text || '' })
      } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        parts.push({
          kind: 'tool_use',
          id: b.id,
          name: b.name,
          server: b.type === 'server_tool_use',
          input: b.input ?? {},
          result: b.id ? toolResults.get(b.id) || null : null,
        })
      } else if (b.type === 'advisor_tool_result') {
        parts.push({ kind: 'advisor', text: normalizeResultContent(b.content) })
      } else if (b.type === 'redacted_thinking') {
        parts.push({ kind: 'thinking', text: '[redacted thinking]', redacted: true })
      }
    }
  } else if (typeof content === 'string' && content.trim()) {
    parts.push({ kind: 'text', text: content })
  }

  return {
    kind: 'assistant',
    uuid: rec.uuid,
    ts: rec.timestamp,
    model: rec.message?.model || null,
    usage: usageOf(rec.message?.usage),
    isError: !!rec.isApiErrorMessage,
    isSidechain: !!rec.isSidechain,
    parts,
  }
}

function systemEvent(rec) {
  // keep meaningful system notes; drop empty meta heartbeats
  const text = typeof rec.content === 'string' ? rec.content : ''
  if (!text && !rec.subtype) return null
  return {
    kind: 'system',
    uuid: rec.uuid,
    ts: rec.timestamp,
    subtype: rec.subtype || null,
    text: cleanSnippet(text, 600),
  }
}

// ---- session summary (list view) -------------------------------------------

export function summarize(records, id) {
  let title = null
  let firstPrompt = null
  let firstTs = null
  let lastTs = null
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  let hasSidechain = false
  const models = new Set()
  const toolCounts = {}
  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }

  for (const rec of records) {
    if (rec.timestamp) {
      if (!firstTs) firstTs = rec.timestamp
      lastTs = rec.timestamp
    }
    if (rec.isSidechain) hasSidechain = true

    if (rec.type === 'ai-title' && rec.aiTitle) {
      title = rec.aiTitle
    } else if (rec.type === 'assistant') {
      assistantTurns++
      if (rec.message?.model) models.add(rec.message.model)
      addUsage(totals, usageOf(rec.message?.usage))
      const c = rec.message?.content
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
            toolCalls++
            if (b.name) toolCounts[b.name] = (toolCounts[b.name] || 0) + 1
          }
        }
      }
    } else if (rec.type === 'user') {
      if (isToolResultCarrier(rec) || isMetaUser(rec)) continue
      userTurns++
      if (!firstPrompt) {
        const txt = cleanSnippet(contentToText(rec.message?.content))
        if (txt) firstPrompt = txt
      }
    }
  }

  return {
    id,
    title: title || firstPrompt || '(untitled session)',
    firstPrompt: firstPrompt || '',
    firstTs,
    lastTs,
    userTurns,
    assistantTurns,
    toolCalls,
    hasSidechain,
    models: [...models],
    toolCounts,
    tokens: totals,
  }
}
