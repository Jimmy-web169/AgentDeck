import { required } from '../../helpers/assert.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { temporaryDirectory, withConfigDir } from '../../helpers/tmpConfigDir.ts'
import { stateDir, stateFile, stateDirectory, planStateMigration, applyStateMigration, migrateStateOnStartup } from '../../../server/shared/state.ts'
import { idFor } from '../../../server/shared/roots.ts'
import { terminalIdentity } from '../../../server/shared/terminalIdentity.ts'

test('explicit migration preserves empty directory owners and nested empty directories', () => {
  const base = temporaryDirectory('state-empty-directories-')
  const legacy = path.join(base, 'dashboards')
  fs.mkdirSync(legacy)
  fs.mkdirSync(path.join(base, 'handoffs', 'empty'), { recursive: true })
  const plan = planStateMigration(base)
  assert.equal(plan.length, 2)
  assert.ok(plan.every((entry) => entry.kind === 'directory' && entry.status === 'copy'))
  assert.equal(stateDirectory('dashboards', base), legacy)
  applyStateMigration(base)
  assert.equal(stateDirectory('dashboards', base), path.join(base, '.agentdeck', 'dashboards'))
  assert.ok(fs.statSync(path.join(base, '.agentdeck', 'handoffs', 'empty')).isDirectory())
  assert.deepEqual(fs.readdirSync(legacy), [])
  assert.ok(planStateMigration(base).every((entry) => entry.status === 'identical'))
})

test('state paths use new owners for fresh installs without creating state on read', () => {
  const base = temporaryDirectory('state-paths-')
  assert.equal(stateFile('roots', 'claude', base), path.join(base, '.agentdeck', 'roots', 'claude.json'))
  assert.equal(stateDirectory('handoffs', base), path.join(base, '.agentdeck', 'handoffs'))
  assert.deepEqual(fs.readdirSync(base), [])
  assert.throws(() => stateFile('roots', '../escape', base), /Invalid state owner/)
})

test('legacy fallback, new-file precedence, and explicit copy preserve root IDs and terminal aliases', async () => {
  const base = temporaryDirectory('state-copy-'),
    native = path.join(base, 'native')
  fs.mkdirSync(native)
  const root = { id: idFor(native), dir: native, label: 'Unchanged label' }
  const original = JSON.stringify([root], null, 2)
  const legacy = path.join(base, 'roots.claude.json')
  fs.writeFileSync(legacy, original)
  fs.writeFileSync(path.join(base, 'probe.claude.json'), '{"root":{"baseline":{}}}')
  fs.mkdirSync(path.join(base, 'handoffs'))
  fs.writeFileSync(path.join(base, 'handoffs', 'brief.md'), 'Keep this absolute source path valid.\n')
  fs.mkdirSync(path.join(base, 'dashboards'))
  fs.writeFileSync(path.join(base, 'dashboards', 'one.json'), '{"id":"one","sources":[]}')
  const identity = terminalIdentity('claude', root.id, { id: 'native-session' })
  assert.equal(stateFile('roots', 'claude', base), legacy)
  assert.equal(stateDirectory('dashboards', base), path.join(base, 'dashboards'))
  assert.equal(planStateMigration(base).length, 4)
  assert.equal(fs.existsSync(stateDir(base)), false)
  assert.equal(applyStateMigration(base).filter((entry) => entry.status === 'copied').length, 4)
  assert.equal(fs.readFileSync(legacy, 'utf8'), original)
  assert.equal(fs.readFileSync(stateFile('roots', 'claude', base), 'utf8'), original)
  assert.ok(fs.existsSync(`${legacy}.migrated`))
  assert.ok(fs.existsSync(path.join(base, 'handoffs', 'brief.md')))
  assert.ok(fs.existsSync(path.join(base, 'dashboards', 'one.json')))
  assert.deepEqual(
    terminalIdentity('claude', JSON.parse(fs.readFileSync(stateFile('roots', 'claude', base), 'utf8'))[0].id, { id: 'native-session' }),
    identity
  )
  assert.equal(idFor(native), root.id)
  assert.ok(applyStateMigration(base).every((entry) => entry.status === 'identical'))
  await withConfigDir(base, () => assert.equal(stateFile('roots', 'claude'), path.join(base, '.agentdeck', 'roots', 'claude.json')))
})

test('migration detects every conflicting destination before making any copies', () => {
  const base = temporaryDirectory('state-conflict-')
  fs.writeFileSync(path.join(base, 'roots.claude.json'), '[{"id":"old"}]')
  fs.writeFileSync(path.join(base, 'roots.codex.json'), '[]')
  fs.mkdirSync(path.join(stateDir(base), 'roots'), { recursive: true })
  const current = path.join(stateDir(base), 'roots', 'claude.json')
  fs.writeFileSync(current, '[{"id":"new"}]')
  assert.equal(stateFile('roots', 'claude', base), current)
  assert.equal(required(planStateMigration(base).find((entry) => entry.source.endsWith('roots.claude.json'))).status, 'conflict')
  assert.throws(() => applyStateMigration(base), /conflicting/)
  assert.equal(fs.existsSync(path.join(stateDir(base), 'roots', 'codex.json')), false)
  assert.equal(fs.readFileSync(current, 'utf8'), '[{"id":"new"}]')
})

