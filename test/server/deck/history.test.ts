import type { TimelineEvent } from '../../../shared/types.d.ts'
import type { HistorySource } from '../../../server/deck/history.ts'
type Reader = ReturnType<typeof historyReader>
// History projection and provider-child adapter behavior.
import test from 'node:test'
import assert from 'node:assert/strict'
import { captureHistory, historyReader, visibleMessages } from '../../../server/deck/history.ts'
const text = (role: TimelineEvent['kind'], value: string | null, parts?: TimelineEvent['parts']): TimelineEvent => ({
  kind: role,
  ts: '2026-09-09T00:00:00Z',
  ...(parts ? { parts } : { text: value || '' }),
})

test('visible history has no last-N/30k clipping and excludes system/thinking/tool output', () => {
  const timeline = Array.from({ length: 80 }, (_, i) => text(i % 2 ? 'assistant' : 'user', `message ${i}`))
  timeline.push(text('user', '大'.repeat(40000)))
  timeline.push(text('system', 'hidden system'))
  timeline.push(
    text('assistant', null, [
      { kind: 'thinking', text: 'hidden thoughts' },
      { kind: 'tool_call', name: 'fixture', input: 'private tool input', result: { content: 'private tool output' } },
      { kind: 'text', text: 'final answer' },
    ])
  )
  const messages = visibleMessages(timeline, 'c0')
  assert.equal(messages.length, 82)
  assert.equal(messages[0].text, 'message 0')
  assert.equal(messages[80].text.length, 40000)
  assert.equal(messages[81].text, 'final answer')
  assert.doesNotMatch(JSON.stringify(messages), /hidden|private tool/)
})

test('independent subagent tree includes descendants and preserves per-conversation order', async () => {
  const reader: Reader = {
    read: async (s) => ({ _etag: s.id, summary: { cwd: '/old/project' }, timeline: [text('user', `${s.id} task`), text('assistant', `${s.id} result`)] }),
    children: async (s: HistorySource) =>
      s.id === 'main' ? [{ source: { ...s, id: 'child' } }] : s.id === 'child' ? [{ source: { ...s, id: 'grandchild' } }] : [],
  }
  const result = await captureHistory(reader, { provider: 'future', root: 'r', id: 'main' })
  assert.equal(result.complete, true)
  assert.equal(result.messageCount, 6)
  assert.deepEqual(
    result.records.filter((r) => r.type === 'conversation').map((r) => [r.conversationId, r.parentConversationId]),
    [
      ['c0', null],
      ['c1', 'c0'],
      ['c2', 'c1'],
    ]
  )
  assert.deepEqual(
    result.records.filter((r) => r.type === 'message').map((r) => r.sequence),
    [0, 1, 0, 1, 0, 1]
  )
})

test('nested sidecars resolve exact parent tool ID, without exporting the tool itself', async () => {
  const reader: Reader = {
    nested: true,
    read: async (s: HistorySource) => ({
      _etag: s.agent || 'main',
      timeline: [
        text('user', s.agent || 'main'),
        text('assistant', null, [{ kind: 'tool_call', name: 'fixture', id: s.agent === 'a' ? 'spawn-b' : 'spawn-a', input: 'DO NOT EXPORT' }]),
      ],
    }),
    children: async (s) =>
      s.agent
        ? []
        : [
            { source: { ...s, id: 'main', agent: 'a' }, toolUseId: 'spawn-a', depth: 1 },
            { source: { ...s, id: 'main', agent: 'b' }, toolUseId: 'spawn-b', depth: 2 },
          ],
  }
  // Only the root owns spawn-a (do not duplicate it in b).
  const original = reader.read
  reader.read = async (s) => (s.agent === 'b' ? { _etag: 'b', timeline: [text('assistant', 'child result')] } : original(s))
  const result = await captureHistory(reader, { provider: 'future', root: 'r', id: 'main' })
  assert.equal(result.complete, true)
  assert.equal(result.records.filter((r) => r.type === 'conversation').find((r) => r.sourceSessionId === 'b')?.parentConversationId, 'c1')
  assert.doesNotMatch(JSON.stringify(result.records), /DO NOT EXPORT|spawn-b/)
})

test('changes in a descendant prevent claiming a stable complete capture', async () => {
  let n = 0
  const reader: Reader = {
    read: async (s: HistorySource) => ({ _etag: s.id === 'child' ? String(n++) : 'root', timeline: [text('user', 'task')] }),
    children: async (s: HistorySource) => (s.id === 'main' ? [{ source: { ...s, id: 'child' } }] : []),
  }
  await assert.rejects(captureHistory(reader, { provider: 'future', root: 'r', id: 'main' }), /still changing/)
})

test('history adapter uses the appropriate child API without leaking locators into exported records', async () => {
  const calls: unknown[][] = []
  const reader = historyReader(
    async (_m, route, q) => {
      calls.push([route, Object.fromEntries(q)])
      return { status: 200, body: route === '/api/subagents' ? { children: [{ kind: 'agent', id: 'child', group: 'wf_test' }] } : {} }
    },
    { nested: true }
  )
  const [child] = await reader.children({ provider: 'future', root: 'r', slug: '/old/project', id: 'main' })
  await reader.read(child.source)
  assert.equal(calls[1][0], '/api/subagent')
  assert.deepEqual(calls[1][1], { root: 'r', slug: '/old/project', session: 'main', agent: 'child', run: 'wf_test' })
  assert.deepEqual(await reader.children(child.source), [])
})
