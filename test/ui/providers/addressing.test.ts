import assert from 'node:assert/strict'
import { test } from 'vitest'
import { idAddressing, slugAddressing } from '../../../src/providers/addressing.ts'

test('native addressing keeps explicit nulls, cut zero and resource-scope fallback', () => {
  const ref = { root: 'r', slug: null, id: null }
  assert.deepEqual(slugAddressing.session(ref), { root: 'r', slug: null, id: null })
  assert.deepEqual(idAddressing.session(ref), { root: 'r', id: null })
  assert.deepEqual(slugAddressing.fork(ref, 0), { root: 'r', slug: null, id: null, cut: 0 })
  assert.deepEqual(idAddressing.fork(ref), { root: 'r', id: null, cut: null })
  assert.deepEqual(idAddressing.resources({ ...ref, scope: 'project' }), { root: 'r', scope: 'user' })
  assert.deepEqual(slugAddressing.resources({ ...ref, scope: 'project' }), { root: 'r' })
  assert.deepEqual(idAddressing.deleteResource({ ...ref, scope: 'project', kind: 'skill', name: 'name' }), {
    root: 'r',
    scope: 'user',
    kind: 'skill',
    name: 'name',
  })
})
