import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'
// Original test group: roots. Assertions retained during module-path migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { HOME, idFor, makeRoots } from '../../../server/shared/roots.ts'

const tmp = () => temporaryDirectory('agentdeck-roots-')
const homeRelative = (dir: string) => (dir.startsWith(HOME) ? `~${dir.slice(HOME.length)}` : dir)

function setup() {
  const base = tmp()
  const configPath = path.join(base, 'roots.json')
  const roots = makeRoots({ configPath, autodetectSeed: () => [], dataProbe: (dir) => ({ hasProjects: fs.existsSync(path.join(dir, 'projects')) }) })
  return { base, configPath, roots }
}

test('roots: add, duplicate, list meta, resolve', () => {
  const { base, roots } = setup()
  const dir = path.join(base, 'home-a')
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true })
  const { id } = roots.addRoot(dir)
  assert.equal(id, idFor(dir))
  assert.throws(() => roots.addRoot(dir), /already tracked/)
  assert.throws(() => roots.addRoot(path.join(base, 'missing')), /Not a directory/)
  const [meta] = roots.rootsWithMeta()
  assert.equal(meta.id, id)
  assert.equal(meta.dir, dir)
  assert.equal(meta.exists, true)
  assert.equal(meta.hasProjects, true)
  assert.equal(meta.label, homeRelative(dir), 'a label that is just the dir shows home-relative')
  assert.equal(roots.resolveRoot(id).dir, dir)
  assert.equal(roots.resolveRoot(undefined).dir, dir, 'no id → the first root')
  assert.throws(() => roots.resolveRoot('nope'), /Unknown root/)
})

test('roots: rename keeps the id, empty label falls back to the default, remove forgets', () => {
  const { base, configPath, roots } = setup()
  const dir = path.join(base, 'home-b')
  fs.mkdirSync(dir)
  const { id } = roots.addRoot(dir, '  ')
  assert.equal(roots.rootsWithMeta()[0].label, homeRelative(dir))

  assert.deepEqual(roots.renameRoot(id, ' work '), { id, label: 'work' })
  assert.equal(roots.rootsWithMeta()[0].label, 'work')
  assert.equal(roots.rootsWithMeta()[0].id, id)
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8'))[0].label, 'work', 'persisted')

  roots.renameRoot(id, '')
  assert.equal(roots.rootsWithMeta()[0].label, homeRelative(dir))
  assert.throws(() => roots.renameRoot('nope', 'x'), /Root not found/)

  assert.deepEqual(roots.removeRoot(id), { removed: id })
  assert.equal(roots.rootsWithMeta().length, 0)
  assert.throws(() => roots.removeRoot(id), /Root not found/)
  assert.throws(() => roots.resolveRoot(id), /No tracked folders/)
})

test('roots: built-in default roots are re-added when the config omits them', () => {
  const { base, roots: seeded } = setup()
  const dflt = path.join(base, 'default-home')
  fs.mkdirSync(dflt)
  const other = path.join(base, 'other')
  fs.mkdirSync(other)
  seeded.addRoot(other)
  const configPath = path.join(base, 'roots.json')
  const roots = makeRoots({ configPath, autodetectSeed: () => [], defaultRoots: () => [{ id: idFor(dflt), label: dflt, dir: dflt }], dataProbe: () => ({}) })
  const dirs = roots.rootsWithMeta().map((r) => r.dir)
  assert.ok(dirs.includes(other))
  assert.ok(dirs.includes(dflt))
})
