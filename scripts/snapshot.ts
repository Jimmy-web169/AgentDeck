#!/usr/bin/env node
import type { Fixture } from './demo/lib.ts'
// Behavior fingerprints use synthetic fixtures only and own side ports.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { PROVIDER_METHODS } from '../server/shared/providerRoutes.ts'
import { assertFixtureServer, loadFixture, sleep } from './demo/lib.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, 'tmp')
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const BASE = 'http://127.0.0.1:47851'
const fixedNow = '2026-09-07T12:00:00.000Z'
export function runtimeDirectory(directory = process.env.AGENTDECK_VERIFY_RUNTIME) {
  if (!directory) return ROOT
  const resolved = fs.realpathSync(directory)
  assert.ok(resolved.startsWith(`${fs.realpathSync(TMP)}${path.sep}`), 'reference runtime must be an isolated copy under repo tmp/')
  assert.ok(
    ['server/index.ts', 'server/index.js'].some((file) => fs.existsSync(path.join(resolved, file))),
    'reference runtime is missing its bootstrap'
  )
  return resolved
}
function runtimeFingerprint(directory: string) {
  const digest = createHash('sha256')
  for (const owner of ['src', 'server', 'shared', 'dist']) {
    for (const name of walk(path.join(directory, owner))) {
      digest.update(`${owner}/${name}\0`)
      digest.update(fs.readFileSync(path.join(directory, owner, name)))
    }
  }
  return digest.digest('hex')
}
const safeDir = (label: string) => {
  assert.match(label || '', LABEL, 'snapshot labels may contain letters, digits, hyphens and underscores only')
  return path.join(TMP, `snapshot-${label}`)
}

export function normalize(value: unknown, { fixture, repo = ROOT }: { fixture?: string; repo?: string } = {}, key = ''): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item, { fixture, repo }, key))
    // Transcript, parts, history and chart sequences retain their order: sorting
    // those arrays could conceal a real regression. Inventories are unordered.
    if (['roots', 'projects', 'terminals', 'destinations', 'dirs'].includes(key)) items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return items
  }
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => k !== '_etag')
        .sort()
        .map((k) => [k, normalize((value as Record<string, unknown>)[k], { fixture, repo }, k)])
    )
  if (typeof value === 'number' && /^(?:at|mtime|mtimeMs|updatedAt|createdAt|lastSeen|generatedAt|checkedAt|expiresAt)$/.test(key)) return '<TS>'
  if (typeof value !== 'string') return value
  if (/^(?:cursor|nextCursor|snapshotId)$/.test(key) && value) return '<CURSOR>'
  let result = value
  for (const prefix of [fixture, repo].filter((prefix): prefix is string => !!prefix))
    result = result.split(prefix).join('<ROOT>').split(prefix.replaceAll('\\', '/')).join('<ROOT>')
  return result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, '<TS>')
}

function walk(dir: string, prefix = ''): string[] {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
          const name = `${prefix}${entry.name}`
          return entry.isDirectory() ? walk(path.join(dir, entry.name), `${name}/`) : [name]
        })
        .sort()
    : []
}

export function assertMatchingFixtures(left: Record<string, unknown>, right: Record<string, unknown>) {
  // Older captures lack provenance; their byte-level API diff still applies.
  for (const field of ['fixtureSource', 'fixtureManifestHash']) {
    if (left[field] && right[field])
      assert.equal(left[field], right[field], `snapshots use different synthetic fixtures (${field}); capture with the original fixture`)
  }
}

