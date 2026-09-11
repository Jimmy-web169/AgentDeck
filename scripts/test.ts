interface VitestReport {
  success?: boolean
  numTotalTests?: number
  numTotalTestSuites?: number
  testResults?: {
    name: string
    status: string
    message?: string
    assertionResults?: { title: string; ancestorTitles?: string[]; status: string; failureMessages?: string[] }[]
  }[]
}
interface TapNode {
  title: string
  children?: TapNode[]
  failed?: boolean
  status?: string
  messages?: string[]
}
interface TapSuite extends TapNode {
  children: TapNode[]
}
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function nodeSummary(output: string) {
  const values = Object.fromEntries(
    [...output.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map((match) => [match[1], Number(match[2])])
  )
  const plan = [...output.matchAll(/^1\.\.(\d+)$/gm)].at(-1)
  if (!plan || !['tests', 'pass', 'fail'].every((key) => Number.isInteger(values[key]))) throw Error('Node test run did not produce a complete TAP summary')
  return {
    topLevel: Number(plan[1]),
    tests: values.tests,
    suites: values.suites || 0,
    pass: values.pass,
    fail: values.fail,
    cancelled: values.cancelled || 0,
    skipped: values.skipped || 0,
    todo: values.todo || 0,
  }
}

export function vitestSummary(report: VitestReport) {
  if (!Array.isArray(report?.testResults) || !report.testResults.length) throw Error('Vitest did not collect any test files')
  const files = report.testResults
    .map((file) => ({
      name: file.name,
      cases: (file.assertionResults || []).map((result) => ({
        title: result.title,
        groups: result.ancestorTitles || [],
        status: result.status,
        messages: result.failureMessages || [],
      })),
      failed: file.status === 'failed',
      message: file.message,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const assertions = files.flatMap((file) => file.cases)
  if (assertions.length !== report.numTotalTests) throw Error('Vitest assertion inventory does not match its reported total')
  let tests = 0,
    pass = 0,
    fail = 0,
    skipped = 0,
    todo = 0
  for (const file of files) {
    if (file.failed && !file.cases.some((test: { status: string }) => test.status === 'failed'))
      file.cases.push({
        title: 'test file collection or hook failure',
        groups: [],
        status: 'failed',
        messages: [file.message || 'Vitest reported a file failure without an assertion failure'],
      })
    for (const test of file.cases) {
      tests++
      if (test.status === 'passed') pass++
      else if (test.status === 'pending' || test.status === 'skipped' || test.status === 'disabled') skipped++
      else if (test.status === 'todo') todo++
      else {
        test.status = 'failed'
        fail++
      }
    }
  }
  if (!tests || (!report.success && !fail)) throw Error('Vitest was unsuccessful without a complete failure report')
  return { files, tests, pass, fail, skipped, todo, cancelled: 0, suites: report.numTotalTestSuites || files.length }
}

export function combineTap(nodeOutput: string, report: VitestReport) {
  const node = nodeSummary(nodeOutput)
  const ui = vitestSummary(report)
  const lines = nodeOutput
    .split('\n')
    .filter((line: string) => !/^1\.\.\d+$/.test(line) && !/^# (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line))
  let topLevel = node.topLevel
  const emit = (item: TapNode, number: number, indent = '') => {
    const title = item.title.replace(/[\r\n]/g, ' ')
    lines.push(`${indent}# Subtest: ${title}`)
    if (item.children) {
      item.children.forEach((child, index) => {
        emit(child, index + 1, `${indent}    `)
      })
      lines.push(`${indent}    1..${item.children.length}`)
    }
    const suffix = ['pending', 'skipped', 'disabled'].includes(item.status || '') ? ' # SKIP' : item.status === 'todo' ? ' # TODO' : ''
    lines.push(`${indent}${item.failed || item.status === 'failed' ? 'not ok' : 'ok'} ${number} - ${title}${suffix}`)
    if (!item.children && item.status === 'failed')
      lines.push(`${indent}  ---`, `${indent}  message: ${JSON.stringify((item.messages || []).join('\n'))}`, `${indent}  ...`)
  }
  for (const file of ui.files) {
    const repository = fileURLToPath(new URL('../', import.meta.url))
    const title = path.relative(repository, path.resolve(repository, file.name)).split(path.sep).join('/')
    const root: TapSuite = { title, children: [], failed: file.failed }
    for (const test of file.cases) {
      let parent: TapSuite = root
      for (const title of test.groups) {
        let group = parent.children.find((child): child is TapSuite => !!child.children && child.title === title)
        if (!group) {
          group = { title, children: [], failed: false }
          parent.children.push(group)
        }
        if (test.status === 'failed') group.failed = true
        parent = group
      }
      if (test.status === 'failed') root.failed = true
      parent.children.push(test)
    }
    emit(root, ++topLevel)
  }
  lines.push(`1..${topLevel}`)
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'] as const) lines.push(`# ${key} ${node[key] + ui[key]}`)
  return lines.join('\n') + '\n'
}

function walk(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name)
      return entry.isDirectory() ? walk(file) : [file]
    })
}

// One inventory owns every test exactly once. Node runs plain TypeScript with
// native stripping; UI and JSX integration tests use Vite's browser transform.
export function discoverTests(root: string) {
  const result: { node: string[]; vitest: string[] } = { node: [], vitest: [] }
  for (const file of walk(path.join(root, 'test'))) {
    if (!/\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)) continue
    const relative = path.relative(root, file).split(path.sep).join('/')
    const runner = relative.startsWith('test/ui/') || /\.[jt]sx$/.test(file) ? 'vitest' : 'node'
    result[runner].push(file)
  }
  return result
}

export function run({ root = process.cwd(), vitest = 'node_modules/vitest/vitest.mjs', config = 'vitest.config.ts' } = {}) {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true })
  // Stable latest-run artifacts; archived verification packets keep accepted history.
  const out = path.join(root, 'tmp')
  const files = discoverTests(root).node
  if (!files.length) throw Error('No Node tests found; refusing implicit Node discovery')
  const execute = (args: readonly string[], label: string) => {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    fs.writeFileSync(path.join(out, `test-${label}.log`), (result.stdout || '') + (result.stderr || '') + (result.error ? `\n${result.error.message}` : ''))
    return result
  }
  const node = execute(['--test', ...files], 'node')
  const json = path.join(out, 'test-vitest.json')
  // A failed collection must never reuse the previous run's JSON inventory.
  fs.writeFileSync(json, '')
  const ui = execute([vitest, 'run', '--config', config, '--reporter=json', `--outputFile=${json}`], 'vitest')
  try {
    const output = combineTap(node.stdout || '', JSON.parse(fs.readFileSync(json, 'utf8')))
    process.stdout.write(output)
    console.log(`# test artifacts: ${path.relative(root, out)}/test-node.log, test-vitest.log, test-vitest.json`)
    return node.status === 0 && ui.status === 0 && /^# fail 0$/m.test(output) && /^# cancelled 0$/m.test(output) ? 0 : 1
  } catch (error) {
    console.error(`Test runner failed: ${error instanceof Error ? error.message : String(error)}; full logs: ${path.relative(root, out)}`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run()
