import { required } from '../../helpers/assert.ts'
import type { TimelineEvent } from '../../../shared/types.d.ts'
import type { HistorySource, historyReader } from '../../../server/deck/history.ts'
type Reader = ReturnType<typeof historyReader>
import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'
import { assertContract } from '../../helpers/fixture.ts'
// Original test group: conversation-export. Assertions retained during module-path migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { captureHistory } from '../../../server/deck/history.ts'
import { openHandoffStore, handoffLaunch } from '../../../server/deck/handoffStore.ts'
import { createHandoffService } from '../../../server/deck/handoff.ts'
import type { TerminalMetadata } from '../../../server/shared/terminalTypes.ts'

const text = (role: TimelineEvent['kind'], value: string | null, parts?: TimelineEvent['parts']): TimelineEvent => ({
  kind: role,
  ts: '2026-09-09T00:00:00Z',
  ...(parts ? { parts } : { text: value || '' }),
})
function fixture(t: test.TestContext, { reader, failLaunch = false }: { reader?: Reader; failLaunch?: boolean } = {}) {
  const dir = temporaryDirectory('agentdeck-jsonl-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = openHandoffStore(dir),
    launches: Record<string, unknown>[] = [],
    live: TerminalMetadata[] = []
  const history: Reader = reader || {
    read: async () => ({ _etag: 'stable', summary: { cwd: dir }, timeline: [text('user', 'first request'), text('assistant', 'visible reply')] }),
    children: async () => [],
  }
  const provider: Parameters<typeof createHandoffService>[0]['providers'][string] = {
    id: 'future',
    history,
    capabilities: { interactiveContext: true },
    loadRoots: () => [
      { id: 'r', dir, label: 'Root' },
      { id: 'another', dir, label: 'Other' },
    ],
    dispatch: async (_method, _path, _q, input) => {
      const body = input as Record<string, unknown>
      assert.ok(body && typeof body === 'object' && !Array.isArray(body))
      launches.push(body)
      assert.equal(store.status(body.handoffExportId).state, 'dispatching')
      const seed = handoffLaunch(body, 'future', String(body.root), String(body.cwd))
      assert.ok(seed)
      assert.ok(seed.prompt.includes(JSON.stringify(dir)))
      assert.equal(body.id, undefined)
      if (failLaunch) throw new Error('Lost after CLI start')
      return { status: 200, body: { key: 'terminal', launchId: body.launchId } }
    },
  }
  const service = createHandoffService({ providers: { future: provider }, getStore: () => store, terminals: () => live })
  const source = { provider: 'future', root: 'r', id: 'main' }
  return { dir, store, service, source, launches, live }
}
const read = (file: fs.PathOrFileDescriptor) =>
  fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

test('missing child is visible in file completeness; missing primary history never produces an export', async (t) => {
  const reader: Reader = {
    read: async (s: HistorySource) => {
      if (s.id === 'child') throw Object.assign(new Error('private /old/path'), { status: 404 })
      return { _etag: 'a', timeline: [text('user', 'task')] }
    },
    children: async (s: HistorySource) => (s.id === 'main' ? [{ source: { ...s, id: 'child' } }] : []),
  }
  const f = fixture(t, { reader }),
    result = await f.service.exportHistory({ source: f.source })
  assert.equal(result.history.complete, false)
  assertContract('Handoff', result)
  assert.equal(read(result.file)[0].handoff.history.warnings[0].code, 'subagent_unavailable')
  assert.doesNotMatch(fs.readFileSync(result.file, 'utf8'), /private|old\/path/)
  await assert.rejects(f.service.dispatch({ id: result.id, target: { provider: 'future', root: 'r' } }), /incomplete/)
  assert.equal(f.launches.length, 0)
  await assert.rejects(captureHistory(reader, { provider: 'future', root: 'r', id: 'child' }), /Source history is unavailable/)
})

test('export is a self-contained JSONL with readable filename, no extra root/cwd metadata and no SQLite', async (t) => {
  const f = fixture(t)
  assert.equal(fs.existsSync(path.join(f.dir, '.agentdeck')), false, 'merely opening the store is read-only')
  const result = await f.service.exportHistory({ source: { ...f.source, cwd: '/untrusted/client/folder' } })
  assertContract('Handoff', result)
  const lines = read(result.file),
    h = lines[0].handoff
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
  const f = fixture(t),
    exported = await f.service.exportHistory({ source: f.source, task: 'Continue by testing' })
  const result = await f.service.dispatch({ id: exported.id, target: { provider: 'future', root: 'another', cwd: '/wrong/folder' } })
  assertContract('Handoff', result)
  assert.equal(result.state, 'launched')
  assert.equal(f.launches[0].cwd, f.dir)
  assert.equal(f.launches[0].root, 'another')
  const seed = handoffLaunch(f.launches[0], 'future', 'another', f.dir)
  assert.ok(seed)
  assert.match(seed.prompt, /Read the complete|in chunks|Historical paths/)
  assert.equal(seed.meta.handoffExportId, exported.id)
  assert.equal(seed.prompt.includes('first request'), false, 'history travels as JSONL, not a giant command-line argument')
  await f.service.dispatch({ id: exported.id, target: { provider: 'future', root: 'r' } })
  assert.equal(f.launches.length, 1)
  assert.equal(fs.readFileSync(exported.file, 'utf8').includes('Continue by testing'), true)
})

test('cross-process file claims permit one launch only; recovered intent is never blindly replayed', async (t) => {
  const f = fixture(t),
    value = await f.service.exportHistory({ source: f.source })
  const first = f.store.claim(value.id, { provider: 'future', root: 'r', cwd: f.dir })
  assert.equal(first.claimed, true)
  assert.equal(openHandoffStore(f.dir).claim(value.id, required(first.value.target)).claimed, false)
  const otherProcess = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { openHandoffStore } from ${JSON.stringify(new URL('../../../server/deck/handoffStore.ts', import.meta.url).href)};
    const [dir, id, target] = process.argv.slice(1);
    console.log(openHandoffStore(dir).claim(id, JSON.parse(target)).claimed);
  `,
      f.dir,
      value.id,
      JSON.stringify(first.value.target),
    ],
    { encoding: 'utf8', timeout: 10000 }
  )
  assert.equal(otherProcess.status, 0, otherProcess.stderr)
  assert.equal(otherProcess.stdout.trim(), 'false')
  assert.equal((await f.service.dispatch({ id: value.id, target: first.value.target })).state, 'dispatching')
  assert.equal(f.launches.length, 0)
})

test('ambiguous launch offers exact-identity recovery, never another launch', async (t) => {
  const f = fixture(t, { failLaunch: true }),
    value = await f.service.exportHistory({ source: f.source })
  const unknown = await f.service.dispatch({ id: value.id, target: { provider: 'future', root: 'r' } })
  assert.equal(unknown.state, 'unknown')
  await f.service.dispatch({ id: value.id })
  assert.equal(f.launches.length, 1)
  const launch = f.store.status(value.id)
  f.live.push({ provider: 'future', root: 'r', launchId: launch.launchId })
  assert.equal(f.service.status({ id: value.id }).state, 'unknown', 'incomplete metadata cannot prove a recoverable terminal')
  f.live.push({ provider: 'future', root: 'r', key: 'recovered', launchId: launch.launchId })
  assert.equal(f.service.status({ id: value.id }).terminal?.key, 'recovered')
})

test('tampered JSONL, wrong-machine receipts and forged terminal requests are rejected', async (t) => {
  const f = fixture(t),
    value = await f.service.exportHistory({ source: f.source })
  assert.throws(() => handoffLaunch({ handoffExportId: value.id }, 'future', 'r', f.dir), { status: 409 })
  assert.throws(() => handoffLaunch({ contextDispatchId: 'old-id' }, 'future', 'r', f.dir), { status: 409 })
  assert.throws(() => f.store.get('../not-an-export'), { status: 400 })
  fs.appendFileSync(value.file, '{}\n')
  await assert.rejects(f.service.dispatch({ id: value.id, target: { provider: 'future', root: 'r' } }), /changed/)
  const second = await f.service.exportHistory({ source: f.source })
  const meta = path.join(f.dir, '.agentdeck', 'runtime', 'handoffs', `${second.id}.json`)
  const stored = JSON.parse(fs.readFileSync(meta, 'utf8'))
  stored.origin = 'another-machine'
  fs.writeFileSync(meta, JSON.stringify(stored))
  assert.throws(() => f.store.verify(second.id), /current local environment/)
  assert.equal(f.launches.length, 0)
})
