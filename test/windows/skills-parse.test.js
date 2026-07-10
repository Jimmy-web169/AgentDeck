// parseSkillsAdd / buildSkillsArgv: what the "Install a skill" UI feeds to the
// skills CLI. Pure parsing — no process is spawned here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSkillsAdd, buildSkillsArgv } from '../../server/shared/skills.js'

test('accepts owner/repo', () => {
  assert.deepEqual(parseSkillsAdd('vercel-labs/skills'), ['vercel-labs/skills'])
})

test('accepts a full npx command with flags', () => {
  const args = parseSkillsAdd('npx skills add https://github.com/vercel-labs/skills --skill find-skills -y')
  assert.ok(args.includes('https://github.com/vercel-labs/skills'))
  assert.ok(args.includes('--skill'))
  assert.ok(args.includes('find-skills'))
})

test('forceAgent strips user-supplied agent flags', () => {
  const args = parseSkillsAdd('owner/repo -a codex --agent=claude-code', { forceAgent: true })
  assert.deepEqual(args, ['owner/repo'])
})

test('rejects things that are not a skill source', () => {
  assert.throws(() => parseSkillsAdd('rm -rf /'), /does not look like a skill source/)
  assert.throws(() => parseSkillsAdd(''), /empty reference/)
})

test('buildSkillsArgv pins agent and scope flags', () => {
  const argv = buildSkillsArgv(['owner/repo'], { global: true, agent: 'claude-code' })
  assert.deepEqual(argv, ['-y', 'skills', 'add', 'owner/repo', '-a', 'claude-code', '-g', '-y'])
})
