import test from 'node:test'
import assert from 'node:assert/strict'
import { summarize as claude } from '../server/providers/claude/parser.js'
import { summarize as codex } from '../server/providers/codex/parser.js'
import { summarize as antigravity } from '../server/providers/antigravity/parser.js'

const first = '2026-09-01T12:00:00Z'
const latest = '2026-09-01T12:01:00Z'
const after = '2026-09-01T12:02:00Z'
const ccUser = (content, timestamp) => ({ type: 'user', timestamp, message: { content } })
const cxEvent = (type, payload, timestamp) => ({ type: 'event_msg', timestamp, payload: { type, ...payload } })
const cxUser = (text, timestamp) => ({ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
const agUser = (content, step_index, created_at) => ({ type: 'USER_INPUT', content, step_index, created_at })

test('Claude latest question is independent of title/first prompt and excludes tool/meta records', () => {
  const s = claude([
    ccUser('Build an API', first),
    { type: 'custom-title', customTitle: 'Orbit API' },
    ccUser('請加上\n認證測試', latest),
    ccUser([{ type: 'tool_result', tool_use_id: 't1', content: 'tool output is not a question' }], after),
    ccUser('<command-name>/rename</command-name><command-args>Orbit API</command-args>', after),
    ccUser('<system-reminder>internal reminder</system-reminder>', after),
    { ...ccUser('internal metadata, not a question', after), isMeta: true },
    { type: 'assistant', timestamp: after, message: { content: [{ type: 'text', text: 'Done' }] } },
  ], 'a')
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

test('Codex event messages stay authoritative over duplicated response items', () => {
  const s = codex([
    cxEvent('user_message', { message: 'Build an API' }, first),
    cxUser('Build an API', first),
    cxEvent('thread_name_updated', { thread_name: 'Orbit API' }, first),
    cxEvent('user_message', { message: '<environment_context>cwd</environment_context> Add authentication tests' }, latest),
    cxUser('Add authentication tests', after),
    cxEvent('agent_message', { message: 'Done' }, after),
    { type: 'response_item', timestamp: after, payload: { type: 'function_call_output', call_id: 't1', output: 'not a question' } },
  ], 'a')
  assert.equal(s.title, 'Orbit API')
  assert.equal(s.firstPrompt, 'Build an API')
  assert.equal(s.lastUserPrompt, 'Add authentication tests')
  assert.equal(s.lastUserPromptTs, latest)
  assert.equal(s.userTurns, 2)
})

test('Codex legacy user items strip environment/instructions and skip system/assistant content', () => {
  const s = codex([
    cxUser('First question', first),
    cxUser('<user_instructions>project settings</user_instructions> Latest question', latest),
    cxUser('<environment_context>new cwd</environment_context>', after),
    { type: 'message', timestamp: after, role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
  ], 'a')
  assert.equal(s.lastUserPrompt, 'Latest question')
  assert.equal(s.lastUserPromptTs, latest)
})

test('Codex recognizes known attachment-only records in both formats', () => {
  for (const records of [
    [cxEvent('user_message', { message: 'Read image' }, first), cxEvent('user_message', { message: '', images: ['image'] }, latest)],
    [cxUser('Read image', first), { type: 'response_item', timestamp: latest, payload: { type: 'message', role: 'user', content: [null, { type: 'input_image', image_url: 'image' }] } }],
  ]) {
    const s = codex(records, 'a')
    assert.equal(s.lastUserPrompt, '(Image or attachment)')
    assert.equal(s.lastUserPromptTs, latest)
  }
})

test('Antigravity uses step order, not timestamp order, and excludes metadata/tool/system messages', () => {
  const s = antigravity([
    agUser('<USER_REQUEST>Latest question</USER_REQUEST><ADDITIONAL_METADATA>noise</ADDITIONAL_METADATA>', 5, latest),
    agUser('<USER_REQUEST>First question</USER_REQUEST>', 0, after), // clock ordering intentionally differs
    { type: 'GENERIC', step_index: 6, created_at: after, content: 'tool result' },
    { type: 'SYSTEM_MESSAGE', step_index: 7, created_at: after, content: 'agent mail' },
    agUser('<USER_SETTINGS_CHANGE>model changed</USER_SETTINGS_CHANGE>', 8, after),
  ], 'a')
  assert.equal(s.firstPrompt, 'First question')
  assert.equal(s.lastUserPrompt, 'Latest question')
  assert.equal(s.lastUserPromptTs, latest)
})

test('every provider has bounded latest previews and neutral fields for an empty session', () => {
  for (const [summarize, records] of [
    [claude, [ccUser('問'.repeat(200), latest)]],
    [codex, [cxUser('問'.repeat(200), latest)]],
    [antigravity, [agUser('問'.repeat(200), 0, latest)]],
  ]) {
    const empty = summarize([], 'empty')
    assert.equal(empty.lastUserPrompt, '')
    assert.equal(empty.lastUserPromptTs, null)
    const s = summarize(records, 'a')
    assert.equal(s.lastUserPrompt, '問'.repeat(140) + '…')
    assert.equal(s.lastUserPromptTs, latest)
  }
})
