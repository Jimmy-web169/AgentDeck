import { temporaryDirectory } from '../../../helpers/tmpConfigDir.ts'
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { childrenOf, invalidateIndex } from '../../../../server/providers/codex/paths.ts'

describe('subagent-linkage/codex/paths', async () => {
  // The inline sub-agent thread (Conversation view) links a parent's tool call to
  // the child transcript with the ids each CLI leaves on disk. These tests pin the
  // server side of that contract: the fields the client adapters key on.

  const line = (o: {
    timestamp: string
    type: string
    payload:
      | { id: string; cwd: string }
      | {
          id: string
          cwd: string
          source: { subagent: { thread_spawn: { parent_thread_id: string; depth: number; agent_path: string; agent_nickname: string; agent_role: null } } }
        }
      | { id: string; cwd: string; thread_source: string; note: string }
  }) => JSON.stringify(o) + '\n'

  test('codex: children carry agentPath + startTs so spawn_agent calls can be matched', () => {
    const root = temporaryDirectory('agentdeck-codex-children-')
    try {
      const parentId = '01a07094-5ec4-7f50-9ff9-1e3ef6ffaa89'
      const childId = '01a0709c-6877-7221-9996-d650a3799968'
      const otherId = '01a070a3-98c3-7881-9b66-704c1be30513'
      const dir = path.join(root, 'sessions', '2026', '09', '05')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, `rollout-2026-09-05T15-59-26-${parentId}.jsonl`),
        line({ timestamp: '2026-09-05T07:59:26.000Z', type: 'session_meta', payload: { id: parentId, cwd: 'C:/repo' } })
      )
      // the shape Codex writes for a spawned child (session_meta is the first line)
      fs.writeFileSync(
        path.join(dir, `rollout-2026-09-05T16-08-13-${childId}.jsonl`),
        line({
          timestamp: '2026-09-05T08:08:13.700Z',
          type: 'session_meta',
          payload: {
            id: childId,
            cwd: 'C:/repo',
            source: {
              subagent: {
                thread_spawn: { parent_thread_id: parentId, depth: 1, agent_path: '/root/inspect_chrome_form', agent_nickname: 'Leibniz', agent_role: null },
              },
            },
          },
        })
      )
      // a thread that merely mentions the parent id is not a spawned child
      fs.writeFileSync(
        path.join(dir, `rollout-2026-09-05T16-16-04-${otherId}.jsonl`),
        line({
          timestamp: '2026-09-05T08:16:04.000Z',
          type: 'session_meta',
          payload: { id: otherId, cwd: 'C:/repo', thread_source: 'agent_created_thread', note: parentId },
        })
      )
      invalidateIndex(root)

      const kids = childrenOf(root, parentId)
      assert.equal(kids.length, 1)
      assert.equal(kids[0].id, childId)
      assert.equal(kids[0].agentPath, '/root/inspect_chrome_form')
      assert.equal(kids[0].agentNickname, 'Leibniz')
      assert.equal(kids[0].startTs, '2026-09-05T08:08:13.700Z')
      assert.equal(kids[0].depth, 1)
      assert.equal(childrenOf(root, otherId).length, 0)
    } finally {
      invalidateIndex(root)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
