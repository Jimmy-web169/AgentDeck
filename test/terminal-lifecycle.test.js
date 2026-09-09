import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { terminalIdentity, findTerminal } from '../server/shared/terminalIdentity.js'
import { uniqueSession } from '../server/shared/terminalDiscovery.js'

test('terminal identity isolates providers, accounts and concurrent drafts; retries are idempotent', () => {
  const a = terminalIdentity('one', 'root'), b = terminalIdentity('one', 'root')
  assert.notEqual(a.key, b.key)
  assert.equal(terminalIdentity('one', 'root', a).key, a.key)
  assert.notEqual(terminalIdentity('two', 'root', a).key, a.key)
  assert.notEqual(terminalIdentity('one', 'other', a).key, a.key)
  assert.throws(() => terminalIdentity('one', 'root', { launchId: '../bad' }), { status: 400 })
  assert.equal(findTerminal([{ provider: 'one', root: 'root', key: a.key }], 'two', 'root', { terminalKey: a.key }), undefined)
})

test('discovery requires one observed parent session; competing sessions remain unbound', () => {
  assert.equal(uniqueSession([]), null)
  assert.equal(uniqueSession([{ id: 'a' }, { id: 'b' }]), null)
  assert.deepEqual(uniqueSession([{ id: 'a' }, { id: 'a' }]), { id: 'a' })
})

test('terminal survives frontend shutdown, attaches by exact key, persists binding, and never recreates an ended Live target', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-terminal-test-'))
  const fixture = fileURLToPath(new URL('../scripts/test/fake-terminal.cjs', import.meta.url))
  const oldPath = process.env.PATH
  const oldPool = process.env.AGENTDECK_TEST_POOL
  process.env.AGENTDECK_TEST_POOL = dir
  process.env.PATH = dir + path.delimiter + oldPath
  for (const name of ['tmux', 'ttyd', 'fixture-cli']) { fs.copyFileSync(fixture, path.join(dir, name)); fs.chmodSync(path.join(dir, name), 0o755) }
  const pool = await import('../server/shared/terminal.js')
  t.after(() => {
    pool.stopAllTerminals()
    process.env.PATH = oldPath
    if (oldPool == null) delete process.env.AGENTDECK_TEST_POOL
    else process.env.AGENTDECK_TEST_POOL = oldPool
    fs.rmSync(dir, { recursive: true, force: true })
  })
  let observed = null
  let discoveryCalls = 0
  const config = {
    id: 'fixture', title: 'fixture', envKey: 'FIXTURE_CONFIG_DIR',
    findBin: () => path.join(dir, 'fixture-cli'), resumeArgs: (id) => ['--resume', id],
    resolveSession: ({ meta }) => { discoveryCalls++; return meta.id ? null : observed },
    resolveSavedSession: ({ id }) => ['saved-id', 'manual-id', 'other-folder', 'unknown-folder'].includes(id)
      ? { id, slug: dir, cwd: id === 'other-folder' ? os.tmpdir() : id === 'unknown-folder' ? null : dir } : null,
  }
  pool.registerTerminalProvider(config)
  const identity = terminalIdentity(config.id, 'account')
  const options = { ...identity, cwd: dir, configDir: dir, meta: { root: 'account', launchId: identity.launchId, cwd: dir, isNew: true }, config }
  const [a, duplicate] = await Promise.all([pool.startTerminal(options), pool.startTerminal(options)])
  assert.equal(a.url, duplicate.url)
  let live = pool.listLiveTmux()
  assert.equal(live.length, 1)
  const name = live[0].tmuxName
  assert.equal(live[0].launchId, identity.launchId)
  // Watcher evidence can prompt discovery before the normal 4-second poll,
  // but unrelated roots cannot invalidate this terminal's evidence cache.
  const realNow = Date.now
  const nextTime = realNow() + 600
  const beforeChanges = discoveryCalls
  try {
    Date.now = () => nextTime
    pool.noteTerminalChanges([{ provider: config.id, root: 'unrelated' }])
    pool.listLiveTmux()
    assert.equal(discoveryCalls, beforeChanges)
    pool.noteTerminalChanges([{ provider: config.id, root: 'account' }])
    pool.listLiveTmux()
    assert.equal(discoveryCalls, beforeChanges + 1)
    pool.noteTerminalChanges([{ provider: config.id, root: 'account' }])
    pool.listLiveTmux()
    assert.equal(discoveryCalls, beforeChanges + 1) // bursts remain throttled
  } finally { Date.now = realNow }
  pool.stopAllTerminals()
  assert.equal(pool.listLiveTmux().length, 1)
  const again = await pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'account', dir }, config })
  assert.equal(again.reused, true)
  assert.equal(pool.listLiveTmux()[0].tmuxName, name)
  assert.equal(pool.listLiveTmux().length, 1)
  await assert.rejects(pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'wrong', dir }, config }), { status: 410 })
  // A second provider with the same root/path cannot attach this terminal.
  await assert.rejects(pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'account', dir }, config: { ...config, id: 'other' } }), { status: 410 })
  // New tmux entry triggers provider discovery immediately, without a polling sleep.
  observed = { id: 'saved-id', slug: dir, cwd: dir }
  const second = terminalIdentity(config.id, 'account')
  await pool.startTerminal({ ...options, ...second, meta: { ...options.meta, launchId: second.launchId } })
  const bound = pool.listLiveTmux().find((e) => e.key === second.key)
  assert.equal(bound.id, 'saved-id')
  const stored = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(path.join(dir, bound.tmuxName + '.json'))).meta, 'base64').toString())
  assert.equal(stored.id, 'saved-id')
  const bind = (body) => pool.reattachTerminal({ body, root: { id: 'account', dir }, config })
  await assert.rejects(bind({ bindSessionId: 'manual-id' }), { status: 400 })
  await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'unknown-id' }), { status: 404 })
  await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'saved-id' }), { status: 409 })
  await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'other-folder', cwd: os.tmpdir() }), { status: 409 })
  await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'unknown-folder' }), { status: 409 })
  await assert.rejects(bind({ terminalKey: second.key, bindSessionId: 'manual-id' }), { status: 409 })
  const manual = await bind({ terminalKey: a.key, bindSessionId: 'manual-id' })
  assert.equal(manual.id, 'manual-id')
  assert.equal(manual.key, a.key)
  assert.equal(manual.launchId, a.launchId)
  assert.equal(pool.listLiveTmux().find((e) => e.key === a.key).id, 'manual-id')
  assert.equal(pool.listLiveTmux().length, 2)
  assert.throws(() => pool.stopTerminal(second.key, 'other'), { status: 403 })
  assert.equal(pool.listLiveTmux().length, 2)
  pool.stopTerminal(second.key, config.id)
  assert.equal(pool.listLiveTmux().length, 1)
  await assert.rejects(bind({ terminalKey: second.key }), { status: 410 })
  pool.stopAllTerminals()
  fs.rmSync(path.join(dir, name + '.json'))
  await assert.rejects(pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'account', dir }, config }), { status: 410 })
  assert.equal(fs.existsSync(path.join(dir, name + '.json')), false)
})
