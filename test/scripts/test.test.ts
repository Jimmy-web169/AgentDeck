import assert from 'node:assert/strict'
import test from 'node:test'
import { nodeSummary, vitestSummary, combineTap, discoverTests } from '../../scripts/test.ts'
import fs from 'node:fs'
import path from 'node:path'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'

test('test discovery assigns plain TypeScript to Node and JSX to Vitest exactly once', () => {
  const root = temporaryDirectory('runner-discovery-')
  const expected = {
    node: ['test/integration/http.test.ts', 'test/server/adapter.test.cjs', 'test/server/parser.test.mjs', 'test/server/types.test.ts'],
    vitest: ['test/integration/TerminalPanel.test.tsx', 'test/shared/view.test.tsx', 'test/ui/App.test.js'],
  }
  for (const file of [...expected.node, ...expected.vitest, 'test/integration/notes.jsx']) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '')
  }
  const actual = discoverTests(root)
  for (const runner of ['node', 'vitest'] as const)
    assert.deepEqual(actual[runner].map((file: string) => path.relative(root, file).split(path.sep).join('/')).sort(), expected[runner].sort())
  const files = [...actual.node, ...actual.vitest]
  assert.equal(new Set(files).size, files.length)
})

const node =
  'TAP version 13\n# Subtest: retained case\nok 1 - retained case\n# Subtest: platform case\nok 2 - platform case # SKIP\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n'
const assertion: { title: string; ancestorTitles: string[]; status: string; failureMessages: string[] } = {
  title: 'UI behavior',
  ancestorTitles: ['group'],
  status: 'passed',
  failureMessages: [],
}
const passed = () => ({
  success: true,
  numTotalTests: 1,
  numTotalTestSuites: 1,
  testResults: [{ name: 'ui.test.js', status: 'passed', message: '', assertionResults: [structuredClone(assertion)] }],
})

test('test runner merges Node and Vitest cases, suite nesting and platform skips', () => {
  assert.deepEqual(nodeSummary(node), { topLevel: 2, tests: 2, suites: 0, pass: 1, fail: 0, cancelled: 0, skipped: 1, todo: 0 })
  const output = combineTap(node, passed())
  assert.match(output, /# Subtest: retained case/)
  assert.match(output, /# Subtest: group\n\s+# Subtest: UI behavior/)
  assert.match(output, /# tests 3\n# suites 1\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 1/)
  assert.equal((output.match(/^1\.\.3$/gm) || []).length, 1)
  const twins = passed()
  twins.numTotalTests = twins.numTotalTestSuites = 2
  twins.testResults = ['codex', 'antigravity'].map((provider) => ({
    ...passed().testResults[0],
    name: `test/ui/components/${provider}/ResourcePreview.test.jsx`,
  }))
  const distinct = combineTap(node, twins)
  assert.match(distinct, /# Subtest: test\/ui\/components\/codex\/ResourcePreview.test.jsx/)
  assert.match(distinct, /# Subtest: test\/ui\/components\/antigravity\/ResourcePreview.test.jsx/)
})

test('test runner rejects incomplete Node plans and incomplete Vitest inventories', () => {
  assert.throws(() => nodeSummary('TAP version 13\n# tests 0'), /complete TAP summary/)
  assert.throws(() => vitestSummary({ ...passed(), success: false }), /unsuccessful/)
  assert.throws(() => vitestSummary({ ...passed(), numTotalTests: 2 }), /inventory/)
  assert.throws(() => vitestSummary({ testResults: [] }), /collect/)
})

test('test runner reports collection and afterAll failures even when no assertion failed', () => {
  const collection = {
    success: false,
    numTotalTests: 0,
    testResults: [{ name: 'broken.test.js', status: 'failed', message: 'Failed to load import', assertionResults: [] }],
  }
  assert.equal(vitestSummary(collection).fail, 1)
  assert.match(combineTap(node, collection), /not ok .*test file collection or hook failure/)
  const hook = passed()
  hook.success = false
  hook.testResults[0].status = 'failed'
  hook.testResults[0].message = 'afterAll failed'
  const result = vitestSummary(hook)
  assert.equal(result.pass, 1)
  assert.equal(result.fail, 1)
  assert.match(combineTap(node, hook), /afterAll failed/)
})

test('test runner preserves assertion failure details and does not pass unknown statuses', () => {
  const report = passed()
  report.success = false
  report.testResults[0].status = 'failed'
  report.testResults[0].assertionResults[0] = { ...assertion, status: 'failed', failureMessages: ['Expected 2, received 1'] }
  const output = combineTap(node, report)
  assert.match(output, /not ok .*UI behavior/)
  assert.match(output, /not ok .*group/)
  assert.match(output, /Expected 2, received 1/)
  assert.match(output, /# fail 1/)
  const unknown = passed()
  unknown.testResults[0].assertionResults[0].status = 'interrupted'
  assert.equal(vitestSummary(unknown).fail, 1)
})
