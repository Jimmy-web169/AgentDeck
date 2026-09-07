import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecords, buildTimeline, summarize, userText, modelLabel } from '../server/providers/antigravity/parser.js'
import { decode, deepFind, uriToPath } from '../server/providers/antigravity/sqlite.js'
import { buildIndex, listProjects, childrenOf, cwdForId, invalidateIndex, isSessionId, NO_CWD } from '../server/providers/antigravity/paths.js'

// The Antigravity (agy) provider reads an unpublished format: JSONL transcripts
// under brain/<id>/ plus protobuf blobs in SQLite. These tests pin the parts
// that do not need node:sqlite — transcript pairing, noise stripping, the
// sub-agent links read from the transcripts, the raw protobuf decoder — on
// the fictional fixture in spec/fixtures/antigravity/.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FX = path.join(REPO, 'spec', 'fixtures', 'antigravity')
const PARENT = '7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f'
const CHILD = 'c3a9f0d4-2b1e-4f6a-9c8d-5e7f1a2b3c4d'

// ---- parser ------------------------------------------------------------------------

test('parser: user text is unwrapped from <USER_REQUEST>, metadata blocks dropped, model label read', () => {
  const [first] = readRecords(path.join(FX, 'session-7d1c4e2a.jsonl'))
  assert.equal(userText(first.content), 'Add request logging with a correlation id to every route. Reuse an incoming X-Request-Id when present.')
  assert.equal(modelLabel(first.content), 'Gemini 3.8 Flash (High)')
})

test('parser: tool results pair onto the previous assistant turn by adjacency, errors flagged, ephemeral records ignored', () => {
  const tl = buildTimeline(readRecords(path.join(FX, 'session-7d1c4e2a.jsonl')))
  assert.deepEqual(tl.map((e) => e.kind), ['user', 'assistant', 'assistant', 'assistant', 'system', 'assistant', 'assistant', 'user', 'system'])
  const a1 = tl[1]
  assert.equal(a1.parts.filter((p) => p.kind === 'tool_call').length, 2, 'two calls on one PLANNER_RESPONSE')
  assert.equal(a1.parts[0].kind, 'thinking')
  for (const p of a1.parts.filter((p) => p.kind === 'tool_call')) {
    assert.ok(p.result && !p.result.isError, `${p.name} got its GENERIC result`)
    assert.ok(!/Created At:/.test(p.result.content), 'result header stripped')
    assert.equal(p.input.toolSummary, undefined, 'toolSummary lifted out of the args')
  }
  assert.equal(a1.parts[1].summary, 'List src')
  const spawn = tl[3].parts.find((p) => p.name === 'invoke_subagent')
  assert.match(spawn.result.content, new RegExp(CHILD), 'spawn result carries the child id')
  const failed = tl[5].parts.find((p) => p.name === 'run_command')
  assert.equal(failed.result.isError, true, 'a result with `error` is an error')
  assert.equal(tl[4].kind, 'system')
  assert.match(tl[4].text, /^\[Message\] timestamp=/, 'inter-agent mail keeps its body, loses the wrapper')
  assert.match(tl[8].text, /RESOURCE_EXHAUSTED/, 'ERROR_MESSAGE becomes a system event')
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

// ---- discovery + links (a brain/ tree built from the fixture, no SQLite) ------------

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-agy-'))
  for (const [id, file] of [[PARENT, 'session-7d1c4e2a.jsonl'], [CHILD, 'child-c3a9f0d4.jsonl']]) {
    const logs = path.join(home, 'brain', id, '.system_generated', 'logs')
    fs.mkdirSync(logs, { recursive: true })
    fs.copyFileSync(path.join(FX, file), path.join(logs, 'transcript_full.jsonl'))
  }
  fs.mkdirSync(path.join(home, 'brain', 'not-a-session'), { recursive: true }) // ignored: not a UUID
  return home
}

test('paths: the child is linked to its parent from the transcripts alone and inherits the spawn workspace', () => {
  const home = makeHome()
  invalidateIndex(home)
  const { byId } = buildIndex(home)
  assert.deepEqual([...byId.keys()].sort(), [CHILD, PARENT].sort())
  const child = byId.get(CHILD)
  assert.equal(child.parentId, PARENT, 'send_message Recipient → parent')
  assert.equal(child.isSubagent, true)
  assert.deepEqual(childrenOf(home, PARENT).map((c) => c.id), [CHILD])
  // neither has a SQLite sidecar or a last_conversations entry: the parent lands in
  // the no-workspace bucket, the child takes the workspaceUris of its spawn record
  assert.equal(cwdForId(home, PARENT), null)
  assert.equal(cwdForId(home, CHILD), uriToPath('file:///home/demo/code/orbit-api'))
  const projects = listProjects(home)
  assert.ok(projects.some((p) => p.slug === NO_CWD && p.cwd === null), 'a "(no workspace)" project exists')
  const ws = projects.find((p) => p.slug !== NO_CWD)
  assert.equal(ws.sessionCount, 0, 'sub-agents are not counted as sessions of their workspace')
})

test('paths: cache/last_conversations.json supplies the workspace the sidecar cannot', () => {
  const home = makeHome()
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true })
  const cwd = process.platform === 'win32' ? 'C:\\demo\\orbit-api' : '/home/demo/code/orbit-api'
  fs.writeFileSync(path.join(home, 'cache', 'last_conversations.json'), JSON.stringify({ [cwd]: PARENT }))
  invalidateIndex(home)
  assert.equal(cwdForId(home, PARENT), cwd)
  assert.equal(cwdForId(home, CHILD), cwd, 'the child inherits the parent workspace over its own spawn URI')
  assert.ok(!listProjects(home).some((p) => p.slug === NO_CWD), 'no orphan bucket once every session has a workspace')
})

