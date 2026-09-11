import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { applyContainerSeed, prepareContainerSeed, sourceMountArgs } from '../../scripts/container.ts'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'

test('container import preserves authoritative config bytes and root identities without copying runtime state', () => {
  const base = temporaryDirectory('container-seed-')
  try {
    const source = path.join(base, 'provider home')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'auth.json'), 'private provider data')
    const roots = JSON.stringify([{ id: 'stable-id', dir: source, label: 'Account' }])
    fs.writeFileSync(path.join(base, 'roots.claude.json'), roots)
    fs.mkdirSync(path.join(base, '.agentdeck/roots'), { recursive: true })
    fs.writeFileSync(path.join(base, 'roots.codex.json'), '["obsolete"]')
    fs.writeFileSync(path.join(base, '.agentdeck/roots/codex.json'), '[]\n')
    fs.mkdirSync(path.join(base, '.agentdeck/runtime'), { recursive: true })
    fs.writeFileSync(path.join(base, '.agentdeck/runtime/pids.json'), '[123]')
    fs.mkdirSync(path.join(base, 'dashboards'))
    fs.writeFileSync(path.join(base, 'dashboards/saved.json'), '{"id":"saved"}')
    const seed = prepareContainerSeed(base)
    assert.deepEqual(seed.sources, [source])
    assert.deepEqual(seed.files.map((file) => file.name).sort(), ['dashboards/saved.json', 'roots/claude.json', 'roots/codex.json'])
    const imported = seed.files.find((file) => file.name === 'roots/claude.json')
    assert.ok(imported)
    assert.equal(Buffer.from(imported.data, 'base64').toString(), roots)
    assert.equal(fs.readFileSync(path.join(base, 'roots.claude.json'), 'utf8'), roots)
    assert.deepEqual(sourceMountArgs([source, source]), ['--mount', `type=bind,src=${source},dst=${source},readonly`])
    assert.throws(() => sourceMountArgs(['/']), /Unsupported/)
    assert.throws(() => sourceMountArgs([`${source},readonly=false`]), /Unsupported/)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('container import rejects invalid JSON and state symlinks instead of following unrelated data', () => {
  const base = temporaryDirectory('container-invalid-')
  try {
    const file = path.join(base, 'roots.claude.json')
    fs.writeFileSync(file, '{bad')
    assert.throws(() => prepareContainerSeed(base), SyntaxError)
    fs.unlinkSync(file)
    fs.writeFileSync(path.join(base, 'private.json'), '[]')
    fs.symlinkSync(path.join(base, 'private.json'), file)
    assert.throws(() => prepareContainerSeed(base), /regular state file/)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('container receiver preflights paths and JSON, preserves bytes and refuses an occupied volume', () => {
  const base = temporaryDirectory('container-receiver-')
  const file = { name: 'roots/claude.json', data: Buffer.from('[]\n').toString('base64') }
  try {
    assert.throws(() => applyContainerSeed({ files: [file, { ...file, name: '../outside.json' }], sources: [] }, base), /Invalid seed path/)
    assert.deepEqual(fs.readdirSync(base), [])
    assert.throws(
      () => applyContainerSeed({ files: [file, { name: 'probe/claude.json', data: Buffer.from('bad').toString('base64') }], sources: [] }, base),
      SyntaxError
    )
    assert.deepEqual(fs.readdirSync(base), [])
    assert.throws(
      () =>
        applyContainerSeed(
          {
            files: [
              { ...file, name: 'dashboards/file' },
              { ...file, name: 'dashboards/file/nested.json' },
            ],
            sources: [],
          },
          base
        ),
      /Conflicting/
    )
    assert.deepEqual(fs.readdirSync(base), [])
    assert.equal(applyContainerSeed({ files: [file], sources: ['/source'] }, base), 1)
    assert.equal(fs.readFileSync(path.join(base, file.name), 'utf8'), '[]\n')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'runtime/container-sources.json'), 'utf8')), ['/source'])
    assert.throws(() => applyContainerSeed({ files: [], sources: [] }, base), /not empty/)
    assert.equal(fs.readFileSync(path.join(base, file.name), 'utf8'), '[]\n')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
