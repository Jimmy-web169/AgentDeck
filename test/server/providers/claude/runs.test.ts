import { temporaryDirectory } from '../../../helpers/tmpConfigDir.ts'
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { discoverPlainAgents } from '../../../../server/providers/claude/runs.ts'

describe('subagent-linkage/claude/runs', async () => {
  // The inline sub-agent thread (Conversation view) links a parent's tool call to
  // the child transcript with the ids each CLI leaves on disk. These tests pin the
  // server side of that contract: the fields the client adapters key on.

  const line = (o: {
    type: string
    timestamp?: string
    agentId?: string
    message:
      | { role: string; content: string }
      | {
          role: string
          model: string
          stop_reason: string
          usage: { input_tokens: number; output_tokens: number }
          content: { type: string; id: string; name: string; input: Record<string, unknown> }[]
        }
      | { role: string; model: string; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; content: { type: string; text: string }[] }
      | { role: string; content: string }
      | { role: string; content: string }
  }) => JSON.stringify(o) + '\n'

  test('claude: plain sub-agents surface the sidecar toolUseId and a tool-call count', () => {
    const root = temporaryDirectory('agentdeck-claude-agents-')
    try {
      const dir = path.join(root, 'projects', 'C--repo', 'sess-1', 'subagents')
      fs.mkdirSync(path.join(dir, 'workflows', 'wf_x'), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'agent-aaa111.jsonl'),
        line({ type: 'user', timestamp: '2026-07-19T11:48:43.654Z', agentId: 'aaa111', message: { role: 'user', content: 'do it' } }) +
          line({
            type: 'assistant',
            timestamp: '2026-07-19T11:48:50.000Z',
            message: {
              role: 'assistant',
              model: 'claude-x',
              stop_reason: 'tool_use',
              usage: { input_tokens: 10, output_tokens: 5 },
              content: [
                { type: 'tool_use', id: 'toolu_child1', name: 'Read', input: {} },
                { type: 'tool_use', id: 'toolu_child2', name: 'Grep', input: {} },
              ],
            },
          }) +
          line({
            type: 'assistant',
            timestamp: '2026-07-19T11:49:05.000Z',
            message: {
              role: 'assistant',
              model: 'claude-x',
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 7 },
              content: [{ type: 'text', text: 'Summary' }],
            },
          })
      )
      // the sidecar Claude Code writes when the Agent/Task tool spawns an agent —
      // toolUseId is the parent's tool_use block id
      fs.writeFileSync(
        path.join(dir, 'agent-aaa111.meta.json'),
        JSON.stringify({ agentType: 'Explore', description: 'Summarise the repo', toolUseId: 'toolu_parent01', spawnDepth: 1 })
      )
      // an agent without a sidecar (older Claude Code) still lists, just unlinked
      fs.writeFileSync(
        path.join(dir, 'agent-bbb222.jsonl'),
        line({ type: 'user', timestamp: '2026-07-19T11:50:00.000Z', message: { role: 'user', content: 'x' } })
      )
      // a workflow run's agents must not leak into the plain list
      fs.writeFileSync(path.join(dir, 'workflows', 'wf_x', 'agent-ccc333.jsonl'), line({ type: 'user', message: { role: 'user', content: 'y' } }))

      const agents = discoverPlainAgents(root, 'C--repo', 'sess-1')
      assert.deepEqual(agents.map((a) => a.id).sort(), ['aaa111', 'bbb222'])
      const a = agents.find((x) => x.id === 'aaa111')
      assert.ok(a)
      assert.equal(a.toolUseId, 'toolu_parent01')
      assert.ok(a)
      assert.equal(a.spawnDepth, 1)
      assert.ok(a)
      assert.equal(a.agentType, 'Explore')
      assert.ok(a)
      assert.equal(a.description, 'Summarise the repo')
      assert.ok(a)
      assert.equal(a.toolCalls, 2)
      assert.ok(a)
      assert.equal(a.status, 'done')
      assert.ok(a)
      assert.equal(a.tokens.output, 12)
      const b = agents.find((x) => x.id === 'bbb222')
      assert.ok(b)
      assert.equal(b.toolUseId, null)
      assert.ok(b)
      assert.equal(b.spawnDepth, null)
      assert.ok(b)
      assert.equal(b.toolCalls, 0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
