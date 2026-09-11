import type { HttpProvider } from '../../../server/http.ts'
import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'
// Original test group: folder-catalog. Assertions retained during module-path migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createFolderCatalog, folderIdentity } from '../../../server/deck/catalog.ts'

const source = (
  id: string,
  cwd: string,
  { fail = false, sessions = [] }: { fail?: boolean; sessions?: { id: string; title: string; lastTs: string }[] } = {}
): HttpProvider => ({
  id,
  loadRoots: () => [{ id: 'root', label: 'Account', dir: cwd }],
  dispatch: async (_method, endpoint) =>
    fail
      ? { status: 503, body: { error: 'unavailable' } }
      : { status: 200, body: endpoint === '/api/projects' ? { projects: [{ slug: id + '-project', cwd, sessionCount: sessions.length }] } : { sessions } },
})

test('catalog merges the same real cwd across providers but retains each source/session identity', async (t) => {
  const dir = temporaryDirectory('agentdeck-catalog-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const session = { id: 'same-native-id', title: 'Task', lastTs: '2026-09-01T12:00:00Z' }
  const providers = { a: source('a', dir, { sessions: [session] }), b: source('b', dir, { sessions: [session] }), c: source('c', dir, { fail: true }) }
  const catalog = createFolderCatalog(providers)
  const list = await catalog.list()
  assert.equal(list.folders.length, 1)
  assert.equal(list.folders[0].sources.length, 2)
  assert.equal(list.errors[0].provider, 'c')
  assert.equal(list.folders[0].sessionCount, 2)
  assert.deepEqual(
    list.folders[0].sources.map((s) => s.provider),
    ['a', 'b']
  )
  assert.equal('detail' in catalog ? catalog.detail : undefined, undefined)
})

test('folder identity never merges missing paths or equal basenames; symlinks use realpath', (t) => {
  const dir = temporaryDirectory('agentdeck-folder-id-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = path.join(dir, 'a', 'project'),
    b = path.join(dir, 'b', 'project')
  fs.mkdirSync(a, { recursive: true })
  fs.mkdirSync(b, { recursive: true })
  assert.notEqual(folderIdentity(a, {}).id, folderIdentity(b, {}).id)
  assert.notEqual(folderIdentity(null, { provider: 'a' }).id, folderIdentity(null, { provider: 'b' }).id)
  const alias = path.join(dir, 'alias')
  fs.symlinkSync(a, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(folderIdentity(a, {}).id, folderIdentity(alias, {}).id)
})
