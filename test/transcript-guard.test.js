import test from 'node:test'
import assert from 'node:assert/strict'

import { assertSizeUnder, isOversize, withOversizeFallback, MAX_TRANSCRIPT_BYTES } from '../server/shared/transcriptGuard.js'
import { summarize as claudeSummarize } from '../server/providers/claude/parser.js'
import { summarize as codexSummarize } from '../server/providers/codex/parser.js'

test('assertSizeUnder: sizes at or under the limit pass', () => {
  assertSizeUnder(0, 'transcript', 100)
  assertSizeUnder(100, 'transcript', 100)
})

test('assertSizeUnder: over the limit throws a 413 tagged as oversize', () => {
  let thrown = null
  try {
    assertSizeUnder(101, 'transcript', 100)
  } catch (e) {
    thrown = e
  }
  assert.ok(thrown, 'expected a throw')
  assert.equal(thrown.status, 413)
  assert.equal(thrown.bytes, 101)
  assert.ok(isOversize(thrown))
  assert.ok(!isOversize(new Error('unrelated')))
})

test('withOversizeFallback: oversize degrades to the fallback, other errors propagate', () => {
  const stub = withOversizeFallback(
    () => assertSizeUnder(2, 'x', 1),
    (e) => ({ stub: true, bytes: e.bytes })
  )
  assert.deepEqual(stub, { stub: true, bytes: 2 })

  assert.throws(() => withOversizeFallback(() => {
    throw new Error('boom')
  }, () => 'stub'), /boom/)
})

test('default cap is 128 MB for both providers (shared constant)', () => {
  assert.equal(MAX_TRANSCRIPT_BYTES, 128 * 1024 * 1024)
})

// The list endpoints build their oversize stubs from `summarize([], id)` — lock
// in that zero records yields a complete, zero-valued summary in both providers.
test('summarize([]) keeps the full summary shape (stub base) — claude', () => {
  const s = claudeSummarize([], 'sess-1')
  assert.equal(s.id, 'sess-1')
  assert.equal(s.title, '(untitled session)')
  assert.deepEqual(s.models, [])
  assert.deepEqual(s.toolCounts, {})
  assert.equal(s.userTurns, 0)
  assert.equal(typeof s.tokens, 'object')
})

test('summarize([]) keeps the full summary shape (stub base) — codex', () => {
  const s = codexSummarize([], 'sess-2')
  assert.equal(s.id, 'sess-2')
  assert.equal(s.title, '(untitled session)')
  assert.deepEqual(s.models, [])
  assert.deepEqual(s.toolCounts, {})
  assert.equal(s.userTurns, 0)
  assert.equal(typeof s.tokens, 'object')
})
