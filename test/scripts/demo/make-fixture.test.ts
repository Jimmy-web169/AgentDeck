import { required } from '../../helpers/assert.ts'
import type { ProviderClient } from '../../../src/api/providerApi.ts'
import type { FixtureStats } from '../../helpers/fixture.ts'
type Reply<K extends keyof ProviderClient> = K extends 'stats' ? FixtureStats : ProviderClient[K] extends (...args: never[]) => infer R ? Awaited<R> : never
import { temporaryDirectory, withConfigDir } from '../../helpers/tmpConfigDir.ts'
// Original test group: demo-fixture. Assertions retained during module-path migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, configDir, isolatedConfig, idFor } from '../../../server/shared/roots.ts'
import { generateFixture, SCENARIOS } from '../../../scripts/demo/make-fixture.ts'

// The demo fixture (scripts/demo/make-fixture.ts) must be servable without
// ever touching the real ~/.claude / ~/.codex: AGENTDECK_CONFIG_DIR points every
// provider at another roots.<id>.json, and the generated data must be read by
// the SAME parsers the app uses — so these tests drive the providers' dispatch
// tables, not the generator's own bookkeeping.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const tmp = () => temporaryDirectory('agentdeck-demo-')
const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime() // a Monday noon, local time

// run fn with AGENTDECK_CONFIG_DIR set (or unset when dir is null), then restore it

