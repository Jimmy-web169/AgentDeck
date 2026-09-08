import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The provider protocol layer (spec/) must agree with the code: descriptors
// validate against the schema, fixture sessions parse to their goldens, and
// the descriptors describe every kind / part / token field the parsers emit.
// scripts/check-spec.mjs does the work; this keeps it inside `npm test`.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('spec: descriptors validate and fixture sessions parse to their goldens', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'check-spec.mjs')], { cwd: REPO, encoding: 'utf8' })
  assert.equal(r.status, 0, `check-spec failed:\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /check-spec: ok/)
})