test('paths: isSessionId accepts brain dir names only', () => {
  assert.equal(isSessionId(PARENT), true)
  assert.equal(isSessionId('not-a-session'), false)
  assert.equal(isSessionId(`${PARENT}/x`), false)
})

// ---- raw protobuf --------------------------------------------------------------------

// minimal wire-format encoder for the shapes readMeta reads
const varint = (n) => {
  const out = []
  let v = BigInt(n)
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return Buffer.from(out)
}
const field = (num, wire, payload) => Buffer.concat([varint((num << 3) | wire), payload])
const vint = (num, n) => field(num, 0, varint(n))
const str = (num, s) => field(num, 2, Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s)]))
const msg = (num, ...parts) => field(num, 2, Buffer.concat([varint(Buffer.concat(parts).length), ...parts]))

test('sqlite: the raw decoder reads nested messages, strings and repeated fields; deepFind locates the model id', () => {
  const blob = Buffer.concat([
    vint(1, 4),
    msg(10, msg(1, vint(1, 1318), vint(6, 65536), msg(3, str(28, 'gemini-3.8-flash-high')))),
    str(9, '5ddc18c0-30e4-4ca5-a0d3-7e3c6439c70a'),
    vint(2, 7),
    vint(2, 9),
  ])
  const d = decode(blob)
  assert.equal(d[1], 4)
  assert.equal(d[9], '5ddc18c0-30e4-4ca5-a0d3-7e3c6439c70a')
  assert.deepEqual([...d[2]], [7, 9], 'repeated scalar → array')
  assert.equal(d[10][1][1], 1318)
  const model = deepFind(d, (k, v) => k === '28' && typeof v === 'string' && /^[a-z][a-z0-9]*-[a-z0-9.-]+$/i.test(v))
  assert.equal(model, 'gemini-3.8-flash-high')
  assert.equal(decode(Buffer.from([0xff, 0xff, 0xff])), null, 'garbage is null, not a throw')
})

test('sqlite: token usage sums per step from field 9 of steps.metadata (decoder level)', () => {
  const usage = msg(9, vint(2, 1200), vint(3, 80), vint(5, 900), vint(9, 30))
  const d = decode(usage)
  assert.deepEqual({ input: d[9][2], output: d[9][3], cacheRead: d[9][5], reasoning: d[9][9] }, { input: 1200, output: 80, cacheRead: 900, reasoning: 30 })
})

test('sqlite: workspace URIs become local paths', () => {
  if (process.platform === 'win32') assert.equal(uriToPath('file:///C:/Users/demo/code/orbit-api'), 'C:\\Users\\demo\\code\\orbit-api')
  else assert.equal(uriToPath('file:///home/demo/code/orbit-api'), '/home/demo/code/orbit-api')
  assert.equal(uriToPath(null), null)
  assert.equal(uriToPath('/already/a/path'), '/already/a/path')
})
