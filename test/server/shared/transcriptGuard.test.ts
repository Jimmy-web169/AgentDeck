// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import { assertSizeUnder, isOversize, withOversizeFallback, MAX_TRANSCRIPT_BYTES } from '../../../server/shared/transcriptGuard.ts'

describe('transcriptGuard/shared/transcriptGuard', async () => {
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
    assert.ok(isOversize(thrown), 'expected a throw')
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

    assert.throws(
      () =>
        withOversizeFallback(
          () => {
            throw new Error('boom')
          },
          () => 'stub'
        ),
      /boom/
    )
  })

  test('default cap is 128 MB for both providers (shared constant)', () => {
    assert.equal(MAX_TRANSCRIPT_BYTES, 128 * 1024 * 1024)
  })
})
