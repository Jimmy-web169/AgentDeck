import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProbeSpec, expandGlob, sampleRecords, observe, compare, valuesAt, runProbe, acceptProbe, probeStatus } from '../server/shared/formatProbe.js'

// The format probe reads each descriptor's `probe:` block and samples a root's
// newest transcripts. These tests lay the spec fixtures out as real homes,
// take a baseline, then break the format the way a vendor would.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FX = path.join(REPO, 'spec', 'fixtures')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-probe-'))
async function withConfigDir(dir, fn) {
  const prev = process.env.AGENTDECK_CONFIG_DIR
  process.env.AGENTDECK_CONFIG_DIR = dir
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.AGENTDECK_CONFIG_DIR
    else process.env.AGENTDECK_CONFIG_DIR = prev
  }
}
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const writeLines = (file, recs) => fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n')

// homes laid out per the descriptors' sample globs
function claudeHome() {
  const home = tmp()
  copy(path.join(FX, 'claude', 'session-00fb8673.jsonl'), path.join(home, 'projects', 'C--home-demo-code-orbit-api', '00fb8673-8b42-4835-a84f-3e32248c1e89.jsonl'))
  return home
}
function codexHome() {
  const home = tmp()
  copy(path.join(FX, 'codex', 'session-3d5465c2.jsonl'), path.join(home, 'sessions', '2026', '09', '01', 'rollout-2026-09-01T06-20-00-3d5465c2-6ffd-76db-9962-51657f9592e0.jsonl'))
  return home
}
function agyHome() {
  const home = tmp()
  copy(path.join(FX, 'antigravity', 'session-7d1c4e2a.jsonl'), path.join(home, 'brain', '7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f', '.system_generated', 'logs', 'transcript_full.jsonl'))
  return home
}

test('every descriptor has a probe block the runner can use', () => {
  for (const id of ['claude', 'codex', 'antigravity']) {
    const spec = loadProbeSpec(id)
    assert.ok(spec?.sample?.glob, `${id}: sample.glob`)
    assert.ok(Array.isArray(spec.required) && spec.required.length, `${id}: required`)
  }
})

test('expandGlob walks the three layouts and returns newest first', () => {
  assert.equal(expandGlob(claudeHome(), loadProbeSpec('claude').sample.glob).length, 1)
  assert.equal(expandGlob(codexHome(), loadProbeSpec('codex').sample.glob).length, 1)
  assert.equal(expandGlob(agyHome(), loadProbeSpec('antigravity').sample.glob).length, 1)
  assert.equal(expandGlob(tmp(), 'projects/*/*.jsonl').length, 0, 'an empty home samples nothing')
})

test('valuesAt follows dotted paths and [] into arrays', () => {
  const rec = { message: { content: [{ type: 'text' }, { type: 'tool_use' }], usage: { input_tokens: 3 } }, type: 'assistant' }
  assert.deepEqual(valuesAt(rec, 'message.content[].type'), ['text', 'tool_use'])
  assert.deepEqual(valuesAt(rec, 'message.usage.input_tokens'), [3])
  assert.deepEqual(valuesAt(rec, 'nope.x'), [])
})

test('the fixtures conform to their own descriptors (baseline, no drift)', () => {
  for (const [id, home] of [['claude', claudeHome()], ['codex', codexHome()], ['antigravity', agyHome()]]) {
    const spec = loadProbeSpec(id)
    const obs = observe(sampleRecords(expandGlob(home, spec.sample.glob), spec.sample), spec)
    assert.ok(obs.records > 0, `${id}: sampled records`)
    const { status, details } = compare(spec, obs, null)
    assert.equal(status, 'baseline', `${id}: ${JSON.stringify(details)}`)
  }
})

