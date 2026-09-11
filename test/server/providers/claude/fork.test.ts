// Original groups remain named below; test assertions are unchanged.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { forkLines as claudeFork } from '../../../../server/providers/claude/fork.ts'

describe('fork/claude/fork', async () => {
  const J = (o: {
    type: string
    op?: string
    uuid?: string
    sessionId?: string
    message?:
      | { role: string; content: string }
      | { role: string; content: { type: string; text: string }[] }
      | { role: string; content: string }
      | { role: string; content: { type: string; text: string }[] }
    parentUuid?: string
    prompt?: string
  }) => JSON.stringify(o)

  // ---- claude -----------------------------------------------------------------

  const claudeSession = [
    J({ type: 'queue-operation', op: 'enqueue' }),
    J({ type: 'user', uuid: 'u1', sessionId: 'old', message: { role: 'user', content: 'say APPLE' } }),
    J({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 'old', message: { role: 'assistant', content: [{ type: 'text', text: 'APPLE' }] } }),
    J({ type: 'attachment', uuid: 'at1', parentUuid: 'a1', sessionId: 'old' }),
    J({ type: 'last-prompt', prompt: 'say APPLE' }),
    J({ type: 'queue-operation', op: 'enqueue' }),
    J({ type: 'user', uuid: 'u2', sessionId: 'old', message: { role: 'user', content: 'say BANANA' } }),
    J({ type: 'assistant', uuid: 'a2', parentUuid: 'u2', sessionId: 'old', message: { role: 'assistant', content: [{ type: 'text', text: 'BANANA' }] } }),
  ]

  test('claude fork cuts before the given user uuid and rewrites sessionId', () => {
    const out = claudeFork(claudeSession, 'u2', 'new-id')
    const recs = out.map((l) => JSON.parse(l))
    // second turn (and its preceding queue metadata) gone
    assert.ok(!recs.some((r) => r.uuid === 'u2' || r.uuid === 'a2'))
    assert.equal(recs.filter((r) => r.type === 'queue-operation').length, 1)
    // history before the cut kept, every sessionId rewritten
    assert.ok(recs.some((r) => r.uuid === 'u1'))
    assert.ok(recs.some((r) => r.uuid === 'a1'))
    for (const r of recs) if ('sessionId' in r) assert.equal(r.sessionId, 'new-id')
  })

  test('claude fork without a cut copies the whole transcript', () => {
    const out = claudeFork(claudeSession, null, 'new-id')
    assert.equal(out.length, claudeSession.length)
    assert.ok(out.some((l) => JSON.parse(l).uuid === 'a2'))
  })

  test('claude fork rejects an unknown cut point', () => {
    assert.throws(() => claudeFork(claudeSession, 'nope', 'new-id'), /cut point not found/)
  })

  test('claude fork refuses an empty result', () => {
    assert.throws(() => claudeFork(claudeSession.slice(0, 2), 'u1', 'new-id'), /empty/)
  })

  test('claude fork preserves unparsable lines before the cut', () => {
    const lines = ['not json at all', ...claudeSession]
    const out = claudeFork(lines, 'u2', 'new-id')
    assert.equal(out[0], 'not json at all')
  })
})
