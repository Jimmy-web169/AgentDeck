import assert from 'node:assert/strict'
import test from 'node:test'
import { assertContract } from '../helpers/fixture.ts'

test('timeline contract distinguishes each provider part and rejects unregistered vocabulary', () => {
  for (const kind of ['text', 'thinking', 'advisor']) {
    assertContract('TimelineEvent', { kind: 'assistant', ts: null, parts: [{ kind, text: '' }] })
    assert.throws(() => assertContract('TimelineEvent', { kind: 'assistant', parts: [{ kind }] }))
  }
  assertContract('TimelineEvent', { kind: 'attachment', name: 'document', ts: null })
  assertContract('TimelineEvent', { kind: 'assistant', parts: [{ kind: 'tool_call', id: 'tool', name: 'Read', input: { file: 'README.md' }, result: null }] })
  assert.throws(() => assertContract('TimelineEvent', { kind: 'assistant', parts: [{ kind: 'unregistered' }] }))
  assert.throws(() => assertContract('TimelineEvent', { kind: 'unregistered' }))
})

test('shared contracts reject malformed known fields while allowing provider extensions', () => {
  assertContract('ChangeEvent', { provider: 'future', root: 'r', id: null, futureField: true })
  assert.throws(() => assertContract('ChangeEvent', { provider: 'future' }))
  assert.throws(() => assertContract('ChangeEvent', { provider: 'future', root: 1 }))
  assertContract('Target', { provider: null, view: 'stats', homeScope: { excluded: [] } })
  assertContract('Target', { provider: null, view: 'activity', homeSource: null })
  assertContract('Target', { provider: 'future', root: 'r', draft: true, launchId: 'parallel-draft' })
  assert.throws(() => assertContract('Target', { draft: 'yes' }))
  assertContract('TerminalEntry', { key: 'legacy|key', provider: 'future', root: 'r', launchId: null })
  assertContract('TerminalEntry', { key: 'new|draft', provider: 'future', root: 'r', title: null })
  assert.throws(() => assertContract('TerminalEntry', { key: 123 }))
  assertContract('Usage', { rateLimits: null, sessionId: null, ts: null, contextWindow: null })
  assertContract('Usage', { rateLimits: { primary: { used_percent: 50 } }, sessionId: 's', ts: 1, contextWindow: { used_percentage: 20 } })
  assert.throws(() => assertContract('Usage', { rateLimits: false, sessionId: null, ts: null }))
})
