import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { captureHistory, historyReader, visibleMessages } from '../server/deck/history.js'
import { openHandoffStore, handoffLaunch } from '../server/deck/handoffStore.js'
import { createHandoffService } from '../server/deck/handoff.js'

const text = (role, value, parts) => ({ kind: role, ts: '2026-09-09T00:00:00Z', ...(parts ? { parts } : { text: value }) })
function fixture(t, { reader, failLaunch = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-jsonl-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = openHandoffStore(dir), launches = [], live = []
  const history = reader || { read: async () => ({ _etag: 'stable', summary: { cwd: dir }, timeline: [text('user', 'first request'), text('assistant', 'visible reply')] }), children: async () => [] }
  const provider = { id: 'future', history, capabilities: { interactiveContext: true }, loadRoots: () => [{ id: 'r' }, { id: 'another' }], dispatch: async (_method, _path, _q, body) => {
    launches.push(body)
    assert.equal(store.status(body.handoffExportId).state, 'dispatching')
    const seed = handoffLaunch(body, 'future', body.root, body.cwd)
    assert.ok(seed.prompt.includes(JSON.stringify(dir)))
    assert.equal(body.id, undefined)
    if (failLaunch) throw new Error('Lost after CLI start')
    return { status: 200, body: { key: 'terminal', launchId: body.launchId } }
  } }
  const service = createHandoffService({ providers: { future: provider }, getStore: () => store, terminals: () => live })
  const source = { provider: 'future', root: 'r', id: 'main' }
  return { dir, store, service, source, launches, live }
}
const read = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse)

test('visible history has no last-N/30k clipping and excludes system/thinking/tool output', () => {
  const timeline = Array.from({ length: 80 }, (_, i) => text(i % 2 ? 'assistant' : 'user', `message ${i}`))
  timeline.push(text('user', '大'.repeat(40000)))
  timeline.push(text('system', 'hidden system'))
  timeline.push(text('assistant', null, [{ kind: 'thinking', text: 'hidden thoughts' }, { kind: 'tool_call', input: 'private tool input', result: 'private tool output' }, { kind: 'text', text: 'final answer' }]))
  const messages = visibleMessages(timeline, 'c0')
  assert.equal(messages.length, 82)
  assert.equal(messages[0].text, 'message 0')
  assert.equal(messages[80].text.length, 40000)
  assert.equal(messages[81].text, 'final answer')
  assert.doesNotMatch(JSON.stringify(messages), /hidden|private tool/)
})

test('independent subagent tree includes descendants and preserves per-conversation order', async () => {
  const reader = { read: async (s) => ({ _etag: s.id, summary: { cwd: '/old/project' }, timeline: [text('user', `${s.id} task`), text('assistant', `${s.id} result`)] }),
    children: async (s) => s.id === 'main' ? [{ source: { id: 'child' } }] : s.id === 'child' ? [{ source: { id: 'grandchild' } }] : [] }
  const result = await captureHistory(reader, { id: 'main' })
  assert.equal(result.complete, true)
  assert.equal(result.messageCount, 6)
  assert.deepEqual(result.records.filter((r) => r.type === 'conversation').map((r) => [r.conversationId, r.parentConversationId]), [['c0', null], ['c1', 'c0'], ['c2', 'c1']])
  assert.deepEqual(result.records.filter((r) => r.type === 'message').map((r) => r.sequence), [0, 1, 0, 1, 0, 1])
})

test('nested sidecars resolve exact parent tool ID, without exporting the tool itself', async () => {
  const reader = { nested: true, read: async (s) => ({ _etag: s.agent || 'main', timeline: [text('user', s.agent || 'main'), text('assistant', null, [{ kind: 'tool_call', id: s.agent === 'a' ? 'spawn-b' : 'spawn-a', input: 'DO NOT EXPORT' }])] }),
    children: async (s) => s.agent ? [] : [{ source: { id: 'main', agent: 'a' }, toolUseId: 'spawn-a', depth: 1 }, { source: { id: 'main', agent: 'b' }, toolUseId: 'spawn-b', depth: 2 }] }
  // Only the root owns spawn-a (do not duplicate it in b).
  const original = reader.read
  reader.read = async (s) => s.agent === 'b' ? { _etag: 'b', timeline: [text('assistant', 'child result')] } : original(s)
  const result = await captureHistory(reader, { id: 'main' })
  assert.equal(result.complete, true)
  assert.equal(result.records.find((r) => r.sourceSessionId === 'b').parentConversationId, 'c1')
  assert.doesNotMatch(JSON.stringify(result.records), /DO NOT EXPORT|spawn-b/)
})

