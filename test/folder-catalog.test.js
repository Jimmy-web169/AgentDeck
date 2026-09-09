import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFolderCatalog, folderIdentity } from '../server/deck/catalog.js'
import { isHome, openTabState, sameTarget, loadTabs, TABS_KEY } from '../src/lib/tabs.js'
import { toHash, fromHash } from '../src/lib/route.js'

const source = (id, cwd, { fail = false, sessions = [] } = {}) => ({ id, loadRoots: () => [{ id: 'root', label: 'Account' }], dispatch: async (_method, endpoint) => fail
  ? { status: 503, body: { error: 'unavailable' } }
  : { status: 200, body: endpoint === '/api/projects' ? { projects: [{ slug: id + '-project', cwd, sessionCount: sessions.length }] } : { sessions } } })

test('catalog merges the same real cwd across providers but retains each source/session identity', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-catalog-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const session = { id: 'same-native-id', title: 'Task', lastTs: '2026-09-01T12:00:00Z' }
  const providers = { a: source('a', dir, { sessions: [session] }), b: source('b', dir, { sessions: [session] }), c: source('c', dir, { fail: true }) }
  const catalog = createFolderCatalog(providers)
  const list = await catalog.list()
  assert.equal(list.folders.length, 1)
  assert.equal(list.folders[0].sources.length, 2)
  assert.equal(list.errors[0].provider, 'c')
  assert.equal(list.folders[0].sessionCount, 2)
  assert.deepEqual(list.folders[0].sources.map((s) => s.provider), ['a', 'b'])
  assert.equal(catalog.detail, undefined)
})

test('folder identity never merges missing paths or equal basenames; symlinks use realpath', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-folder-id-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = path.join(dir, 'a', 'project'), b = path.join(dir, 'b', 'project')
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true })
  assert.notEqual(folderIdentity(a, {}).id, folderIdentity(b, {}).id)
  assert.notEqual(folderIdentity(null, { provider: 'a' }).id, folderIdentity(null, { provider: 'b' }).id)
  const alias = path.join(dir, 'alias')
  fs.symlinkSync(a, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(folderIdentity(a, {}).id, folderIdentity(alias, {}).id)
})

test('retired standalone folder links and stored tabs migrate to Activity; dashboards are unchanged', () => {
  const target = { kind: 'folder', folderId: 'a', title: 'Project' }
  assert.equal(toHash(target), '#/')
  assert.deepEqual(fromHash('#/folder/a'), { provider: null, view: 'activity' })
  const prev = globalThis.localStorage
  globalThis.localStorage = { getItem: (k) => k === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'old', target }], activeKey: 'old' }) : null }
  try {
    assert.deepEqual(loadTabs().tabs[0].target, { provider: null, view: 'activity', focus: null })
    assert.equal(loadTabs().activeKey, 'old')
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev }
  const dashboard = { kind: 'dashboard', dashboardId: 'a' }
  assert.deepEqual(fromHash(toHash(dashboard)), dashboard)
  assert.equal(isHome(dashboard), false)
})
