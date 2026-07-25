import test from 'node:test'
import assert from 'node:assert/strict'

import { summarize } from '../server/providers/claude/parser.js'

test('summarize: a /rename custom-title takes priority over the auto-generated ai-title', () => {
  const records = [
    { type: 'user', message: { content: 'first message' } },
    { type: 'ai-title', aiTitle: 'auto generated title' },
    { type: 'custom-title', customTitle: 'my renamed conversation' },
  ]

  const summary = summarize(records, 'sess-1')

  assert.equal(summary.title, 'my renamed conversation')
})
