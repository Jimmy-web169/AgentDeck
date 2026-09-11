// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import { summarize as codex, summarize as codexSummarize } from '../../../../server/providers/codex/parser.ts'

describe('latest-prompt/codex/parser', async () => {
  const first = '2026-09-01T12:00:00Z'

  const latest = '2026-09-01T12:01:00Z'

  const after = '2026-09-01T12:02:00Z'

  const cxEvent = (type: string, payload: { message?: string; thread_name?: string; images?: string[] }, timestamp: string) => ({
    type: 'event_msg',
    timestamp,
    payload: { type, ...payload },
  })

  const cxUser = (text: string, timestamp: string) => ({
    type: 'response_item',
    timestamp,
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  })

  test('Codex event messages stay authoritative over duplicated response items', () => {
    const s = codex(
      [
        cxEvent('user_message', { message: 'Build an API' }, first),
        cxUser('Build an API', first),
        cxEvent('thread_name_updated', { thread_name: 'Orbit API' }, first),
        cxEvent('user_message', { message: '<environment_context>cwd</environment_context> Add authentication tests' }, latest),
        cxUser('Add authentication tests', after),
        cxEvent('agent_message', { message: 'Done' }, after),
        { type: 'response_item', timestamp: after, payload: { type: 'function_call_output', call_id: 't1', output: 'not a question' } },
      ],
      'a'
    )
    assert.equal(s.title, 'Orbit API')
    assert.equal(s.firstPrompt, 'Build an API')
    assert.equal(s.lastUserPrompt, 'Add authentication tests')
    assert.equal(s.lastUserPromptTs, latest)
    assert.equal(s.userTurns, 2)
  })

  test('Codex legacy user items strip environment/instructions and skip system/assistant content', () => {
    const s = codex(
      [
        cxUser('First question', first),
        cxUser('<user_instructions>project settings</user_instructions> Latest question', latest),
        cxUser('<environment_context>new cwd</environment_context>', after),
        { type: 'message', timestamp: after, role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
      ],
      'a'
    )
    assert.equal(s.lastUserPrompt, 'Latest question')
    assert.equal(s.lastUserPromptTs, latest)
  })

  test('Codex recognizes known attachment-only records in both formats', () => {
    for (const records of [
      [cxEvent('user_message', { message: 'Read image' }, first), cxEvent('user_message', { message: '', images: ['image'] }, latest)],
      [
        cxUser('Read image', first),
        { type: 'response_item', timestamp: latest, payload: { type: 'message', role: 'user', content: [null, { type: 'input_image', image_url: 'image' }] } },
      ],
    ]) {
      const s = codex(records, 'a')
      assert.equal(s.lastUserPrompt, '(Image or attachment)')
      assert.equal(s.lastUserPromptTs, latest)
    }
  })
})

describe('transcriptGuard/codex/parser', async () => {
  test('summarize([]) keeps the full summary shape (stub base) — codex', () => {
    const s = codexSummarize([], 'sess-2')
    assert.equal(s.id, 'sess-2')
    assert.equal(s.title, '(untitled session)')
    assert.deepEqual(s.models, [])
    assert.deepEqual(s.toolCounts, {})
    assert.equal(s.userTurns, 0)
    assert.equal(typeof s.tokens, 'object')
  })
})

{
  const id = 'codex'
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { temporaryDirectory } = await import('../../../helpers/tmpConfigDir.ts')
  test(`${id} keeps raw JSON unknown while malformed scalar/object fields cannot crash normalized output`, async () => {
    const parser = await import('../../../../server/providers/codex/parser.ts')
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
