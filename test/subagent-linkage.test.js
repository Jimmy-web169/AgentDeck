import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverPlainAgents } from '../server/providers/claude/runs.js'
import { childrenOf, invalidateIndex } from '../server/providers/codex/paths.js'

// The inline sub-agent thread (Conversation view) links a parent's tool call to
// the child transcript with the ids each CLI leaves on disk. These tests pin the
// server side of that contract: the fields the client adapters key on.

const line = (o) => JSON.stringify(o) + '\n'

test('claude: plain sub-agents surface the sidecar toolUseId and a tool-call count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-claude-agents-'))
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
          message: { role: 'assistant', model: 'claude-x', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 7 }, content: [{ type: 'text', text: 'Summary' }] },
        })
    )
    // the sidecar Claude Code writes when the Agent/Task tool spawns an agent —
    // toolUseId is the parent's tool_use block id
    fs.writeFileSync(path.join(dir, 'agent-aaa111.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Summarise the repo', toolUseId: 'toolu_parent01', spawnDepth: 1 }))
    // an agent without a sidecar (older Claude Code) still lists, just unlinked
    fs.writeFileSync(path.join(dir, 'agent-bbb222.jsonl'), line({ type: 'user', timestamp: '2026-07-19T11:50:00.000Z', message: { role: 'user', content: 'x' } }))
    // a workflow run's agents must not leak into the plain list
    fs.writeFileSync(path.join(dir, 'workflows', 'wf_x', 'agent-ccc333.jsonl'), line({ type: 'user', message: { role: 'user', content: 'y' } }))

    const agents = discoverPlainAgents(root, 'C--repo', 'sess-1')
    assert.deepEqual(agents.map((a) => a.id).sort(), ['aaa111', 'bbb222'])
    const a = agents.find((x) => x.id === 'aaa111')
    assert.equal(a.toolUseId, 'toolu_parent01')
    assert.equal(a.spawnDepth, 1)
    assert.equal(a.agentType, 'Explore')
    assert.equal(a.description, 'Summarise the repo')
    assert.equal(a.toolCalls, 2)
    assert.equal(a.status, 'done')
    assert.equal(a.tokens.output, 12)
    const b = agents.find((x) => x.id === 'bbb222')
    assert.equal(b.toolUseId, null)
    assert.equal(b.spawnDepth, null)
    assert.equal(b.toolCalls, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('codex: children carry agentPath + startTs so spawn_agent calls can be matched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-codex-children-'))
  try {
    const parentId = '01a07094-5ec4-7f50-9ff9-1e3ef6ffaa89'
    const childId = '01a0709c-6877-7221-9996-d650a3799968'
    const otherId = '01a070a3-98c3-7881-9b66-704c1be30513'
    const dir = path.join(root, 'sessions', '2026', '09', '05')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `rollout-2026-09-05T15-59-26-${parentId}.jsonl`), line({ timestamp: '2026-09-05T07:59:26.000Z', type: 'session_meta', payload: { id: parentId, cwd: 'C:/repo' } }))
    // the shape Codex writes for a spawned child (session_meta is the first line)
    fs.writeFileSync(
      path.join(dir, `rollout-2026-09-05T16-08-13-${childId}.jsonl`),
      line({
        timestamp: '2026-09-05T08:08:13.700Z',
        type: 'session_meta',
        payload: {
          id: childId,
          cwd: 'C:/repo',
          source: { subagent: { thread_spawn: { parent_thread_id: parentId, depth: 1, agent_path: '/root/inspect_chrome_form', agent_nickname: 'Leibniz', agent_role: null } } },
        },
      })
    )
    // a thread that merely mentions the parent id is not a spawned child
    fs.writeFileSync(path.join(dir, `rollout-2026-09-05T16-16-04-${otherId}.jsonl`), line({ timestamp: '2026-09-05T08:16:04.000Z', type: 'session_meta', payload: { id: otherId, cwd: 'C:/repo', thread_source: 'agent_created_thread', note: parentId } }))
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
