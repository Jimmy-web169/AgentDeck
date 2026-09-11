// Normalization may remove volatile metadata, never transcript order or values.
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalize, tapSummary, runtimeDirectory, assertMatchingFixtures, getRoutes } from '../../scripts/snapshot.ts'
import fs from 'node:fs'
import path from 'node:path'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'

test('snapshot inventories retain common provider GET routes after factory extraction and include extras exactly once', () => {
  for (const id of ['claude', 'codex', 'antigravity']) {
    const routes = getRoutes(`server/providers/${id}/api.js`)
    for (const route of [
      'roots',
      'projects',
      'sessions',
      'session',
      'raw',
      'subagents',
      'stats',
      'history',
      'usage',
      'version',
      'memory',
      'plugins',
      'resources',
      'browse',
      'pick-folder',
      'terminals',
      'live-terminals',
      'active-sessions',
      'activity',
    ])
      assert.ok(routes.includes(route), `${id}: ${route}`)
    assert.equal(routes.length, new Set(routes).size)
  }
  assert.ok(getRoutes('server/providers/claude/api.ts').includes('subagent'))
  assert.ok(getRoutes('server/providers/claude/api.ts').includes('resource'))
  assert.equal(getRoutes('server/deck/api.ts').includes('roots'), false)
})

test('snapshot comparisons reject different fixture roots or regenerated manifests before reporting runtime differences', () => {
  const before = { fixtureSource: 'tmp/fixture-a', fixtureManifestHash: 'seed-a' }
  assert.doesNotThrow(() => assertMatchingFixtures(before, { ...before }))
  assert.throws(() => assertMatchingFixtures(before, { ...before, fixtureSource: 'tmp/fixture-b' }), /different synthetic fixtures/)
  assert.throws(() => assertMatchingFixtures(before, { ...before, fixtureManifestHash: 'seed-b' }), /different synthetic fixtures/)
  assert.doesNotThrow(() => assertMatchingFixtures({}, before), 'legacy captures retain their existing byte-level comparison')
})

test('snapshot reference runtimes stay inside temporary staging and require a bootstrap', () => {
  assert.throws(() => runtimeDirectory(process.cwd()), /isolated copy under repo tmp/)
  const directory = temporaryDirectory('snapshot-reference-')
  assert.throws(() => runtimeDirectory(directory), /missing its bootstrap/)
  fs.mkdirSync(path.join(directory, 'server'))
  fs.writeFileSync(path.join(directory, 'server/index.ts'), '')
  assert.equal(runtimeDirectory(directory), fs.realpathSync(directory))
})

test('snapshot TAP summary retains tests inside named module groups', () => {
  const output =
    '# Subtest: original-file\n    # Subtest: retained assertion\n    ok 1 - retained assertion\n      duration_ms: 123.45\nok 1 - original-file\n# tests 1\n# suites 1\n# fail 0\n'
  assert.equal(
    tapSummary(output),
    '# Subtest: original-file\n    # Subtest: retained assertion\n    ok - retained assertion\nok - original-file\n# tests 1\n# suites 1\n# fail 0'
  )
})

test('snapshot normalization removes paths, volatile timestamps and private etags', () => {
  const value = { _etag: 'content-hash', path: '/fixture/data/session', checkedAt: 1720000000000, created: '2026-09-07T12:00:00.000Z', count: 1720000000000 }
  assert.deepEqual(normalize(value, { fixture: '/fixture', repo: '/repo' }), {
    path: '<ROOT>/data/session',
    checkedAt: '<TS>',
    created: '<TS>',
    count: 1720000000000,
  })
})
test('snapshot normalization preserves ordered transcript parts and token quantities', () => {
  const value = {
    timeline: [
      {
        id: 'b',
        parts: [
          { type: 'text', text: 'Second' },
          { type: 'thinking', text: 'First' },
        ],
      },
      { id: 'a' },
    ],
    tokens: { input: 1_060_000_000 },
  }
  assert.deepEqual(normalize(value), value)
  assert.notDeepEqual(normalize(value), normalize({ ...value, timeline: [...value.timeline].reverse() }))
})
test('snapshot normalization sorts inventories without mutating input', () => {
  const value = { roots: [{ id: 'z' }, { id: 'a' }] }
  assert.deepEqual(normalize(value), { roots: [{ id: 'a' }, { id: 'z' }] })
  assert.deepEqual(value.roots, [{ id: 'z' }, { id: 'a' }])
})
test('snapshot normalization preserves empty pagination and masks only opaque populated cursors', () => {
  assert.deepEqual(normalize({ cursor: null, nextCursor: 'opaque-random-id', title: 'opaque-random-id' }), {
    cursor: null,
    nextCursor: '<CURSOR>',
    title: 'opaque-random-id',
  })
})