test('missing child is visible in file completeness; missing primary history never produces an export', async (t) => {
  const reader = { read: async (s) => { if (s.id === 'child') throw Object.assign(new Error('private /old/path'), { status: 404 }); return { _etag: 'a', timeline: [text('user', 'task')] } }, children: async (s) => s.id === 'main' ? [{ source: { id: 'child' } }] : [] }
  const f = fixture(t, { reader }), result = await f.service.exportHistory({ source: f.source })
  assert.equal(result.history.complete, false)
  assert.equal(read(result.file)[0].handoff.history.warnings[0].code, 'subagent_unavailable')
  assert.doesNotMatch(fs.readFileSync(result.file, 'utf8'), /private|old\/path/)
  await assert.rejects(f.service.dispatch({ id: result.id, target: { provider: 'future', root: 'r' } }), /incomplete/)
  assert.equal(f.launches.length, 0)
  await assert.rejects(captureHistory(reader, { id: 'child' }), /Source history is unavailable/)
})

test('changes in a descendant prevent claiming a stable complete capture', async () => {
  let n = 0
  const reader = { read: async (s) => ({ _etag: s.id === 'child' ? String(n++) : 'root', timeline: [text('user', 'task')] }), children: async (s) => s.id === 'main' ? [{ source: { id: 'child' } }] : [] }
  await assert.rejects(captureHistory(reader, { id: 'main' }), /still changing/)
})

test('export is a self-contained JSONL with readable filename, no extra root/cwd metadata and no SQLite', async (t) => {
  const f = fixture(t)
  assert.equal(fs.existsSync(path.join(f.dir, '.agentdeck')), false, 'merely opening the store is read-only')
  const result = await f.service.exportHistory({ source: { ...f.source, cwd: '/untrusted/client/folder' } })
  const lines = read(result.file), h = lines[0].handoff
  assert.equal(lines[0].type, 'handoff')
  assert.equal(h.version, 1)
  assert.equal(h.exportId, result.id)
  assert.equal(h.projectName, path.basename(f.dir))
  assert.equal(h.task, null)
  assert.equal(h.history.complete, true)
  assert.match(result.filename, /^\d{8}T\d{6}[+-]\d{4}__.*__future__[a-f0-9]{8}\.jsonl$/)
  assert.equal(fs.readFileSync(result.file, 'utf8').endsWith('\n'), true)
  assert.doesNotMatch(JSON.stringify(lines), /untrusted|"cwd"|"root"|"file"/)
  assert.equal(f.launches.length, 0)
  assert.equal(fs.existsSync(path.join(f.dir, 'context-handoffs')), false)
  assert.equal(fs.readdirSync(path.join(f.dir, '.agentdeck', 'handoffs')).length, 1)
  const other = await f.service.exportHistory({ source: f.source })
  assert.notEqual(other.id, result.id)
  assert.notEqual(other.filename, result.filename)
  const copied = path.join(f.dir, 'renamed.jsonl')
  fs.copyFileSync(result.file, copied)
  assert.deepEqual(read(copied), lines, 'renamed file is meaningful without local runtime records')
})

test('switching root uses source cwd, commits intent before launch, and cannot dispatch twice', async (t) => {
  const f = fixture(t), exported = await f.service.exportHistory({ source: f.source, task: 'Continue by testing' })
  const result = await f.service.dispatch({ id: exported.id, target: { provider: 'future', root: 'another', cwd: '/wrong/folder' } })
  assert.equal(result.state, 'launched')
  assert.equal(f.launches[0].cwd, f.dir)
  assert.equal(f.launches[0].root, 'another')
  const seed = handoffLaunch(f.launches[0], 'future', 'another', f.dir)
  assert.match(seed.prompt, /Read the complete|in chunks|Historical paths/)
  assert.equal(seed.meta.handoffExportId, exported.id)
  assert.equal(seed.prompt.includes('first request'), false, 'history travels as JSONL, not a giant command-line argument')
  await f.service.dispatch({ id: exported.id, target: { provider: 'future', root: 'r' } })
  assert.equal(f.launches.length, 1)
  assert.equal(fs.readFileSync(exported.file, 'utf8').includes('Continue by testing'), true)
})

