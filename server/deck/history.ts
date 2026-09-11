import { historySourceKey } from '../../shared/identity.ts'
import crypto from 'node:crypto'
import type { makeDispatch } from '../shared/dispatch.ts'
import type { TimelineEvent, SessionSummary, Target } from '../../shared/types.d.ts'
import { jsonRecord } from '../shared/json.ts'

const error = (status: number, message: string) => Object.assign(new Error(message), { status })
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const callsOf = (timeline: TimelineEvent[] | null | undefined) => (timeline || []).flatMap((e) => (e.parts || []).filter((p) => p.kind === 'tool_call'))

// Provider adapters describe where conversations live. Export policy and file
// format stay shared; a new provider implements this contract, not UI branches.
export interface HistorySource extends Target {
  provider: string
  root: string
  id: string
  agent?: string
  group?: string | null
}
interface HistoryBody {
  timeline: TimelineEvent[]
  summary?: Partial<Pick<SessionSummary, 'cwd' | 'oversized'>>
  _etag?: string
  slug?: string
}
interface Child {
  source: HistorySource
  toolUseId?: string | null
  depth?: number | null
  oversized?: boolean
}
interface Reader {
  nested?: boolean
  read(source: HistorySource): Promise<HistoryBody>
  children(source: HistorySource): Promise<Child[]>
}
export interface HistoryWarning {
  code: string
  parentConversationId?: string
  conversationId?: string
  sourceSessionId?: string
  status?: number
}
interface Message {
  type: 'message'
  conversationId: string
  sequence: number
  sourceIndex: number
  role: 'user' | 'assistant'
  timestamp: string | number | null
  text: string
}
interface Pending extends Child {
  parent: string | null
}
interface Node extends Pending {
  conversationId: string
  body: HistoryBody
  messages: Message[]
  children: Child[]
}
const statusOf = (error: unknown, fallback: number) => (typeof jsonRecord(error).status === 'number' ? (jsonRecord(error).status as number) : fallback)
export function historyReader(dispatch: ReturnType<typeof makeDispatch>, { nested = false } = {}): Reader {
  const get = async <T>(route: string, values: Record<string, string | null | undefined>): Promise<T> => {
    const query = new URLSearchParams(Object.entries(values).filter((entry): entry is [string, string] => entry[1] != null))
    const result = await dispatch('GET', route, query)
    if (result.status !== 200) throw error(result.status, 'Conversation could not be read.')
    return result.body as T
  }
  return {
    nested,
    read: (source) =>
      source.agent
        ? get<HistoryBody>('/api/subagent', { root: source.root, slug: source.slug, session: source.id, agent: source.agent, run: source.group })
        : get<HistoryBody>('/api/session', { root: source.root, slug: source.slug, id: source.id }),
    children: async (source) => {
      if (source.agent) return [] // nested sidecars are all listed by the owner
      const result = await get<{
        children: { id: string; kind?: string; group?: string | null; toolUseId?: string | null; depth?: number | null; oversized?: boolean }[]
      }>('/api/subagents', { root: source.root, slug: source.slug, id: source.id })
      if (!Array.isArray(result.children)) throw error(409, 'Provider cannot enumerate subagents.')
      return result.children.map((c) => ({
        source: c.kind === 'agent' ? { ...source, agent: c.id, group: c.group || null } : { ...source, id: c.id },
        toolUseId: c.toolUseId || null,
        depth: c.depth ?? null,
        oversized: !!c.oversized,
      }))
    },
  }
}

export function visibleMessages(timeline: TimelineEvent[] | null | undefined, conversationId: string): Message[] {
  let sequence = 0
  return (timeline || []).flatMap((event, sourceIndex) => {
    if (event.kind !== 'user' && event.kind !== 'assistant') return []
    const text =
      typeof event.text === 'string'
        ? event.text
        : (event.parts || [])
            .filter((p) => p.kind === 'text')
            .map((p) => p.text || '')
            .join('\n')
    if (!text.trim()) return []
    return [{ type: 'message', conversationId, sequence: sequence++, sourceIndex, role: event.kind, timestamp: event.ts || null, text }]
  })
}