const q = (s: string | URLSearchParams | string[][] | Record<string, string> | undefined) => new URLSearchParams(s)
const providers = async () => (await import('../../../server/registry.ts')).PROVIDERS
const ok = <T>(r: { status: number; body: unknown }, what: string): T => {
  assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body).slice(0, 200)}`)
  return r.body as T
}

test('config dir: defaults to the repo root, AGENTDECK_CONFIG_DIR overrides it', async () => {
  await withConfigDir(null, () => {
    assert.equal(configDir(), REPO)
    assert.equal(isolatedConfig(), false)
  })
  await withConfigDir('   ', () => {
    assert.equal(configDir(), REPO, 'blank is the same as unset')
    assert.equal(isolatedConfig(), false)
  })
  const dir = tmp()
  await withConfigDir(dir, () => {
    assert.equal(configDir(), path.resolve(dir))
    assert.equal(isolatedConfig(), true)
  })
  await withConfigDir(path.relative(process.cwd(), dir), () => {
    assert.equal(configDir(), path.resolve(dir), 'a relative dir resolves against cwd')
  })
})

test('config dir: an explicit dir is authoritative — no seed, no default homes, live per call', async () => {
  const P = await providers()
  const dir = tmp()
  // nothing there yet → nothing tracked, and NO roots file gets seeded from the real homes
  await withConfigDir(dir, () => {
    for (const id of ['claude', 'codex'] as const) assert.deepEqual(P[id].loadRoots(), [], `${id}: empty config dir tracks nothing`)
    assert.deepEqual(fs.readdirSync(dir), [], 'no roots.<id>.json written into the config dir')
  })
  // one fixture root per provider → exactly that root, even though ~/.claude / ~/.codex may exist here
  const homes = { claude: path.join(dir, 'c-home'), codex: path.join(dir, 'x-home') }
  fs.mkdirSync(path.join(homes.claude, 'projects'), { recursive: true })
  fs.mkdirSync(path.join(homes.codex, 'sessions'), { recursive: true })
  for (const id of ['claude', 'codex'] as const)
    fs.writeFileSync(path.join(dir, `roots.${id}.json`), JSON.stringify([{ id: idFor(homes[id]), label: `~/.${id}`, dir: homes[id] }]))
  await withConfigDir(dir, async () => {
    for (const id of ['claude', 'codex'] as const) {
      const roots = P[id].loadRoots()
      assert.deepEqual(
        roots.map((r) => r.dir),
        [homes[id]],
        `${id}: only the fixture root`
      )
      assert.ok(!roots.some((r) => r.dir === path.join(HOME, `.${id}`)), `${id}: the real home is not re-added`)
      const meta = ok<Reply<'roots'>>(await P[id].dispatch('GET', '/api/roots', q('')), `${id} roots`)
      assert.equal(meta.roots.length, 1)
      assert.equal(meta.roots[0].label, `~/.${id}`)
    }
  })
  // flipping the variable back is honoured on the next call (the path is not cached at import)
  await withConfigDir(dir + '-missing', () => {
    for (const id of ['claude', 'codex'] as const) assert.deepEqual(P[id].loadRoots(), [])
  })
})

test('generated fixture: v2-highlights parses through both providers (projects, sessions, sub-agents, tokens)', async () => {
  const P = await providers()
  const out = path.join(tmp(), 'root')
  const manifest = generateFixture({ out, scenario: 'v2-highlights', seed: 7, now: NOW, platform: 'win32' })
  assert.ok(manifest.sessions.length >= 15 && manifest.sessions.length <= 30, `${manifest.sessions.length} sessions`)
  assert.ok(
    manifest.sessions.some((s) => s.provider === 'antigravity'),
    'the story has Antigravity sessions too'
  )
  assert.ok(manifest.projects.length >= 4 && manifest.projects.length <= 6, `${manifest.projects.length} projects`)
  assert.ok(
    manifest.projects.some((p) => p.providers.length >= 2),
    'one project is present in several providers (workspace suggestion)'
  )
  assert.ok(manifest.sessions.filter((s) => s.start.startsWith('2026-09-07')).length >= 2, 'two sessions from "today"')
  for (const f of ['roots.claude.json', 'roots.codex.json', 'roots.antigravity.json', 'manifest.json']) assert.ok(fs.existsSync(path.join(out, f)), f)

  const homes = { claude: manifest.claudeHome, codex: manifest.codexHome, antigravity: manifest.agyHome }
  await withConfigDir(out, async () => {
    for (const id of ['claude', 'codex', 'antigravity'] as const) {
      const roots = ok<Reply<'roots'>>(await P[id].dispatch('GET', '/api/roots', q('')), `${id} roots`)
      assert.equal(roots.roots.length, 1)
      assert.equal(roots.roots[0].dir, homes[id])
      const root = roots.roots[0].id
      assert.equal(root, manifest.rootIds[id])

      const { projects } = ok<Reply<'projects'>>(await P[id].dispatch('GET', '/api/projects', q(`root=${root}`)), `${id} projects`)
      assert.ok(projects.length > 0, `${id}: projects listed`)
      const want = manifest.projects.filter((p) => p.providers.includes(id))
      assert.equal(projects.length, want.length, `${id}: one project per fixture cwd`)
      for (const p of projects) assert.ok(p.cwd?.startsWith('C:\\Users\\demo\\code\\'), `${id}: fictional cwd (${p.cwd})`)

      let sessions = 0
      let withSubagents = 0
      for (const p of projects) {
        const body = ok<Reply<'sessions'>>(await P[id].dispatch('GET', '/api/sessions', q(`root=${root}&slug=${encodeURIComponent(p.slug)}`)), `${id} sessions`)
        assert.equal(body.sessions.length, p.sessionCount, `${id} ${p.slug}: sessionCount matches`)
        for (const s of body.sessions) {
          sessions++
          const m = manifest.sessions.find((x) => x.id === s.id)
          assert.ok(m, `${id}: ${s.id} is in the manifest`)
          assert.equal(s.title, m.title, `${id}: manifest title matches the parser's`)
          assert.ok(s.userTurns > 0 && s.assistantTurns > 0, `${id} ${s.id}: turns`)
          assert.ok(s.toolCalls > 0, `${id} ${s.id}: tool calls`)
          assert.ok(s.firstTs && s.lastTs && s.lastTs > s.firstTs, `${id} ${s.id}: timestamps`)
          assert.ok(s.models.length > 0, `${id} ${s.id}: model`)
          const t = s.tokens
          if (id !== 'antigravity' || ('sqlite' in roots && roots.sqlite))
            assert.ok((t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0) > 0, `${id} ${s.id}: tokens`)
          if (id === 'codex') assert.ok(t.total > 0 && (s.contextWindow || 0) > 0, 'codex: token_count totals + context window')
          const kinds =
            id === 'claude' ? ['Read', 'Edit', 'Bash'] : id === 'codex' ? ['shell', 'apply_patch'] : ['run_command', 'replace_file_content', 'write_to_file']
          assert.ok(
            kinds.some((k) => s.toolCounts[k]),
            `${id} ${s.id}: uses ${kinds.join('/')}`
          )

          const full = ok<Reply<'session'>>(
            await P[id].dispatch('GET', '/api/session', q(`root=${root}&slug=${encodeURIComponent(p.slug)}&id=${s.id}`)),
            `${id} session`
          )
          assert.ok(full.timeline.length > 2, `${id} ${s.id}: timeline`)
          assert.ok(
            full.timeline.some((e) => e.kind === 'assistant' && e.parts?.some((x) => x.kind === 'tool_call' && x.result)),
            `${id} ${s.id}: tool_use paired with its result`
          )

          if (id === 'claude' && s.hasSubagents) {
            withSubagents++
            const sub = ok<Reply<'subagents'>>(
              await P.claude.dispatch('GET', '/api/subagents', q(`root=${root}&slug=${p.slug}&id=${s.id}`)),
              'claude subagents'
            )
            assert.ok(sub.agents && sub.agents.length > 0, 'sidecar agents listed')
            const taskIds = new Set(full.timeline.flatMap((e) => (e.parts || []).filter((x) => x.kind === 'tool_call' && x.name === 'Task').map((x) => x.id)))
            for (const a of sub.agents) {
              assert.ok(taskIds.has(a.toolUseId), 'meta.json toolUseId links the agent to a Task call in the parent')
              assert.ok((a.tokens?.output || 0) > 0 && (a.toolCalls || 0) > 0 && a.endTurn, 'agent transcript summarised')
              assert.equal(a.agentType, 'Explore')
            }
          }
          if (id === 'codex' && (s.childCount || 0) > 0) {
            withSubagents++
            const sub = ok<Reply<'subagents'>>(await P.codex.dispatch('GET', '/api/subagents', q(`root=${root}&id=${s.id}`)), 'codex subagents')
            assert.ok(sub.children)
            assert.equal(sub.children.length, s.childCount)
            for (const c of sub.children) {
              assert.equal(c.agentRole, 'explorer')
              assert.ok((c.userTurns || 0) > 0 && (c.tokens?.total || 0) > 0, 'child rollout summarised')
            }
          }
        }
      }
      assert.equal(sessions, manifest.sessions.filter((s) => s.provider === id).length, `${id}: every generated session is listed`)
      if (id !== 'antigravity') assert.ok(withSubagents > 0, `${id}: at least one session has sub-agents`) // the agy story has no spawned children yet

      const stats = ok<Reply<'stats'>>(await P[id].dispatch('GET', '/api/stats', q(`root=${root}`)), `${id} stats`)
      assert.ok(stats.sessions > 0 && stats.toolCalls > 0 && stats.tokens.output > 0, `${id}: stats totals`)
      const act = ok<Reply<'activity'>>(await P[id].dispatch('GET', '/api/activity', q(`root=${root}&days=84`)), `${id} activity`)
      assert.ok(act.totals.sessions > 0 && act.totals.activeDays > 1, `${id}: activity buckets`)
      const hist = ok<Reply<'history'>>(await P[id].dispatch('GET', '/api/history', q(`root=${root}`)), `${id} history`)
      assert.ok(hist.history.length > 0 && hist.history[0].display && hist.history[0].ts, `${id}: history.jsonl read`)
    }
    // Codex-only extras the UI shows: rate limits from token_count, [mcp_servers.x] in config.toml
    const croot = manifest.rootIds.codex
    const usage = ok<Reply<'usage'>>(await P.codex.dispatch('GET', '/api/usage', q(`root=${croot}`)), 'codex usage')
    assert.ok((usage.rateLimits?.primary?.used_percent || 0) > 0, 'rate_limits surfaced from the newest token_count')
    const res = ok<Reply<'resources'>>(await P.codex.dispatch('GET', '/api/resources', q(`root=${croot}`)), 'codex resources')
    assert.match(JSON.stringify(res), /docs-search/, 'config.toml mcp server visible')
    const mem = ok<Reply<'memory'>>(
      await P.claude.dispatch(
        'GET',
        '/api/memory',
        q(`root=${manifest.rootIds.claude}&slug=${required(manifest.projects.find((p) => p.name === 'orbit-api')).claudeSlug}`)
      ),
      'claude memory'
    )
    assert.ok(JSON.stringify(mem).includes('api-conventions'), 'project memory dir read')
  })
})