export function diffSnapshots(a: string, b: string) {
  const left = safeDir(a),
    right = safeDir(b)
  for (const dir of [left, right]) assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), `incomplete snapshot: ${dir}`)
  assertMatchingFixtures(
    JSON.parse(fs.readFileSync(path.join(left, 'manifest.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(right, 'manifest.json'), 'utf8'))
  )
  const names = new Set([...walk(left), ...walk(right)])
  const changed = []
  for (const name of [...names].sort()) {
    if (!/^(?:api\/|layout\/|text\/|tests\.txt$|coverage\.json$)/.test(name)) continue
    const read = (dir: string) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : null)
    if (read(left) !== read(right)) changed.push(name)
  }
  for (const category of ['layout', 'text']) {
    if (![...names].some((name) => name.startsWith(`${category}/`))) console.log(`${category}: not captured (WP-13 hook pending)`)
  }
  console.log(changed.length ? `DIFFERENT: ${changed.length} files\n${changed.join('\n')}` : 'EMPTY')
  return changed
}

export async function withFixtureServer<T>(fixture: string, work: (fixture: Fixture, base: string) => T | Promise<T>, { port = 47851 } = {}) {
  assert.ok([47851, 47871].includes(port), 'verification servers must use approved side ports')
  const base = `http://127.0.0.1:${port}`
  const fx = loadFixture(fixture)
  const realFixture = fs.realpathSync(fixture)
  assert.ok(realFixture.startsWith(`${fs.realpathSync(TMP)}${path.sep}`), 'fixture must live under repo tmp/')
  for (const root of Object.values(fx.roots)) {
    const intentionalMissing = fx.manifest.scenario === 'error' && root?.dir === path.join(realFixture, 'unavailable-claude') && !fs.existsSync(root.dir)
    assert.ok(
      intentionalMissing || (root?.dir && fs.realpathSync(root.dir).startsWith(`${realFixture}${path.sep}`)),
      'all provider roots must stay inside the synthetic fixture'
    )
  }
  const preload = path.join(TMP, 'snapshot-runtime.mjs')
  // Isolate external command discovery and home fallbacks without changing the
  // maintainer's environment. The server's wall clock is deterministic; timers
  // still run normally, so watcher and HTTP behavior remain observable.
  fs.writeFileSync(
    preload,
    `import os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\nos.homedir = () => ${JSON.stringify(realFixture)};\nsyncBuiltinESMExports();\nconst OriginalDate = Date;\nglobalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [${JSON.stringify(fixedNow)}])); } static now() { return OriginalDate.parse(${JSON.stringify(fixedNow)}); } };\n`
  )
  const serverLog = fs.openSync(path.join(TMP, 'snapshot-server.log'), 'w')
  const bootstrap = fs.existsSync(path.join(runtimeDirectory(), 'server/index.ts')) ? 'server/index.ts' : 'server/index.js'
  const child = spawn(process.execPath, ['--import', preload, bootstrap], {
    cwd: runtimeDirectory(),
    env: {
      ...process.env,
      AGENTDECK_CONFIG_DIR: realFixture,
      AGENTDECK_PORT: String(port),
      AGENTDECK_WEB_PORT: String(port + 1),
      PATH: realFixture,
      TMUX_TMPDIR: realFixture,
      LOCALAPPDATA: realFixture,
    },
    stdio: ['ignore', serverLog, serverLog],
  })
  fs.closeSync(serverLog)
  let childError: Error | undefined
  child.on('error', (error) => {
    childError = error
  })
  const stopped = once(child, 'exit')
  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      if (childError || child.exitCode !== null) throw childError || new Error(`fixture server exited ${child.exitCode}; see tmp/snapshot-server.log`)
      try {
        if (!fs.readFileSync(path.join(TMP, 'snapshot-server.log'), 'utf8').includes('AgentDeck API')) {
          await sleep(100)
          continue
        }
        const response = await fetch(`${base}/api/claude/roots`, { signal: AbortSignal.timeout(1000) })
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        /* own server is still binding */
      }
      await sleep(100)
    }
    assert.ok(ready, 'fixture server did not become ready')
    await assertFixtureServer(base, fx, (message) => {
      throw new Error(message)
    })
    // Verify every provider, not only the historical helper's Claude check.
    for (const [id, expected] of Object.entries(fx.roots)) {
      assert.ok(expected, `${id}: missing fixture root`)
      const body = await (await fetch(`${base}/api/${id}/roots`)).json()
      assert.deepEqual(
        body.roots.map((r: { dir: string }) => path.resolve(r.dir)),
        [path.resolve(expected.dir)],
        `${id} must serve only this fixture`
      )
    }
    // Prime startup probes twice so fresh fixtures and previously sampled ones
    // expose the same settled status, without racing the server's 3s timer.
    // These are fixture-only setup writes, after all roots were verified.
    for (let pass = 0; pass < 2; pass++) {
      await Promise.all(
        Object.entries(fx.roots).map(async ([id, root]) => {
          assert.ok(root, `${id}: missing fixture root`)
          const response = await fetch(`${base}/api/${id}/probe/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root: root.id }),
          })
          assert.equal(response.status, 200, `${id}: fixture probe setup must succeed`)
        })
      )
    }
    return await work(fx, base)
  } finally {
    if (child.exitCode === null && !childError) {
      child.kill('SIGTERM')
      await stopped
    }
  }
}

export function getRoutes(file: string) {
  if (!fs.existsSync(path.join(ROOT, file)) && file.endsWith('.js')) file = file.slice(0, -3) + '.ts'
  const local = [...fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/['"]GET \/api\/([^'"]+)['"]/g)].map((match) => match[1])
  // Provider api modules now declare only extras. Include the authoritative
  // factory inventory so extracting a route can never remove snapshot coverage.
  const common = /^server\/providers\//.test(file)
    ? Object.keys(PROVIDER_METHODS)
        .filter((route) => route.startsWith('GET '))
        .map((route) => route.slice(9))
    : []
  return [...new Set([...common, ...local])]
}

export function tapSummary(output: string) {
  return output
    .split(/\r?\n/)
    .filter((line: string) => /^\s*(?:# Subtest:|(?:not )?ok \d+|# (?:tests|suites|pass|fail|cancelled|skipped|todo) )/.test(line))
    .map((line: string) => line.replace(/^(\s*(?:not )?ok) \d+/, '$1'))
    .join('\n')
}

export async function capture(label: string) {
  const runtime = runtimeDirectory()
  const runtimeHash = runtimeFingerprint(runtime)
  const fixture = process.env.AGENTDECK_CONFIG_DIR
  assert.ok(fixture, 'set AGENTDECK_CONFIG_DIR to a generated fixture under tmp/; real homes are refused')
  const fixtureSource = path.relative(ROOT, path.resolve(fixture))
  const fixtureManifestHash = createHash('sha256')
    .update(fs.readFileSync(path.join(fixture, 'manifest.json')))
    .digest('hex')
  const out = safeDir(label)
  assert.ok(!fs.existsSync(out), `snapshot ${label} already exists; choose a new label to preserve evidence`)
  fs.mkdirSync(path.join(out, 'api'), { recursive: true })
  const coverage: { owner: string; route: string; case: string; status: number }[] = []
  await withFixtureServer(path.resolve(fixture), async (fx) => {
    const save = async (owner: string, route: string, params: string | URLSearchParams | Record<string, string> | string[][] | undefined, suffix = '') => {
      const query = new URLSearchParams(params)
      const response = await fetch(`${BASE}/api/${owner}/${route}?${query}`, { signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      const name = `${owner}-${route.replaceAll('/', '-')}${suffix}.json`
      const data = normalize({ status: response.status, body }, { fixture: path.resolve(fixture) })
      fs.writeFileSync(path.join(out, 'api', name), `${JSON.stringify(data, null, 2)}\n`)
      coverage.push({ owner, route, case: suffix || 'default', status: response.status })
    }
    for (const [owner, root] of Object.entries(fx.roots)) {
      assert.ok(root, `${owner}: missing fixture root`)
      const session =
        fx.manifest.sessions.find((s) => s.provider === owner && s.subagents.length) ||
        fx.manifest.sessions.find((s: { provider: string }) => s.provider === owner)
      const params = { root: root.id, slug: session?.slug || '', id: session?.id || '', path: path.resolve(fixture), scope: 'user' }
      for (const route of getRoutes(`server/providers/${owner}/api.ts`)) await save(owner, route, params)
      // Every transcript supplies a non-empty parser response, including children
      // through their parent's subagent endpoint above.
      for (const s of fx.manifest.sessions.filter((row: { provider: string }) => row.provider === owner))
        await save(owner, 'session', { root: root.id, slug: s.slug, id: s.id }, `-${s.id}`)
    }
    for (const route of getRoutes('server/deck/api.ts')) {
      if (route === 'home') {
        for (const view of ['stats', 'insights', 'history', 'plugins', 'resources']) await save('deck', route, { view }, `-${view}`)
      } else await save('deck', route, { id: 'fixture-missing-id' })
    }
  })
  const testEnv = { ...process.env }
  delete testEnv.AGENTDECK_CONFIG_DIR // tests own their fixtures; never inherit the capture root
  // A reference capture must run that reference's tests, not a later worktree's
  // inventory. Runtime copies are already confined to the repository's tmp/.
  const tests = spawnSync('npm', ['test'], { cwd: runtime, env: testEnv, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' })
  fs.writeFileSync(path.join(out, 'test-output.log'), tests.stdout + tests.stderr)
  assert.equal(tests.status, 0, `tests failed; see ${path.relative(ROOT, out)}/test-output.log`)
  // Keep test names, outcomes and counts, but ignore timing and test numbering.
  const summary = tapSummary(tests.stdout)
  fs.writeFileSync(path.join(out, 'tests.txt'), `${summary}\n`)
  fs.writeFileSync(path.join(out, 'coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`)
  let layout = null
  if (fs.existsSync(path.join(ROOT, 'scripts/check-layout.ts'))) {
    const { captureLayout } = await import('./check-layout.ts')
    layout = await captureLayout({ out, sheet: true })
    assert.ok(
      layout.rows.every((row) => row.ready),
      'a layout scene did not load; snapshot is incomplete'
    )
  }
  fs.writeFileSync(
    path.join(out, 'manifest.json'),
    `${JSON.stringify({ version: 1, label, fixture: '<ROOT>', fixtureSource, fixtureManifestHash, runtime: path.relative(ROOT, runtime) || 'working-tree', runtimeHash, verificationTests: { source: path.relative(ROOT, runtime) || 'working-tree', command: 'npm test', independentOfRuntime: false }, clock: fixedNow, requests: coverage.length, layout: layout?.scenes ?? 'not captured', text: layout?.scenes ?? 'not captured' }, null, 2)}\n`
  )
  assert.equal(runtimeFingerprint(runtime), runtimeHash, 'runtime sources or build changed during capture')
  console.log(
    `snapshot ${label}: ${coverage.length} GET responses, passing ${runtime === ROOT ? 'working-tree' : 'runtime-copy'} verification tests, ${layout ? `${layout.scenes} layout/text scenes` : 'layout/text not captured (WP-13)'}`
  )
}

async function main() {
  try {
    const [mode, a, b] = process.argv.slice(2)
    if (mode === '--diff') process.exitCode = diffSnapshots(a, b).length ? 1 : 0
    else if (mode === '--label') await capture(a)
    else throw new Error('usage: snapshot.mjs --label <name> | --diff <before> <after>')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

// The layout hook imports these helpers; do not make CLI startup a top-level
// await, which would keep the module uninitialized while loading that hook.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
