import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { targetKey, liveTarget } from '../src/lib/tabs.js'

const compiled = await build({ entryPoints: ['src/components/shared/QuickSwitcher.jsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic' })
const { buildGroups } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const a = { provider: 'codex', root: 'r', cwd: '/work/same', launchId: 'a', key: 'codex|r|launch|a', title: 'First draft', startedAt: 10 }
const b = { ...a, launchId: 'b', key: 'codex|r|launch|b', title: 'Second draft', startedAt: 20 }
const args = { q: '', level: null, index: { projects: [], labelOf: () => 'account' }, recent: [], pins: [], live: { ids: new Set(), slugs: new Set() }, openTabs: new Set([targetKey(liveTarget(a))]), providers: [{ id: 'codex', label: 'Codex' }], terminals: [a, b] }

test('new-tab picker lists idle live drafts without transcripts or recent history', () => {
  const groups = buildGroups(args)
  assert.equal(groups[0].title, 'Live sessions')
  assert.deepEqual(groups[0].rows.map((r) => r.primary), ['Second draft', 'First draft'])
  assert.equal(groups[0].rows[1].open, true)
  assert.equal(groups[0].rows[0].target.terminalKey, b.key)
})

test('live terminal search matches title, provider and working folder', () => {
  assert.equal(buildGroups({ ...args, q: 'Second' })[0].rows[0].target.terminalKey, b.key)
  assert.equal(buildGroups({ ...args, q: 'same' })[0].rows.length, 2)
  assert.equal(buildGroups({ ...args, q: 'codex' })[0].rows.length, 2)
})

test('saved live sessions are not repeated in recent sessions', () => {
  const saved = { ...a, id: 'saved', slug: a.cwd }
  const groups = buildGroups({ ...args, terminals: [saved], recent: [saved] })
  assert.equal(groups.some((g) => g.title === 'Recent sessions'), false)
})
