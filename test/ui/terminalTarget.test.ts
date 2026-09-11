import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mergeTerminalEntries, terminalRequest } from '../../src/lib/terminalTarget.ts'
import { newDraft } from '../../src/lib/tabs.ts'

const scope = { provider: 'codex', root: 'account-a', cwd: '/work/project' }

test('a stale pool poll cannot undo a Live identity update', () => {
  const old = { provider: 'claude', root: 'r', key: 'terminal', id: 'old' }
  const linked = { ...old, id: 'new' }
  assert.deepEqual(mergeTerminalEntries([old], [linked]), [linked])
})

test('reattach sends the server key only; it cannot silently resume or create another CLI', () => {
  assert.deepEqual(terminalRequest({ ...scope, id: 'other', terminalKey: 'exact' }), { root: scope.root, terminalKey: 'exact' })
  const draft = newDraft(scope)
  const request = terminalRequest(draft)
  assert.ok('launchId' in request)
  assert.equal(request.launchId, draft.launchId)
})
