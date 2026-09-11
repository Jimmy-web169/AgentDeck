import { required } from '../../helpers/assert.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { homeHistory, homeProjects } from '../../../server/shared/homeQuery.ts'

test('explicit empty project scopes do not expand, and malformed lists fail closed', () => {
  assert.equal(homeHistory([{ display: 'Past question', project: '/no-longer-exists' }], new URLSearchParams({ home: '1' })).history.length, 1)
  assert.equal(homeProjects(new URLSearchParams()), null)
  assert.equal(required(homeProjects(new URLSearchParams({ slugs: '[]' }))).size, 0)
  assert.throws(() => homeProjects(new URLSearchParams({ slugs: '{}' })), { status: 400 })
  assert.deepEqual(homeHistory([{ project: '/fictional', display: 'Question' }], new URLSearchParams({ home: '1', cwds: '[]' })).history, [])
})