test('generated fixture: single-project and empty scenarios; deterministic for a seed', async () => {
  const P = await providers()
  assert.deepEqual(SCENARIOS, ['v2-highlights', 'empty', 'single-project', 'stress', 'error', 'folders'])
  const base = tmp()

  const single = generateFixture({ out: path.join(base, 'single'), scenario: 'single-project', seed: 3, now: NOW, platform: 'posix' })
  assert.equal(single.projects.length, 1)
  assert.deepEqual(single.projects[0].providers, ['antigravity', 'claude', 'codex'])
  assert.equal(single.projects[0].cwd, '/home/demo/code/orbit-api', 'posix paths on request')
  await withConfigDir(path.join(base, 'single'), async () => {
    for (const id of ['claude', 'codex'] as const) {
      const { projects } = ok<Reply<'projects'>>(await P[id].dispatch('GET', '/api/projects', q('')), `${id} projects`)
      assert.equal(projects.length, 1, `${id}: one project`)
      assert.equal(projects[0].cwd, '/home/demo/code/orbit-api')
      assert.ok(projects[0].sessionCount > 0)
    }
  })

  const empty = generateFixture({ out: path.join(base, 'empty'), scenario: 'empty', seed: 3, now: NOW })
  assert.equal(empty.sessions.length, 0)
  await withConfigDir(path.join(base, 'empty'), async () => {
    for (const id of ['claude', 'codex'] as const) {
      const roots = ok<Reply<'roots'>>(await P[id].dispatch('GET', '/api/roots', q('')), `${id} roots`)
      assert.equal(roots.roots.length, 1, `${id}: the (empty) home is still tracked — a fresh install`)
      const { projects } = ok<Reply<'projects'>>(await P[id].dispatch('GET', '/api/projects', q('')), `${id} projects`)
      assert.deepEqual(projects, [], `${id}: no projects`)
    }
  })

  const a = generateFixture({ out: path.join(base, 'a'), scenario: 'v2-highlights', seed: 11, now: NOW })
  const b = generateFixture({ out: path.join(base, 'b'), scenario: 'v2-highlights', seed: 11, now: NOW })
  assert.deepEqual(
    a.sessions.map((s) => [s.id, s.title, s.subagents]),
    b.sessions.map((s) => [s.id, s.title, s.subagents]),
    'same seed + now → same ids'
  )
  const c = generateFixture({ out: path.join(base, 'c'), scenario: 'v2-highlights', seed: 12, now: NOW })
  assert.notDeepEqual(
    a.sessions.map((s) => s.id),
    c.sessions.map((s) => s.id),
    'another seed → other ids'
  )

  assert.throws(() => generateFixture({ out: path.join(base, 'a'), scenario: 'nope' }), /unknown scenario/)
  const notOurs = path.join(base, 'not-ours')
  fs.mkdirSync(notOurs)
  fs.writeFileSync(path.join(notOurs, 'keep.txt'), 'x')
  assert.throws(() => generateFixture({ out: notOurs, scenario: 'empty' }), /not a generated fixture/, 'refuses to wipe a dir it did not create')
  assert.ok(fs.existsSync(path.join(notOurs, 'keep.txt')))
})

