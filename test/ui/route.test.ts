import assert from 'node:assert/strict'
import { test, vi } from 'vitest'
import { currentHash, replaceHash, fromHash, toHash } from '../../src/lib/route.ts'
import { newDraft, sameTarget } from '../../src/lib/tabs.ts'

const scope = { provider: 'codex', root: 'account-a', cwd: '/work/project' }

test('route adapter round-trips Home scope and replaces browser history only when needed', () => {
  const target = { provider: null, view: 'resources', homeScope: { excluded: ['codex'] }, homeSource: { provider: 'claude', root: 'work' } }
  assert.deepEqual(fromHash(toHash(target)), target)
  assert.equal(toHash({ kind: 'folder', folderId: 'a', title: 'Project' }), '#/')
  assert.deepEqual(fromHash('#/folder/a'), { provider: null, view: 'activity' })
  const dashboard = { kind: 'dashboard', dashboardId: 'a' }
  assert.deepEqual(fromHash(toHash(dashboard)), dashboard)
  assert.equal(sameTarget({ kind: 'dashboard', dashboardId: 'd' }, fromHash(toHash({ kind: 'dashboard', dashboardId: 'd' }))), true)
  const previous = { location: globalThis.location, history: globalThis.history }
  const calls: unknown[] = []
  try {
    Reflect.deleteProperty(globalThis, 'location')
    Reflect.deleteProperty(globalThis, 'history')
    assert.equal(currentHash(), '')
    replaceHash('#ignored-without-browser')
    vi.stubGlobal('location', { hash: '#old' })
    vi.stubGlobal('history', { replaceState: (...args: unknown[]) => calls.push(args) })
    assert.equal(currentHash(), '#old')
    replaceHash('#old')
    assert.equal(calls.length, 0)
    replaceHash('#new')
    assert.deepEqual(calls, [[null, '', '#new']])
    globalThis.history.replaceState = () => {
      throw new Error('History unavailable')
    }
    assert.doesNotThrow(() => replaceHash('#new'))
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key)
      else Reflect.set(globalThis, key, value)
    }
  }
})

test('deep links restore exact drafts and saved sessions without creating project tabs', () => {
  for (const target of [newDraft(scope), { ...newDraft(scope), terminalKey: 'codex|root|launch|key' }, { ...scope, id: 'session-a' }]) {
    const restored = fromHash(toHash(target), ['codex'])
    assert.equal(sameTarget(target, restored), true)
    assert.ok(restored)
    assert.equal(restored.cwd, scope.cwd)
  }
})
