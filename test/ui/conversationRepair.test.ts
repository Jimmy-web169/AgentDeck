import { mockNavSession } from '../helpers/query.ts'
// Original test group: conversation-repair. Assertions retained during module-path migration.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { repairCandidates } from '../../src/lib/conversationRepair.ts'

test('repair lists only the current root and exact folder, without a newest-folder fallback', async () => {
  const calls: unknown[] = []
  const api: Parameters<typeof repairCandidates>[0] = {
    projects: async ({ root }) => {
      calls.push(['projects', root])
      return {
        projects: [
          { slug: 'other', cwd: '/other', sessionCount: 0, lastActivity: 0 },
          { slug: 'here', cwd: '/current', sessionCount: 0, lastActivity: 0 },
        ],
      }
    },
    sessions: async ({ root, slug }) => {
      calls.push(['sessions', root, slug])
      return { sessions: [{ id: 'valid' }, { id: 'child', isSubagent: true }, { id: 'wrong', cwd: '/other' }].map(mockNavSession) }
    },
  }
  assert.deepEqual(await repairCandidates(api, 'account', '/current'), [{ ...mockNavSession({ id: 'valid' }), slug: 'here' }])
  assert.deepEqual(calls, [
    ['projects', 'account'],
    ['sessions', 'account', 'here'],
  ])
  calls.length = 0
  assert.deepEqual(await repairCandidates(api, 'account', '/missing'), [])
  assert.deepEqual(calls, [['projects', 'account']])
  calls.length = 0
  assert.deepEqual(await repairCandidates(api, 'account', null), [])
  assert.deepEqual(calls, [])
})
