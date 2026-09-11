// Original groups remain named below; test assertions are unchanged.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { forkLines as codexFork } from '../../../../server/providers/codex/fork.ts'

describe('fork/codex/fork', async () => {
  const J = (o: unknown) => JSON.stringify(o)

  // ---- codex ------------------------------------------------------------------

  const meta = { type: 'session_meta', payload: { id: 'old-id', cwd: '/tmp/p' } }

  const codexTurn = (_n: number, word: string) => [
    J({ type: 'event_msg', payload: { type: 'task_started' } }),
    J({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] },
    }),
    J({ type: 'turn_context', payload: { model: 'gpt-5.1-codex' } }),
    J({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `say ${word}` }] } }),
    J({ type: 'event_msg', payload: { type: 'user_message', message: `say ${word}` } }),
    J({ type: 'event_msg', payload: { type: 'agent_message', message: word } }),
    J({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: word }] } }),
    J({ type: 'event_msg', payload: { type: 'task_complete' } }),
  ]

  const codexSession = [J(meta), ...codexTurn(1, 'APPLE'), ...codexTurn(2, 'BANANA')]

  test('codex fork cuts before the Nth user turn including its scaffolding', () => {
    const out = codexFork(codexSession, 2, 'new-id')
    const text = out.join('\n')
    assert.ok(!text.includes('BANANA'))
    assert.ok(text.includes('APPLE'))
    // turn 2's scaffolding is gone: exactly one task_started remains
    assert.equal(out.filter((l) => l.includes('task_started')).length, 1)
    // last kept line is turn 1's task_complete, not a dangling turn header
    assert.ok(out[out.length - 1].includes('task_complete'))
  })

  test('codex fork rewrites the session_meta id', () => {
    const out = codexFork(codexSession, 2, 'new-id')
    const head = JSON.parse(out[0])
    assert.equal(head.payload.id, 'new-id')
    assert.equal(head.payload.cwd, '/tmp/p')
  })

  test('codex fork without a cut copies everything under the new id', () => {
    const out = codexFork(codexSession, null, 'new-id')
    assert.equal(out.length, codexSession.length)
    assert.ok(out.join('\n').includes('BANANA'))
    assert.equal(JSON.parse(out[0]).payload.id, 'new-id')
  })

  test('codex fork rejects an out-of-range cut and an empty result', () => {
    assert.throws(() => codexFork(codexSession, 5, 'new-id'), /cut point not found/)
    assert.throws(() => codexFork(codexSession, 1, 'new-id'), /empty/)
  })

  test('codex fork counts response_item user messages when the event layer is absent', () => {
    const legacy = [
      J({ id: 'old-id', timestamp: 't', instructions: 'sys' }),
      J({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first' }] }),
      J({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'one' }] }),
      J({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second' }] }),
      J({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'two' }] }),
    ]
    const out = codexFork(legacy, 2, 'new-id')
    assert.equal(out.length, 3)
    assert.ok(!out.join('\n').includes('second'))
    assert.equal(JSON.parse(out[0]).id, 'new-id') // legacy bare header rewritten
  })
})