test('generated fixture: stress data reaches the real parser with long content and billion-token usage', async () => {
  const out = path.join(tmp(), 'stress')
  const manifest = generateFixture({ out, scenario: 'stress', seed: 42, now: NOW, platform: 'posix' })
  assert.ok(manifest.workspaces)
  assert.equal(manifest.workspaces.length, 20)
  assert.ok(manifest.projects.every((p) => p.cwd.includes('/one/two/three/four/five/six/')))
  assert.ok(manifest.sessions.some((s) => s.title.length > 100))
  const session = manifest.sessions.find((s) => s.provider === 'claude')
  assert.ok(session)
  const P = await providers()
  await withConfigDir(out, async () => {
    const data = ok<Reply<'session'>>(
      await P.claude.dispatch('GET', '/api/session', new URLSearchParams({ root: manifest.rootIds.claude, slug: session.slug, id: session.id })),
      'stress session'
    )
    assert.ok(data.summary.tokens.input >= 1_060_000_000)
    assert.ok(JSON.stringify(data.timeline).includes('unbroken'.repeat(80)))
    assert.ok(JSON.stringify(data.timeline).includes('繁體中文'))
  })
})

test('generated fixture: folder scenario supplies real canonical directories inside the fixture', async () => {
  const out = path.join(tmp(), 'folders')
  const manifest = generateFixture({ out, scenario: 'folders', now: NOW })
  assert.ok(manifest.projects.every((p) => p.cwd.startsWith(`${out}${path.sep}`) && fs.statSync(p.cwd).isDirectory()))
  const shared = manifest.projects.find((p) => p.providers.length === 3)
  assert.ok(shared)
  const P = await providers()
  await withConfigDir(out, async () => {
    for (const id of shared.providers) {
      const data = ok<Reply<'projects'>>(
        await P[id].dispatch('GET', '/api/projects', new URLSearchParams({ root: manifest.rootIds[id] })),
        `${id} folder projects`
      )
      assert.ok(data.projects.some((p) => p.cwd === shared.cwd))
    }
  })
})