test('cross-process file claims permit one launch only; recovered intent is never blindly replayed', async (t) => {
  const f = fixture(t), value = await f.service.exportHistory({ source: f.source })
  const first = f.store.claim(value.id, { provider: 'future', root: 'r', cwd: f.dir })
  assert.equal(first.claimed, true)
  assert.equal(openHandoffStore(f.dir).claim(value.id, first.value.target).claimed, false)
  const otherProcess = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { openHandoffStore } from ${JSON.stringify(new URL('../server/deck/handoffStore.js', import.meta.url).href)};
    const [dir, id, target] = process.argv.slice(1);
    console.log(openHandoffStore(dir).claim(id, JSON.parse(target)).claimed);
  `, f.dir, value.id, JSON.stringify(first.value.target)], { encoding: 'utf8', timeout: 10000 })
  assert.equal(otherProcess.status, 0, otherProcess.stderr)
  assert.equal(otherProcess.stdout.trim(), 'false')
  assert.equal((await f.service.dispatch({ id: value.id, target: first.value.target })).state, 'dispatching')
  assert.equal(f.launches.length, 0)
})

test('ambiguous launch offers exact-identity recovery, never another launch', async (t) => {
  const f = fixture(t, { failLaunch: true }), value = await f.service.exportHistory({ source: f.source })
  const unknown = await f.service.dispatch({ id: value.id, target: { provider: 'future', root: 'r' } })
  assert.equal(unknown.state, 'unknown')
  await f.service.dispatch({ id: value.id })
  assert.equal(f.launches.length, 1)
  const launch = f.store.status(value.id)
  f.live.push({ provider: 'future', root: 'r', key: 'recovered', launchId: launch.launchId })
  assert.equal(f.service.status({ id: value.id }).terminal.key, 'recovered')
})

test('tampered JSONL, wrong-machine receipts and forged terminal requests are rejected', async (t) => {
  const f = fixture(t), value = await f.service.exportHistory({ source: f.source })
  assert.throws(() => handoffLaunch({ handoffExportId: value.id }, 'future', 'r', f.dir), { status: 409 })
  assert.throws(() => handoffLaunch({ contextDispatchId: 'old-id' }, 'future', 'r', f.dir), { status: 409 })
  assert.throws(() => f.store.get('../not-an-export'), { status: 400 })
  fs.appendFileSync(value.file, '{}\n')
  await assert.rejects(f.service.dispatch({ id: value.id, target: { provider: 'future', root: 'r' } }), /changed/)
  const second = await f.service.exportHistory({ source: f.source })
  const meta = path.join(f.dir, '.agentdeck', 'runtime', 'handoffs', `${second.id}.json`)
  const stored = JSON.parse(fs.readFileSync(meta, 'utf8')); stored.origin = 'another-machine'
  fs.writeFileSync(meta, JSON.stringify(stored))
  assert.throws(() => f.store.verify(second.id), /current local environment/)
  assert.equal(f.launches.length, 0)
})

test('history adapter uses the appropriate child API without leaking locators into exported records', async () => {
  const calls = []
  const reader = historyReader(async (_m, route, q) => { calls.push([route, Object.fromEntries(q)]); return { status: 200, body: route === '/api/subagents' ? { children: [{ kind: 'agent', id: 'child', group: 'wf_test' }] } : {} } }, { nested: true })
  const [child] = await reader.children({ root: 'r', slug: '/old/project', id: 'main' })
  await reader.read(child.source)
  assert.equal(calls[1][0], '/api/subagent')
  assert.deepEqual(calls[1][1], { root: 'r', slug: '/old/project', session: 'main', agent: 'child', run: 'wf_test' })
  assert.deepEqual(await reader.children(child.source), [])
})