// Safety ceilings reject an export; they NEVER truncate or pass off a tail as
// full history. Provider-native parse limits can also reject large transcripts.
const MAX_CONVERSATIONS = 1000
const MAX_TEXT_BYTES = 64 * 1024 * 1024
export async function captureHistory(reader: Reader, source: HistorySource) {
  const capture = async () => {
    const nodes: Node[] = [],
      warnings: HistoryWarning[] = [],
      seen = new Set<string>(),
      queue: Pending[] = [{ source, parent: null }]
    let bytes = 0
    while (queue.length) {
      const item = queue.shift()
      if (!item) break
      const nativeKey = historySourceKey(item.source)
      if (seen.has(nativeKey)) {
        warnings.push({ code: 'repeated_or_cyclic_reference' })
        continue
      }
      if (seen.size >= MAX_CONVERSATIONS) throw error(413, 'History exceeds 1000 conversations. No shortened export was produced.')
      seen.add(nativeKey)
      const conversationId = `c${nodes.length}`
      let body: HistoryBody,
        children: Child[] = []
      try {
        if (item.oversized) throw error(413, 'Oversized child')
        body = await reader.read(item.source)
        if (!body._etag || !Array.isArray(body.timeline) || body.summary?.oversized)
          throw error(409, 'Provider cannot supply a complete, fingerprinted transcript.')
      } catch (e) {
        if (!item.parent) throw error(statusOf(e, 409), 'Source history is unavailable or exceeds the provider parse limit. Nothing was exported.')
        warnings.push({
          code: 'subagent_unavailable',
          parentConversationId: item.parent,
          sourceSessionId: item.source.agent || item.source.id,
          status: statusOf(e, 500),
        })
        continue
      }
      const locator = { ...item.source, slug: item.source.slug || body.slug }
      try {
        children = await reader.children(locator)
      } catch (e) {
        warnings.push({ code: 'subagent_discovery_failed', conversationId, status: statusOf(e, 500) })
      }
      children.sort((a, b) => historySourceKey(a.source).localeCompare(historySourceKey(b.source)))
      const messages = visibleMessages(body.timeline, conversationId)
      bytes += messages.reduce((n, m) => n + Buffer.byteLength(m.text), 0)
      if (bytes > MAX_TEXT_BYTES) throw error(413, 'History exceeds the 64 MiB export safety limit. No shortened export was produced.')
      nodes.push({ ...item, conversationId, body, messages, children })
      for (const child of children) queue.push({ ...child, parent: conversationId })
    }
    // Claude stores descendants beside their siblings. Resolve the real parent
    // from exact spawn tool IDs before dropping all tool payloads from export.
    if (reader.nested) {
      for (const node of nodes.slice(1)) {
        const owners = node.toolUseId ? nodes.filter((n) => callsOf(n.body.timeline).some((p) => p.id === node.toolUseId)) : []
        if (owners.length === 1 && owners[0] !== node) node.parent = owners[0].conversationId
        else if ((node.depth || 0) > 1 || owners.length > 1) {
          node.parent = null
          warnings.push({ code: 'subagent_parent_unresolved', conversationId: node.conversationId })
        }
      }
    }
    const parentOf = new Map(nodes.map((n) => [n.conversationId, n.parent]))
    for (const node of nodes) {
      const parents = new Set([node.conversationId])
      for (let p = node.parent; p; p = parentOf.get(p) ?? null) {
        if (parents.has(p)) {
          node.parent = null
          warnings.push({ code: 'subagent_parent_cycle', conversationId: node.conversationId })
          break
        }
        parents.add(p)
      }
    }
    const records = nodes.flatMap((n) => [
      {
        type: 'conversation' as const,
        conversationId: n.conversationId,
        parentConversationId: n.parent,
        kind: n.conversationId === 'c0' ? 'main' : 'subagent',
        sourceSessionId: n.source.agent || n.source.id,
      },
      ...n.messages,
    ])
    const signature = hash({
      records,
      warnings,
      cwd: nodes[0]?.body.summary?.cwd || null,
      fingerprints: nodes.map((n) => n.body._etag),
      children: nodes.map((n) => n.children),
    })
    return {
      records,
      warnings,
      signature,
      cwd: nodes[0]?.body.summary?.cwd || null,
      conversationCount: nodes.length,
      messageCount: nodes.reduce((n, c) => n + c.messages.length, 0),
      complete: warnings.length === 0,
    }
  }
  let previous = await capture()
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await capture()
    if (previous.signature === current.signature) {
      if (!current.messageCount) throw error(400, 'No visible conversation messages to export.')
      return current
    }
    previous = current
  }
  throw error(409, 'The conversation or its subagents are still changing. Wait briefly and export again; no partial tail was saved.')
}
