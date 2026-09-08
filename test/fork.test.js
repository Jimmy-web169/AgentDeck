import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forkLines as claudeFork } from '../server/providers/claude/fork.js'
import { forkLines as codexFork } from '../server/providers/codex/fork.js'

const J = (o) => JSON.stringify(o)

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

// ---- codex ------------------------------------------------------------------

const meta = { type: 'session_meta', payload: { id: 'old-id', cwd: '/tmp/p' } }
const codexTurn = (n, word) => [
  J({ type: 'event_msg', payload: { type: 'task_started' } }),
  J({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } }),
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