test('an interrupted directory migration keeps legacy records visible and resumes without overwriting copies', () => {
  const base = temporaryDirectory('state-resume-'),
    legacy = path.join(base, 'dashboards'),
    current = path.join(stateDir(base), 'dashboards')
  fs.mkdirSync(legacy)
  fs.writeFileSync(path.join(legacy, 'one.json'), '{"id":"one"}')
  fs.writeFileSync(path.join(legacy, 'two.json'), '{"id":"two"}')
  fs.mkdirSync(current, { recursive: true })
  fs.copyFileSync(path.join(legacy, 'one.json'), path.join(current, 'one.json'))
  fs.writeFileSync(path.join(current, '.migration-pending'), 'interrupted')
  assert.equal(stateDirectory('dashboards', base), legacy)
  const result = applyStateMigration(base)
  assert.deepEqual(
    result.map((entry) => entry.status),
    ['identical', 'copied']
  )
  assert.equal(stateDirectory('dashboards', base), current)
  assert.equal(fs.existsSync(path.join(current, '.migration-pending')), false)
  assert.equal(fs.readFileSync(path.join(current, 'two.json'), 'utf8'), '{"id":"two"}')
  assert.equal(fs.readFileSync(path.join(legacy, 'two.json'), 'utf8'), '{"id":"two"}')
})

test('malformed JSON and symbolic destination parents block migration without changing legacy data', () => {
  const base = temporaryDirectory('state-invalid-'),
    outside = temporaryDirectory('state-outside-')
  const legacy = path.join(base, 'roots.claude.json')
  fs.writeFileSync(legacy, '{')
  assert.equal(planStateMigration(base)[0].status, 'blocked')
  assert.throws(() => applyStateMigration(base), /blocked/)
  fs.writeFileSync(legacy, '[]')
  fs.symlinkSync(outside, stateDir(base), process.platform === 'win32' ? 'junction' : 'dir')
  assert.match(required(planStateMigration(base)[0].reason), /symlink/)
  assert.throws(() => applyStateMigration(base), /blocked/)
  assert.deepEqual(fs.readdirSync(outside), [])
  assert.equal(fs.readFileSync(legacy, 'utf8'), '[]')
})

test('startup migration copies clean legacy state, retains the originals, and is idempotent', async () => {
  const base = temporaryDirectory('state-startup-')
  fs.writeFileSync(path.join(base, 'roots.claude.json'), '[{"id":"one"}]')
  fs.writeFileSync(path.join(base, 'probe.claude.json'), '{"root":{"baseline":{}}}')
  const first = migrateStateOnStartup(base)
  assert.equal(first.status, 'copied')
  assert.equal(first.entries.filter((entry) => entry.status === 'copied').length, 2)
  assert.equal(stateFile('roots', 'claude', base), path.join(stateDir(base), 'roots', 'claude.json'))
  assert.equal(fs.readFileSync(stateFile('roots', 'claude', base), 'utf8'), '[{"id":"one"}]')
  assert.equal(fs.readFileSync(path.join(base, 'roots.claude.json'), 'utf8'), '[{"id":"one"}]')
  assert.equal(fs.readFileSync(stateFile('probe', 'claude', base), 'utf8'), '{"root":{"baseline":{}}}')
  assert.ok(fs.existsSync(path.join(base, 'roots.claude.json.migrated')))
  const second = migrateStateOnStartup(base)
  assert.equal(second.status, 'current')
  assert.ok(second.entries.every((entry) => entry.status === 'identical'))
  await withConfigDir(base, () => assert.equal(migrateStateOnStartup().status, 'current'))
})

test('startup migration does nothing on a fresh install and leaves conflicting or malformed legacy state authoritative', () => {
  const fresh = temporaryDirectory('state-startup-fresh-')
  assert.deepEqual(migrateStateOnStartup(fresh), { status: 'none', entries: [] })
  assert.deepEqual(fs.readdirSync(fresh), [])
  const base = temporaryDirectory('state-startup-conflict-')
  fs.writeFileSync(path.join(base, 'roots.claude.json'), '[{"id":"old"}]')
  fs.writeFileSync(path.join(base, 'roots.codex.json'), '[]')
  fs.mkdirSync(path.join(stateDir(base), 'roots'), { recursive: true })
  fs.writeFileSync(path.join(stateDir(base), 'roots', 'claude.json'), '[{"id":"new"}]')
  const skipped = migrateStateOnStartup(base)
  assert.equal(skipped.status, 'skipped')
  assert.equal(required(skipped.entries.find((entry) => entry.source.endsWith('roots.claude.json'))).status, 'conflict')
  // Nothing was copied, so the untouched legacy file still owns codex.
  assert.equal(fs.existsSync(path.join(stateDir(base), 'roots', 'codex.json')), false)
  assert.equal(stateFile('roots', 'codex', base), path.join(base, 'roots.codex.json'))
  const broken = temporaryDirectory('state-startup-broken-')
  fs.writeFileSync(path.join(broken, 'probe.claude.json'), '{')
  assert.equal(migrateStateOnStartup(broken).status, 'skipped')
  assert.equal(fs.existsSync(stateDir(broken)), false)
  assert.equal(fs.readFileSync(path.join(broken, 'probe.claude.json'), 'utf8'), '{')
})
