import { required } from '../../../helpers/assert.ts'
function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecords, buildTimeline, summarize, userText, modelLabel, summarize as antigravity } from '../../../../server/providers/antigravity/parser.ts'

describe('antigravity/antigravity/parser', async () => {
  // The Antigravity (agy) provider reads an unpublished format: JSONL transcripts
  // under brain/<id>/ plus protobuf blobs in SQLite. These tests pin the parts
  // that do not need node:sqlite — transcript pairing, noise stripping, the
  // sub-agent links read from the transcripts, the raw protobuf decoder — on
  // the fictional fixture in spec/fixtures/antigravity/.

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

  const FX = path.join(REPO, 'spec', 'fixtures', 'antigravity')

  const PARENT = '7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f'

  const CHILD = 'c3a9f0d4-2b1e-4f6a-9c8d-5e7f1a2b3c4d'

  // ---- parser ------------------------------------------------------------------------

  test('parser: user text is unwrapped from <USER_REQUEST>, metadata blocks dropped, model label read', () => {
    const [first] = readRecords(path.join(FX, 'session-7d1c4e2a.jsonl'))
    assert.equal(userText(record(first).content), 'Add request logging with a correlation id to every route. Reuse an incoming X-Request-Id when present.')
    assert.equal(modelLabel(record(first).content), 'Gemini 3.8 Flash (High)')
  })

  test('parser: tool results pair onto the previous assistant turn by adjacency, errors flagged, ephemeral records ignored', () => {
    const tl = buildTimeline(readRecords(path.join(FX, 'session-7d1c4e2a.jsonl')))
    assert.deepEqual(
      tl.map((e) => e.kind),
      ['user', 'assistant', 'assistant', 'assistant', 'system', 'assistant', 'assistant', 'user', 'system']
    )
    const a1 = tl[1]
    assert.ok(a1.parts)
    assert.equal(a1.parts.filter((p) => p.kind === 'tool_call').length, 2, 'two calls on one PLANNER_RESPONSE')
    assert.equal(a1.parts[0].kind, 'thinking')
    for (const p of a1.parts.filter((p) => p.kind === 'tool_call')) {
      assert.ok(p.result && !p.result.isError, `${p.name} got its GENERIC result`)
      assert.ok(typeof p.result.content === 'string')
      assert.ok(!/Created At:/.test(p.result.content), 'result header stripped')
      assert.equal(record(p.input).toolSummary, undefined, 'toolSummary lifted out of the args')
    }
    assert.equal(a1.parts[1].summary, 'List src')
    const spawn = tl[3].parts?.find((p) => p.kind === 'tool_call' && p.name === 'invoke_subagent')
    assert.ok(spawn?.kind === 'tool_call' && spawn.result && typeof spawn.result.content === 'string')
    assert.match(spawn.result.content, new RegExp(CHILD), 'spawn result carries the child id')
    const failed = tl[5].parts?.find((p) => p.kind === 'tool_call' && p.name === 'run_command')
    assert.ok(failed?.kind === 'tool_call' && failed.result)
    assert.equal(failed.result.isError, true, 'a result with `error` is an error')
    assert.equal(tl[4].kind, 'system')
    assert.match(required(tl[4].text), /^\[Message\] timestamp=/, 'inter-agent mail keeps its body, loses the wrapper')
    assert.match(required(tl[8].text), /RESOURCE_EXHAUSTED/, 'ERROR_MESSAGE becomes a system event')
    assert.ok(!tl.some((e) => /EPHEMERAL/.test(e.text || '')), 'EPHEMERAL_MESSAGE never surfaces')
  })

  test('parser: summary counts turns and tools; tokens stay zero without the SQLite sidecar', () => {
    const s = summarize(readRecords(path.join(FX, 'session-7d1c4e2a.jsonl')), PARENT)
    assert.equal(s.id, PARENT)
    assert.equal(s.title, 'Add request logging with a correlation id to every route. Reuse an incoming X-Request-Id when present.')
    assert.equal(s.userTurns, 2)
    assert.equal(s.assistantTurns, 5)
    assert.equal(s.toolCalls, 5)
    assert.deepEqual(s.models, ['Gemini 3.8 Flash (High)'])
    assert.deepEqual(s.toolCounts, { list_dir: 1, view_file: 1, write_to_file: 1, invoke_subagent: 1, run_command: 1 })
    assert.deepEqual(s.tokens, { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 })
    assert.equal(s.firstTs, '2026-09-01T06:20:00Z')
    assert.equal(s.lastTs, '2026-09-01T06:30:05Z')
  })
})

describe('latest-prompt/antigravity/parser', async () => {
  const latest = '2026-09-01T12:01:00Z'

  const after = '2026-09-01T12:02:00Z'

  const agUser = (content: string, step_index: number, created_at: string) => ({ type: 'USER_INPUT', content, step_index, created_at })

  test('Antigravity uses step order, not timestamp order, and excludes metadata/tool/system messages', () => {
    const s = antigravity(
      [
        agUser('<USER_REQUEST>Latest question</USER_REQUEST><ADDITIONAL_METADATA>noise</ADDITIONAL_METADATA>', 5, latest),
        agUser('<USER_REQUEST>First question</USER_REQUEST>', 0, after), // clock ordering intentionally differs
        { type: 'GENERIC', step_index: 6, created_at: after, content: 'tool result' },
        { type: 'SYSTEM_MESSAGE', step_index: 7, created_at: after, content: 'agent mail' },
        agUser('<USER_SETTINGS_CHANGE>model changed</USER_SETTINGS_CHANGE>', 8, after),
      ],
      'a'
    )
    assert.equal(s.firstPrompt, 'First question')
    assert.equal(s.lastUserPrompt, 'Latest question')
    assert.equal(s.lastUserPromptTs, latest)
  })
})

{
  const id = 'antigravity'
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { temporaryDirectory } = await import('../../../helpers/tmpConfigDir.ts')
  test(`${id} keeps raw JSON unknown while malformed scalar/object fields cannot crash normalized output`, async () => {
    const parser = await import('../../../../server/providers/antigravity/parser.ts')
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
