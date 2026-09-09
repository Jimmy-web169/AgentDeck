import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { repairCandidates } from '../src/lib/conversationRepair.js'
import { canRepairConversation } from '../src/lib/terminalStatus.js'

test('repair is offered only after an unidentified loaded terminal has waited', () => {
  const ready = { running: true, frameLoaded: true, delayed: true, repair: true }
  assert.equal(canRepairConversation(ready), true)
  for (const change of [{ loading: true }, { running: false }, { frameLoaded: false }, { id: 'identified' }, { delayed: false }, { repair: null }]) {
    assert.equal(canRepairConversation({ ...ready, ...change }), false)
  }
})

test('repair lists only the current root and exact folder, without a newest-folder fallback', async () => {
  const calls = []
  const api = {
    projects: async (root) => { calls.push(['projects', root]); return { projects: [{ slug: 'other', cwd: '/other' }, { slug: 'here', cwd: '/current' }] } },
    sessions: async (root, slug) => {
      calls.push(['sessions', root, slug])
      return { sessions: [{ id: 'valid' }, { id: 'child', isSubagent: true }, { id: 'wrong', cwd: '/other' }] }
    },
  }
  assert.deepEqual(await repairCandidates(api, 'account', '/current'), [{ id: 'valid', slug: 'here' }])
  assert.deepEqual(calls, [['projects', 'account'], ['sessions', 'account', 'here']])
  calls.length = 0
  assert.deepEqual(await repairCandidates(api, 'account', '/missing'), [])
  assert.deepEqual(calls, [['projects', 'account']])
  calls.length = 0
  assert.deepEqual(await repairCandidates(api, 'account', null), [])
  assert.deepEqual(calls, [])
})

test('repair is nested in status details, not a toolbar action; the dialog has no folder picker', () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
  const status = read('../src/components/shared/TerminalStatus.jsx')
  assert.match(status, /canRepairConversation/)
  assert.match(status, /<details[\s\S]*Trouble detecting this conversation\?[\s\S]*props.repair[\s\S]*<\/details>/)
  for (const provider of ['claude', 'codex']) {
    const panel = read(`../src/components/${provider}/TerminalPanel.jsx`)
    assert.match(panel, /<TerminalStatus[\s\S]*repair=\{canLink && key && cwd/)
    assert.equal((panel.match(/<LinkConversationButton/g) || []).length, 1)
  }
  const dialog = read('../src/components/shared/LinkConversationButton.jsx')
  assert.match(dialog, /Match current conversation manually/)
  assert.doesNotMatch(dialog, /<select|setSlug|Link saved conversation/)
})
