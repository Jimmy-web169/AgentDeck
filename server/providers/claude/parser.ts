import type { NormalizedSummary } from '../../shared/parserTypes.ts'
import fs from 'node:fs'
import { jsonRecord, jsonArray, optionalString, optionalTimestamp, numberOrZero } from '../../shared/json.ts'
import type { TimelineEvent } from '../../../shared/types.d.ts'
type Part = NonNullable<TimelineEvent['parts']>[number]
type ToolResult = { content: string; isError: boolean }
import { guardTranscriptSize } from '../../shared/transcriptGuard.ts'
import { withTotal } from '../../shared/tokens.ts'

/**
 * Parse a Claude Code session .jsonl into raw records.
 * Each line is one JSON event; tolerate malformed/truncated trailing lines.
 */
export function readRecords(file: string): unknown[] {
  guardTranscriptSize(file, 'transcript') // 413 instead of an OOM-risk whole-file read
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

// ---- helpers ----------------------------------------------------------------

const STRIP_TAGS = /<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|system-reminder)[\s\S]*?<\/\1>/g

// Internal protocol/meta attachments — noise in a conversation view (Raw keeps them).
const NOISE_ATTACHMENTS = new Set(['deferred_tools_delta', 'mcp_instructions_delta', 'turn_duration', 'task_reminder', 'skill_listing', 'queued_command'])

/** Flatten a message.content (string | block[]) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: unknown) => b && (jsonRecord(b).type === 'text' || typeof b === 'string'))
    .map((b: unknown) => (typeof b === 'string' ? b : optionalString(jsonRecord(b).text) || ''))
    .join('\n')
}

function cleanSnippet(text: string, max = 140) {
  const t = (text || '').replace(STRIP_TAGS, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** Sum authoritative token usage from one assistant message.usage (no iterations[]). */
function usageOf(value: unknown) {
  if (!value) return null
  const usage = jsonRecord(value)
  return {
    input: numberOrZero(usage.input_tokens),
    output: numberOrZero(usage.output_tokens),
    cacheCreate: numberOrZero(usage.cache_creation_input_tokens),
    cacheRead: numberOrZero(usage.cache_read_input_tokens),
  }
}

function addUsage(a: NonNullable<ReturnType<typeof usageOf>>, b: ReturnType<typeof usageOf>) {
  if (!b) return a
  a.input += b.input
  a.output += b.output
  a.cacheCreate += b.cacheCreate
  a.cacheRead += b.cacheRead
  return a
}

// A user record is really a tool-result carrier (not a human turn) when its
// content is an array of tool_result blocks, or it carries toolUseResult.
function isToolResultCarrier(rec: Record<string, unknown>) {
  if (rec.toolUseResult !== undefined) return true
  const c = jsonRecord(rec.message).content
  if (Array.isArray(c) && c.length && c.every((b) => jsonRecord(b).type === 'tool_result')) return true
  return false
}

// Some user records are slash-command / meta envelopes with no real prose.
function isMetaUser(rec: Record<string, unknown>) {
  if (rec.isMeta === true) return true
  const text = contentToText(jsonRecord(rec.message).content)
  const stripped = text.replace(STRIP_TAGS, '').trim()
  return stripped.length === 0 && /<command-name>|<local-command-stdout>|<local-command-caveat>/.test(text)
}

// ---- timeline ---------------------------------------------------------------

/**
 * Build a normalized, ChatGPT-style timeline from raw records.
 * Pairs tool_use -> tool_result by tool_use_id across messages.
 */
export function buildTimeline(records: unknown[]): TimelineEvent[] {
  // 1) collect tool results by tool_use_id (from carrier user messages)
  const toolResults = new Map<string, ToolResult>()
  for (const rec of records.map(jsonRecord)) {
    const c = jsonRecord(rec.message).content
    if (Array.isArray(c)) {
      for (const b of c.map(jsonRecord)) {
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && b.tool_use_id) {
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
  const events: TimelineEvent[] = []
  for (const rec of records.map(jsonRecord)) {
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
      const atype = optionalString(jsonRecord(rec.attachment).type) || ''
      if (NOISE_ATTACHMENTS.has(atype)) continue
      events.push({
        kind: 'attachment',
        uuid: optionalString(rec.uuid),
        ts: optionalTimestamp(rec.timestamp),
        name: jsonRecord(rec.attachment).fileName || atype || 'attachment',
        detail: atype,
      })
    }
    // ignored for the main timeline (still available in raw view):
    // ai-title, custom-title, mode, permission-mode, last-prompt, file-history-snapshot, queue-operation
  }
  return events
}

function normalizeResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: unknown) => (typeof b === 'string' ? b : jsonRecord(b).type === 'text' ? jsonRecord(b).text : JSON.stringify(b))).join('\n')
  }
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}