test('a missing required key, an unknown enum value and a type change are drift; a new optional key is only changed', async () => {
  const dir = tmp()
  const home = codexHome()
  const root = { id: 'r1', dir: home, label: 'codex' }
  const file = expandGlob(home, loadProbeSpec('codex').sample.glob)[0].file
  await withConfigDir(dir, async () => {
    const first = runProbe('codex', root)
    assert.equal(first.status, 'baseline')
    assert.equal(runProbe('codex', root).status, 'ok', 'second run against the stored baseline')
    assert.ok(fs.existsSync(path.join(dir, 'probe.codex.json')), 'baseline persisted in the config dir')

    // the vendor adds an optional key → changed, not drift
    const recs = lines(file)
    writeLines(file, recs.map((r) => ({ ...r, trace_id: 'abc' })))
    let r = runProbe('codex', root)
    assert.equal(r.status, 'changed')
    assert.match(r.details[0].msg, /new key.*trace_id/)

    // an enum value the descriptor never listed → drift
    writeLines(file, recs.map((r, i) => (i === 2 ? { ...r, type: 'weird_new_record' } : r)))
    r = runProbe('codex', root)
    assert.equal(r.status, 'drift')
    assert.ok(r.details.some((d) => d.level === 'drift' && /weird_new_record/.test(d.msg)), JSON.stringify(r.details))

    // a required key renamed on most records → drift
    writeLines(file, recs.map((r) => ({ ts: r.timestamp, type: r.type, payload: r.payload })))
    r = runProbe('codex', root)
    assert.equal(r.status, 'drift')
    assert.ok(r.details.some((d) => /required key "timestamp"/.test(d.msg)), JSON.stringify(r.details))

    // a token count that became a string → drift
    writeLines(file, recs.map((r) => (r.payload?.info?.total_token_usage ? { ...r, payload: { ...r.payload, info: { ...r.payload.info, total_token_usage: { ...r.payload.info.total_token_usage, total_tokens: '12' } } } } : r)))
    r = runProbe('codex', root)
    assert.ok(r.details.some((d) => /total_tokens is string, expected number/.test(d.msg)), JSON.stringify(r.details))

    // accept: the current shape becomes the baseline → ok (the enum drift above is gone with the restored records)
    writeLines(file, recs.map((r) => ({ ...r, trace_id: 'abc' })))
    assert.equal(runProbe('codex', root).status, 'changed')
    assert.equal(acceptProbe('codex', root).status, 'ok')
    assert.equal(probeStatus('codex', 'r1').status, 'ok')
  })
})

test('keys that are data (file paths, ids, dates as map keys) never enter the fingerprint', () => {
  const spec = { required: ['type'], enums: {}, types: {} }
  const obs = observe(
    [
      { type: 'file-history-snapshot', snapshot: { trackedFileBackups: { 'C:\\Users\\someone\\code\\a.js': { v: 1 }, '/home/someone/b.js': { v: 2 } }, at: 1 } },
      { type: 'x', byId: { 'e26a83d9-6055-455f-b7d3-8b0268513749': 1 }, byDay: { '2026-09-08': 2 } },
    ],
    spec
  )
  assert.ok(!obs.keys.some((k) => /Users|home|someone|e26a83d9|2026-09/.test(k)), JSON.stringify(obs.keys))
  assert.ok(obs.keys.includes('snapshot.trackedFileBackups') && obs.keys.includes('snapshot.at'), 'the record shape itself is still recorded')
})

test('probeStatus survives a restart from the store, and an empty root is "empty"', async () => {
  const dir = tmp()
  await withConfigDir(dir, async () => {
    const empty = { id: 'e', dir: tmp(), label: 'empty' }
    assert.equal(runProbe('claude', empty).status, 'empty')
    const root = { id: 'c1', dir: claudeHome(), label: 'claude' }
    runProbe('claude', root)
    // a fresh module state is simulated by asking for a root id the in-memory map has not seen
    const store = JSON.parse(fs.readFileSync(path.join(dir, 'probe.claude.json'), 'utf8'))
    store.c2 = store.c1
    fs.writeFileSync(path.join(dir, 'probe.claude.json'), JSON.stringify(store))
    const s = probeStatus('claude', 'c2')
    assert.equal(s.status, 'baseline')
    assert.equal(s.keys, undefined, 'the status payload does not carry the whole key set')
  })
})
