// Empty projects must never stand in for actual strict compiler coverage.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
function check(
  t: test.TestContext,
  config: Record<string, unknown>,
  source?: string,
  uiConfig: Record<string, unknown> = { compilerOptions: options, files: ['valid.ts'] }
) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tmp', 'type-gate-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(config))
  fs.writeFileSync(path.join(dir, 'tsconfig.ui.json'), JSON.stringify(uiConfig))
  for (const name of ['tsconfig.tools.json', 'tsconfig.test.json'])
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ compilerOptions: options, files: ['valid.ts'] }))
  fs.writeFileSync(path.join(dir, 'valid.ts'), 'export {}\n')
  fs.writeFileSync(path.join(dir, 'reference.json'), JSON.stringify({ compilerOptions: { composite: true }, files: ['valid.ts'] }))
  fs.mkdirSync(path.join(dir, 'shared'))
  fs.writeFileSync(path.join(dir, 'shared/types.d.ts'), 'export {}\n')
  if (source) fs.writeFileSync(path.join(dir, 'sample.ts'), source)
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-types.ts')], { cwd: dir, encoding: 'utf8' })
}
const options = { allowJs: false, strict: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true, noEmit: true, types: [] }
test('type gate rejects a populated project with weakened compiler settings', (t) => {
  const result = check(t, { compilerOptions: { ...options, strict: false, allowJs: true }, files: ['valid.ts'] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must enable strict, erasableSyntaxOnly and verbatimModuleSyntax, and disable allowJs/)
})
test('type gate rejects the retired explicitly empty bootstrap project', (t) => {
  const result = check(t, { compilerOptions: options, include: [] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /No inputs were found/)
})
test('type gate rejects invalid options even in an empty project', (t) => {
  const result = check(t, { compilerOptions: { ...options, inventedOption: true }, include: [] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown compiler option/)
})
test('type gate rejects an accidentally empty non-bootstrap file pattern', (t) => {
  const result = check(t, { compilerOptions: options, include: ['missing/**/*.ts'] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /No inputs were found/)
})
test('type gate reports actual TypeScript type errors', (t) => {
  const result = check(t, { compilerOptions: options, include: ['sample.ts'] }, 'let count: number = "invalid"\n')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not assignable to type/)
})

test('type gate rejects reference-only empty server and UI projects without claiming coverage', (t) => {
  const empty = { compilerOptions: options, files: [], references: [{ path: './reference.json' }] }
  const result = check(t, empty, undefined, empty)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /tsconfig\.json must contain at least one root source file/)
  assert.match(result.stderr, /tsconfig\.ui\.json must contain at least one root source file/)
  assert.doesNotMatch(result.stdout, /0 root files checked/)
  assert.match(result.stdout, /generated declarations checked independently/)
})

test('type gate succeeds only after checking real source in all four projects', (t) => {
  const result = check(t, { compilerOptions: options, files: ['sample.ts'] }, 'let count: number = 1\n')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /tsconfig\.json: 1 root files checked/)
  assert.match(result.stdout, /tsconfig\.ui\.json: 1 root files checked/)
})