function userEvent(rec: Record<string, unknown>): TimelineEvent {
  return {
    kind: 'user',
    uuid: optionalString(rec.uuid),
    ts: optionalTimestamp(rec.timestamp),
    origin: rec.origin || null,
    text: contentToText(jsonRecord(rec.message).content).replace(STRIP_TAGS, '').trim(),
  }
}

function assistantEvent(rec: Record<string, unknown>, toolResults: Map<string, ToolResult>): TimelineEvent {
  const parts: Part[] = []
  const content = jsonRecord(rec.message).content
  if (Array.isArray(content)) {
    for (const b of content.map(jsonRecord)) {
      if (!b?.type) continue
      if (b.type === 'text') {
        const text = optionalString(b.text)
        if (text?.trim()) parts.push({ kind: 'text', text })
      } else if (b.type === 'thinking') {
        parts.push({ kind: 'thinking', text: optionalString(b.thinking) || optionalString(b.text) || '' })
      } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        parts.push({
          kind: 'tool_call',
          id: optionalString(b.id),
          name: optionalString(b.name) || '',
          server: b.type === 'server_tool_use',
          input: b.input ?? {},
          result: typeof b.id === 'string' && b.id ? toolResults.get(b.id) || null : null,
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
    uuid: optionalString(rec.uuid),
    ts: optionalTimestamp(rec.timestamp),
    model: optionalString(jsonRecord(rec.message).model) || null,
    usage: usageOf(jsonRecord(rec.message).usage),
    isError: !!rec.isApiErrorMessage,
    isSidechain: !!rec.isSidechain,
    parts,
  }
}

function systemEvent(rec: Record<string, unknown>): TimelineEvent | null {
  // keep meaningful system notes; drop empty meta heartbeats
  const text = typeof rec.content === 'string' ? rec.content : ''
  if (!text && !rec.subtype) return null
  return {
    kind: 'system',
    uuid: optionalString(rec.uuid),
    ts: optionalTimestamp(rec.timestamp),
    subtype: optionalString(rec.subtype) || null,
    text: cleanSnippet(text, 600),
  }
}

// ---- session summary (list view) -------------------------------------------

export function summarize(records: unknown[], id: string): NormalizedSummary {
  let customTitle: string | null = null
  let aiTitle: string | null = null
  let firstPrompt: string | null = null
  let lastUserPrompt = '',
    lastUserPromptTs: string | number | null = null
  let firstTs: string | number | null = null
  let lastTs: string | number | null = null
  let userTurns = 0
  let assistantTurns = 0
  let toolCalls = 0
  let hasSidechain = false
  const models = new Set<string>()
  const toolCounts: Record<string, number> = {}
  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }

  for (const rec of records.map(jsonRecord)) {
    if (rec.timestamp) {
      if (!firstTs) firstTs = optionalTimestamp(rec.timestamp) || null
      lastTs = optionalTimestamp(rec.timestamp) || null
    }
    if (rec.isSidechain) hasSidechain = true

    if (rec.type === 'custom-title' && rec.customTitle) {
      customTitle = optionalString(rec.customTitle) || null
    } else if (rec.type === 'ai-title' && rec.aiTitle) {
      aiTitle = optionalString(rec.aiTitle) || null
    } else if (rec.type === 'assistant') {
      assistantTurns++
      const model = optionalString(jsonRecord(rec.message).model)
      if (model) models.add(model)
      addUsage(totals, usageOf(jsonRecord(rec.message).usage))
      const c = jsonRecord(rec.message).content
      if (Array.isArray(c)) {
        for (const b of c.map(jsonRecord)) {
          if (jsonRecord(b).type === 'tool_use' || jsonRecord(b).type === 'server_tool_use') {
            toolCalls++
            if (typeof b.name === 'string' && b.name) toolCounts[b.name] = (toolCounts[b.name] || 0) + 1
          }
        }
      }
    } else if (rec.type === 'user') {
      if (isToolResultCarrier(rec) || isMetaUser(rec)) continue
      userTurns++
      const txt = cleanSnippet(contentToText(jsonRecord(rec.message).content))
      if (!firstPrompt && txt) firstPrompt = txt
      const hasAttachment = jsonArray(jsonRecord(rec.message).content).some((p) => ['image', 'document'].includes(optionalString(jsonRecord(p).type) || ''))
      if (txt || hasAttachment) {
        lastUserPrompt = txt || '(Image or attachment)'
        lastUserPromptTs = optionalTimestamp(rec.timestamp) || null
      }
    }
  }

  return {
    id,
    title: customTitle || aiTitle || firstPrompt || '(untitled session)',
    firstPrompt: firstPrompt || '',
    lastUserPrompt,
    lastUserPromptTs,
    firstTs,
    lastTs,
    userTurns,
    assistantTurns,
    toolCalls,
    hasSidechain,
    models: [...models],
    toolCounts,
    tokens: withTotal(totals), // `total` is the provider's job (server/shared/tokens.ts)
  }
}
