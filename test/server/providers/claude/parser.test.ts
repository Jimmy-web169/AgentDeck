// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import { summarize, summarize as claude, summarize as claudeSummarize } from '../../../../server/providers/claude/parser.ts'

// Original test group: claude-parser-title. Assertions retained during module-path migration.

test('summarize: a /rename custom-title takes priority over the auto-generated ai-title', () => {
  const records = [
    { type: 'user', message: { content: 'first message' } },
    { type: 'ai-title', aiTitle: 'auto generated title' },
    { type: 'custom-title', customTitle: 'my renamed conversation' },
  ]

  const summary = summarize(records, 'sess-1')

  assert.equal(summary.title, 'my renamed conversation')
})

describe('latest-prompt/claude/parser', async () => {
  const first = '2026-09-01T12:00:00Z'

  const latest = '2026-09-01T12:01:00Z'

  const after = '2026-09-01T12:02:00Z'

  const ccUser = (
    content: string | { type: string; tool_use_id: string; content: string }[] | { type: string; source: Record<string, unknown> }[],
    timestamp: string
  ) => ({
    type: 'user',
    timestamp,
    message: { content },
  })

  test('Claude latest question is independent of title/first prompt and excludes tool/meta records', () => {
    const s = claude(
      [
        ccUser('Build an API', first),
        { type: 'custom-title', customTitle: 'Orbit API' },
        ccUser('請加上\n認證測試', latest),
        ccUser([{ type: 'tool_result', tool_use_id: 't1', content: 'tool output is not a question' }], after),
        ccUser('<command-name>/rename</command-name><command-args>Orbit API</command-args>', after),
        ccUser('<system-reminder>internal reminder</system-reminder>', after),
        { ...ccUser('internal metadata, not a question', after), isMeta: true },
        { type: 'assistant', timestamp: after, message: { content: [{ type: 'text', text: 'Done' }] } },
      ],
      'a'
    )
    assert.equal(s.title, 'Orbit API')
    assert.equal(s.firstPrompt, 'Build an API')
    assert.equal(s.lastUserPrompt, '請加上 認證測試')
    assert.equal(s.lastUserPromptTs, latest)
  })

  test('Claude attachment-only question replaces the old question; blank records do not', () => {
    const s = claude([ccUser('Read this image', first), ccUser([{ type: 'image', source: {} }], latest), ccUser('', after)], 'a')
    assert.equal(s.firstPrompt, 'Read this image')
    assert.equal(s.lastUserPrompt, '(Image or attachment)')
    assert.equal(s.lastUserPromptTs, latest)
  })
})

describe('transcriptGuard/claude/parser', async () => {
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
})

{
  const id = 'claude'
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { temporaryDirectory } = await import('../../../helpers/tmpConfigDir.ts')
  test(`${id} keeps raw JSON unknown while malformed scalar/object fields cannot crash normalized output`, async () => {
    const parser = await import('../../../../server/providers/claude/parser.ts')
    const directory = temporaryDirectory('parser-boundary-'),
      file = path.join(directory, 'native.jsonl')
    const values = [null, true, 3, 'text', {}, { type: 'assistant', timestamp: {}, message: { model: {}, content: [null, { type: 'text', text: 42 }] } }]
    fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join('\n') + '\n{"truncated":')
    const raw = parser.readRecords(file)
    assert.deepEqual(raw, values)
    assert.doesNotThrow(() => parser.buildTimeline(raw))
    const summary = parser.summarize(raw, 'fixture')
    assert.equal(summary.id, 'fixture')
    assert.ok(summary.models.every((model) => typeof model === 'string' && model !== '[object Object]'))
    assert.equal(summary.firstTs, null)
  })
}
