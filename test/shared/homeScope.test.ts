import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeHomeScope, normalizeHomeSource } from '../../shared/homeScope.ts'

test('Home scope normalization retains only canonical source tuples and unique sorted providers', () => {
  for (const input of [null, undefined, false, '', [], { excluded: {}, excludedRoots: {} }]) assert.deepEqual(normalizeHomeScope(input), { excluded: [] })
  assert.deepEqual(normalizeHomeScope({ folder: 1, excluded: ['codex', '', 'codex', 2] }), { excluded: ['codex'] })
  const root = '["future","work"]'
  assert.deepEqual(
    normalizeHomeScope({
      excluded: ['z', 'a', 'z'],
      excludedRoots: [root, root, 'bad', '[1,2]', '["future", "work"]', '["", "r"]', '[]', '["p","r","extra"]'],
    }),
    { excluded: ['a', 'z'], excludedRoots: [root] }
  )
})

test('Home source normalization preserves valid native scope and optional labels', () => {
  for (const input of [null, undefined, {}, { provider: 1, root: 'r' }, { provider: 'p', root: '' }]) assert.equal(normalizeHomeSource(input), null)
  assert.deepEqual(normalizeHomeSource({ provider: 'future', root: '工作', rootLabel: 'Work', ignored: true }), {
    provider: 'future',
    root: '工作',
    rootLabel: 'Work',
  })
  assert.deepEqual(normalizeHomeSource({ provider: 'future', root: 'r', rootLabel: 1 }), { provider: 'future', root: 'r' })
})
