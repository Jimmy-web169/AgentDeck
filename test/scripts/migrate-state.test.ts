import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'

const run = (base: string, ...args: string[]) => spawnSync(process.execPath, ['scripts/migrate-state.ts', '--config-dir', base, ...args], { encoding: 'utf8' })
test('migration CLI defaults to inspection and explicitly copies without removing legacy records', () => {
  const base = temporaryDirectory('state-cli-')
  try {
    const source = path.join(base, 'roots.claude.json'),
      bytes = '[{"id":"same-id","dir":"/fixture/home","label":"Fixture"}]\n'
    fs.writeFileSync(source, bytes)
    const plan = run(base)
    assert.equal(plan.status, 0, plan.stderr)
    assert.equal(JSON.parse(plan.stdout).mode, 'plan')
    assert.equal(JSON.parse(plan.stdout).entries[0].status, 'copy')
    assert.equal(fs.existsSync(path.join(base, '.agentdeck')), false)
    const applied = run(base, '--apply')
    assert.equal(applied.status, 0, applied.stderr)
    assert.equal(JSON.parse(applied.stdout).entries[0].status, 'copied')
    assert.equal(fs.readFileSync(source, 'utf8'), bytes)
    assert.equal(fs.readFileSync(path.join(base, '.agentdeck', 'roots', 'claude.json'), 'utf8'), bytes)
    assert.equal(JSON.parse(run(base).stdout).entries[0].status, 'identical')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
test('migration CLI reports conflicts and rejects misspelled flags without writing', () => {
  const base = temporaryDirectory('state-cli-conflict-')
  try {
    const target = path.join(base, '.agentdeck', 'roots')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(base, 'roots.claude.json'), '[]')
    fs.writeFileSync(path.join(target, 'claude.json'), '[1]')
    const plan = run(base)
    assert.equal(plan.status, 1)
    assert.equal(JSON.parse(plan.stdout).entries[0].status, 'conflict')
    const apply = run(base, '--apply')
    assert.equal(apply.status, 1)
    assert.match(JSON.parse(apply.stderr).error, /conflicting/)
    assert.equal(fs.readFileSync(path.join(target, 'claude.json'), 'utf8'), '[1]')
    const unknown = run(base, '--aply')
    assert.equal(unknown.status, 1)
    assert.match(JSON.parse(unknown.stderr).error, /Unknown/)
    assert.equal(fs.existsSync(path.join(base, 'roots.claude.json.migrated')), false)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