test('generated fixture: error scenario tracks an intentionally unavailable synthetic root', async () => {
  const out = path.join(tmp(), 'error')
  const manifest = generateFixture({ out, scenario: 'error', now: NOW })
  assert.equal(manifest.sessions.length, 0)
  assert.equal(fs.existsSync(manifest.claudeHome), false)
  const P = await providers()
  await withConfigDir(out, () => {
    const roots = P.claude.loadRoots()
    assert.equal(roots.length, 1)
    assert.equal(roots[0].id, manifest.rootIds.claude)
    assert.equal(roots[0].dir, manifest.claudeHome)
  })
})

test('generated fixture: transcripts never mention this machine (home dir, user name)', () => {
  const out = path.join(tmp(), 'root')
  generateFixture({ out, scenario: 'v2-highlights', seed: 5, now: NOW })
  // the home dir itself, plus the user name in the shape a leaked path would have
  // (the bare name can be an ordinary word — "user", "demo")
  const user = os.userInfo().username
  const needles = [HOME, `\\Users\\${user}\\`, `/home/${user}/`, `/Users/${user}/`].filter((s) => s?.length > 3)
  const walk = (dir: string, acc: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name)
      if (e.isDirectory()) walk(f, acc)
      else acc.push(f)
    }
    return acc
  }
  // the roots files carry the fixture's absolute path by necessity; everything
  // under the two homes (transcripts, history, config) must be fiction only
  const files = [...walk(path.join(out, 'claude'), []), ...walk(path.join(out, 'codex'), [])]
  assert.ok(files.length > 20)
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    for (const n of needles) assert.ok(!text.toLowerCase().includes(n.toLowerCase()), `${path.relative(out, f)} mentions ${n}`)
  }
})
