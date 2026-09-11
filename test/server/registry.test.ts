import { required } from '../helpers/assert.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'
import { PROVIDERS } from '../../server/registry.ts'

test('Codex watcher includes the parent id for a new subagent rollout', () => {
  const rootDir = temporaryDirectory('agentdeck-codex-watch-')
  const parentId = '11111111-1111-4111-8111-111111111111'
  const childId = '22222222-2222-4222-8222-222222222222'
  const sessionDir = path.join(rootDir, 'sessions', '2026', '07', '21')
  fs.mkdirSync(sessionDir, { recursive: true })
  const file = path.join(sessionDir, `rollout-2026-07-21T12-00-00-${childId}.jsonl`)
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      timestamp: '2026-07-21T12:00:00.000Z',
      payload: {
        cwd: 'C:/repo',
        source: { subagent: { thread_spawn: { parent_thread_id: parentId, agent_role: 'worker' } } },
      },
    })}\n`
  )
  try {
    const change = required(PROVIDERS.codex.watch).toEvent('root-a', rootDir, file)
    assert.deepEqual(change, {
      provider: 'codex',
      root: 'root-a',
      id: childId,
      slug: 'C:/repo',
      parentId,
    })
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})
