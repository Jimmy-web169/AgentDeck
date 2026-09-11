import assert from 'node:assert/strict'
import test from 'node:test'
import { toHash, fromHash } from '../../shared/routeHash.ts'

test('routeHash preserves encoded session and concurrent launch links', () => {
  const target = { provider: 'codex', root: 'r 2', slug: '/code/a?b', id: 's#1' }
  assert.equal(toHash(target), '#/codex/r%202/%2Fcode%2Fa%3Fb/s%231')
  assert.deepEqual(fromHash(toHash(target)), target)
  const draft = { provider: 'claude', root: 'r', cwd: '/same folder', launchId: 'launch-a', terminalKey: 'legacy|exact', draft: true }
  assert.equal(toHash(draft), '#/claude/r?launch=launch-a&terminal=legacy%7Cexact&draft=1&cwd=%2Fsame+folder')
  assert.deepEqual(fromHash(toHash(draft)), draft)
})

test('routeHash retains legacy Home links and tolerates malformed escapes', () => {
  assert.equal(toHash({ kind: 'folder', folderId: 'old' }), '#/')
  assert.deepEqual(fromHash('#/context/old'), { provider: null, view: 'activity' })
  assert.equal(fromHash('#/unknown/r', ['claude']), null)
  assert.deepEqual(fromHash('#/codex/r/%broken'), { provider: 'codex', root: 'r', slug: '%broken' })
  assert.deepEqual(fromHash('#/home/stats?scope=%broken&source=%broken'), { provider: null, view: 'stats' })
  const target = { provider: null, view: 'stats', homeScope: { excluded: ['codex'] }, homeSource: { provider: 'claude', root: 'r' } }
  assert.deepEqual(fromHash(toHash(target)), target)
})

test('routeHash distinguishes an empty JSON scope from an explicitly null legacy scope', () => {
  assert.deepEqual(fromHash('#/home/stats?scope=&source='), { provider: null, view: 'stats' })
  assert.deepEqual(fromHash('#/home/stats?scope=null'), { provider: null, view: 'stats', homeScope: { excluded: [] } })
  assert.deepEqual(fromHash('#/home/stats?source=null'), { provider: null, view: 'stats' })
})
