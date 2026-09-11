import { required } from '../helpers/assert.ts'
import type { ProviderClient } from '../../src/api/providerApi.ts'
import type { FixtureStats } from '../helpers/fixture.ts'
type Reply<K extends keyof ProviderClient> = K extends 'stats'
  ? FixtureStats
  : K extends 'browse'
    ? ReturnType<typeof import('../../server/shared/browse.ts').getBrowse>
    : ProviderClient[K] extends (...args: never[]) => infer R
      ? Awaited<R>
      : never
import { temporaryDirectory, withConfigDir } from '../helpers/tmpConfigDir.ts'
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeFixture as generateFixture } from '../helpers/fixture.ts'
import { COMMON_TOKEN_FIELDS } from '../../server/shared/tokens.ts'
import { CHILD_FIELDS } from '../../server/shared/children.ts'
import { resolveClaudeSession } from '../../server/providers/claude/terminal.ts'
import { resolveCodexSession } from '../../server/providers/codex/terminal.ts'
import { resolveAntigravitySession, prepareAntigravityLaunch } from '../../server/providers/antigravity/terminal.ts'
import { PROVIDERS } from '../../server/registry.ts'
import { createHandoffService } from '../../server/deck/handoff.ts'
import { openHandoffStore } from '../../server/deck/handoffStore.ts'
import { summarize as claude } from '../../server/providers/claude/parser.ts'
import { summarize as codex } from '../../server/providers/codex/parser.ts'
import { summarize as antigravity } from '../../server/providers/antigravity/parser.ts'

// Original groups remain named below; test assertions are unchanged.

describe('provider-shapes', async () => {
  // The shapes every provider must agree on (spec/PROVIDER-SPEC.md §1):
  //  - GET /api/stats carries `fields.tokens` { common, specific } and a
  //    provider-computed `total` on every tokens object
  //  - GET /api/subagents carries `children[]` in the shared child shape
  // Driven through the real dispatch tables on a generated fixture, so a
  // provider that drifts from the shape fails here, not in the UI.

  const tmp = () => temporaryDirectory('agentdeck-shapes-')
  const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime()

  const q = (s: string | URLSearchParams | string[][] | Record<string, string> | undefined) => new URLSearchParams(s)
  const ok = <T>(r: { status: number; body: unknown }, what: string): T => {
    assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body).slice(0, 200)}`)
    return r.body as T
  }
  const SPECIFIC = { claude: ['cacheCreate'], codex: ['reasoning'] }
  const STATUSES = new Set(['done', 'running', 'stalled', 'unknown'])

  test('stats: every provider declares common vs specific token fields and computes total', async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const out = path.join(tmp(), 'root')
    const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'win32' })
    await withConfigDir(out, async () => {
      for (const id of ['claude', 'codex'] as const) {
        const root = manifest.rootIds[id]
        const stats = ok<Reply<'stats'>>(await PROVIDERS[id].dispatch('GET', '/api/stats', q(`root=${root}`)), `${id} stats`)
        assert.deepEqual(stats.fields, { common: COMMON_TOKEN_FIELDS, specific: SPECIFIC[id] }, `${id}: fields`)
        for (const k of COMMON_TOKEN_FIELDS) assert.equal(typeof stats.tokens[k], 'number', `${id}: tokens.${k} is a number`)
        for (const k of SPECIFIC[id]) assert.equal(typeof stats.tokens[k], 'number', `${id}: tokens.${k} (specific) is a number`)
        assert.ok(stats.tokens.total > 0, `${id}: total computed by the provider`)
        if (id === 'claude') {
          const t = stats.tokens
          assert.equal(t.total, t.input + t.output + t.cacheRead + t.cacheCreate, 'claude: total = input + output + cache read + cache create')
        }
        for (const p of stats.projects) assert.ok(p.tokens.total > 0, `${id} ${p.slug}: project total`)
        // and the same on every session summary
        for (const p of stats.projects) {
          const { sessions } = ok<Reply<'sessions'>>(
            await PROVIDERS[id].dispatch('GET', '/api/sessions', q(`root=${root}&slug=${encodeURIComponent(p.slug)}`)),
            `${id} sessions`
          )
          for (const s of sessions) assert.ok(typeof s.tokens.total === 'number' && s.tokens.total > 0, `${id} ${s.id}: session total`)
        }
      }
    })
    fs.rmSync(out, { recursive: true, force: true })
  })

  test('subagents: every provider returns children[] in the shared child shape', async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const out = path.join(tmp(), 'root')
    const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'win32' })
    await withConfigDir(out, async () => {
      for (const id of ['claude', 'codex'] as const) {
        const root = manifest.rootIds[id]
        const parent = manifest.sessions.find((s) => s.provider === id && s.subagents.length)
        assert.ok(parent, `${id}: the fixture has a session with sub-agents`)
        const params = id === 'claude' ? `root=${root}&slug=${encodeURIComponent(parent.slug)}&id=${parent.id}` : `root=${root}&id=${parent.id}`
        const body = ok<Reply<'subagents'>>(await PROVIDERS[id].dispatch('GET', '/api/subagents', q(params)), `${id} subagents`)
        assert.ok(Array.isArray(body.children) && body.children.length === parent.subagents.length, `${id}: ${parent.subagents.length} children`)
        for (const c of body.children) {
          for (const k of CHILD_FIELDS) assert.ok(k in c, `${id}: child has ${k}`)
          assert.equal(c.parentId, parent.id, `${id}: parentId`)
          assert.equal(c.kind, id === 'claude' ? 'agent' : 'session', `${id}: kind`)
          assert.ok(typeof c.label === 'string' && c.label.length > 0, `${id}: label`)
          assert.ok(STATUSES.has(c.status || ''), `${id}: status ${c.status}`)
          assert.ok(typeof c.toolCalls === 'number', `${id}: toolCalls`)
        }
        if (id === 'claude') {
          assert.ok(Array.isArray(body.groups), 'claude: groups[] (workflow runs) present')
          assert.ok(Array.isArray(body.agents) && Array.isArray(body.runs), 'claude: the provider lists stay for the Sub-agents view')
        }
      }
    })
    fs.rmSync(out, { recursive: true, force: true })
  })

  // spec §4 items 2, 4, 5, 6 (2026-09-08): one population for stats, and one
  // vocabulary for history / usage / roots / plugins / memory across providers.
  test('stats: sessions + subagentSessions per project add up to the root numbers', async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const out = path.join(tmp(), 'root')
    const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'posix' })
    await withConfigDir(out, async () => {
      for (const id of ['claude', 'codex', 'antigravity']) {
        const root = manifest.rootIds[id]
        const stats = ok<Reply<'stats'>>(await PROVIDERS[id].dispatch('GET', '/api/stats', q(`root=${root}`)), `${id} stats`)
        assert.equal(typeof stats.subagentSessions, 'number', `${id}: subagentSessions at the root`)
        const sum = (k: 'sessions' | 'subagentSessions' | 'userTurns') => stats.projects.reduce((n, p) => n + p[k], 0)
        assert.equal(stats.sessions, sum('sessions'), `${id}: root sessions = Σ projects`)
        assert.equal(stats.subagentSessions, sum('subagentSessions'), `${id}: root subagentSessions = Σ projects`)
        assert.equal(stats.userTurns, sum('userTurns'), `${id}: root userTurns = Σ projects`)
        assert.equal(
          stats.tokens.total,
          stats.projects.reduce((n, p) => n + p.tokens.total, 0),
          `${id}: root total = Σ projects`
        )
        // the sidebar's session list and the stats count the same population
        for (const p of stats.projects) {
          const { sessions } = ok<Reply<'sessions'>>(
            await PROVIDERS[id].dispatch('GET', '/api/sessions', q(`root=${root}&slug=${encodeURIComponent(p.slug)}`)),
            `${id} sessions`
          )
          assert.equal(p.sessions, sessions.filter((s) => !s.isSubagent).length, `${id} ${p.slug}: stats.sessions = top-level sessions listed`)
        }
        if (id === 'codex') assert.ok(stats.subagentSessions > 0, 'codex: the fixture spawns children, so subagentSessions > 0')
      }
    })
    fs.rmSync(out, { recursive: true, force: true })
  })

  test('history / usage / roots / plugins / memory: the same keys from every provider', async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const out = path.join(tmp(), 'root')
    const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'posix' })
    await withConfigDir(out, async () => {
      for (const id of ['claude', 'codex', 'antigravity']) {
        const root = manifest.rootIds[id]
        const { history } = ok<Reply<'history'>>(await PROVIDERS[id].dispatch('GET', '/api/history', q(`root=${root}`)), `${id} history`)
        assert.ok(history.length > 0, `${id}: the fixture writes history`)
        for (const h of history) {
          assert.deepEqual(Object.keys(h).sort(), ['display', 'project', 'sessionId', 'ts'], `${id}: history entry keys`)
          assert.ok(typeof h.ts === 'number' && h.ts > 1e12, `${id}: ts in ms`)
        }
        if (id !== 'antigravity')
          assert.ok(
            history.some((h) => typeof h.project === 'string' && h.project.length),
            `${id}: history names the project`
          )

        const usage = ok<Reply<'usage'>>(await PROVIDERS[id].dispatch('GET', '/api/usage', q(`root=${root}`)), `${id} usage`)
        for (const k of ['root', 'rateLimits', 'contextWindow', 'sessionId', 'ts']) assert.ok(k in usage, `${id}: usage.${k}`)
        assert.equal(usage.root, root, `${id}: usage.root`)
        assert.ok(usage.ts === null || (typeof usage.ts === 'number' && usage.ts > 1e12), `${id}: usage.ts is ms or null`)

        const { roots } = ok<Reply<'roots'>>(await PROVIDERS[id].dispatch('GET', '/api/roots', q('')), `${id} roots`)
        for (const r of roots) assert.equal(typeof r.hasSessions, 'boolean', `${id}: roots[].hasSessions`)

        const plugins = ok<Reply<'plugins'>>(await PROVIDERS[id].dispatch('GET', '/api/plugins', q(`root=${root}`)), `${id} plugins`)
        assert.ok(Array.isArray(plugins.marketplaces), `${id}: plugins.marketplaces[]`)
        for (const m of plugins.marketplaces) assert.ok(typeof m.name === 'string' && 'repo' in m, `${id}: marketplace {name, repo}`)

        const slug = manifest.sessions.find((s) => s.provider === id)?.slug || ''
        const memParams = id === 'claude' ? `root=${root}&slug=${encodeURIComponent(slug)}` : `root=${root}`
        const mem = ok<Reply<'memory'>>(await PROVIDERS[id].dispatch('GET', '/api/memory', q(memParams)), `${id} memory`)
        assert.ok(['project', 'thread', 'artifacts'].includes(mem.scope || ''), `${id}: memory.scope`)
        assert.equal(typeof mem.writable, 'boolean', `${id}: memory.writable`)
        assert.equal(mem.writable, id === 'claude', `${id}: only claude's project notes are writable`)
      }
    })
    fs.rmSync(out, { recursive: true, force: true })
  })

  test('browse: one shared implementation behind every provider', async () => {
    const { PROVIDERS } = await import('../../server/registry.ts')
    const { getBrowse } = await import('../../server/shared/browse.ts')
    const dir = tmp()
    fs.mkdirSync(path.join(dir, 'visible'))
    fs.mkdirSync(path.join(dir, '.hidden'))
    for (const id of ['claude', 'codex', 'antigravity']) {
      const body = ok<Reply<'browse'>>(await PROVIDERS[id].dispatch('GET', '/api/browse', q(`path=${encodeURIComponent(dir)}`)), `${id} browse`)
      assert.deepEqual(
        body.dirs.map((d) => d.name),
        ['visible'],
        `${id}: lists visible dirs only`
      )
      assert.deepEqual(body, getBrowse(q(`path=${encodeURIComponent(dir)}`)), `${id}: same answer as the shared function`)
      const miss = await PROVIDERS[id].dispatch('GET', '/api/browse', q(`path=${encodeURIComponent(path.join(dir, 'nope'))}`))
      assert.equal(miss.status, 404, `${id}: 404 for a missing dir`)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('provider-terminal-adapters', async () => {
  test('provider adapters use exact session evidence, reject other roots, and tolerate delayed metadata', async (t) => {
    const tmp = temporaryDirectory('agentdeck-adapters-')
    const dir = path.join(tmp, 'data')
    const prior = process.env.AGENTDECK_CONFIG_DIR
    generateFixture({ out: dir, scenario: 'v2-highlights', seed: 42 })
    process.env.AGENTDECK_CONFIG_DIR = dir
    t.after(() => {
      if (prior == null) delete process.env.AGENTDECK_CONFIG_DIR
      else process.env.AGENTDECK_CONFIG_DIR = prior
      fs.rmSync(tmp, { recursive: true, force: true })
    })
    const { PROVIDERS } = await import('../../server/registry.ts')
    const resolvers: Record<string, typeof resolveClaudeSession> = {
      claude: resolveClaudeSession,
      codex: resolveCodexSession,
      antigravity: resolveAntigravitySession,
    }
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      const root = provider.loadRoots()[0]
      assert.ok(root, id + ' fixture root')
      const paths: { sessionFiles(root: string, slug?: string): { file: string; id: string; isSubagent?: boolean }[] } = await import(
        `../../server/providers/${id}/paths.ts`
      )
      const q = new URLSearchParams({ root: root.id })
      const projects = ((await provider.dispatch('GET', '/api/projects', q)).body as Reply<'projects'>).projects
      const entries = projects.flatMap((p) => paths.sessionFiles(root.dir, p.slug)).filter((e) => !e.isSubagent)
      assert.ok(entries.length >= 2, id + ' has competing sessions')
      const meta = { root: root.id, cwd: projects[0].cwd }
      const resolve = resolvers[id]
      assert.equal(resolve({ meta, files: () => [] }), null)
      assert.equal(resolve({ meta, files: () => ['/other/account/sessions/' + path.basename(entries[0].file)] }), null)
      const exact = resolve({ meta, files: () => [entries[0].file] })
      assert.equal(exact?.id, entries[0].id, id + ' associates its owned transcript')
      assert.equal(resolve({ meta, files: () => entries.slice(0, 2).map((e) => e.file) }), null, id + ' rejects ambiguity')
      if (id === 'claude') {
        assert.equal(resolve({ meta: { ...meta, expectedSessionId: entries[0].id }, files: () => [] })?.id, entries[0].id)
        assert.equal(resolve({ meta: { ...meta, expectedSessionId: '00000000-0000-4000-8000-000000000000' }, files: () => [] }), null)
      }
    }
    assert.throws(() => prepareAntigravityLaunch({ configDir: dir }), { status: 409 })
  })
})

describe('home-provider-adapters', async () => {
  test('all three native Home adapters restrict projects before aggregating and expose raw activity only to the Home query', async (t) => {
    const dir = temporaryDirectory('agentdeck-home-native-')
    const prior = process.env.AGENTDECK_CONFIG_DIR
    process.env.AGENTDECK_CONFIG_DIR = dir
    t.after(() => {
      if (prior === undefined) delete process.env.AGENTDECK_CONFIG_DIR
      else process.env.AGENTDECK_CONFIG_DIR = prior
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const manifest = generateFixture({ out: dir, scenario: 'v2-highlights', seed: 7, now: '2026-09-09T08:00:00Z', platform: 'posix' })
    for (const provider of Object.values(PROVIDERS)) {
      const root = manifest.rootIds[provider.id]
      const native = await provider.dispatch('GET', '/api/stats', new URLSearchParams({ root }))
      assert.equal(native.status, 200)
      const nativeStats = native.body as FixtureStats
      assert.ok(provider.home)
      const project = nativeStats.projects[0]
      assert.ok(project, provider.id)
      const all = { root, allProjects: true as const }
      const allStats = await provider.home.stats(all)
      assert.deepEqual(
        required(allStats.projects).map((p) => p.slug),
        nativeStats.projects.map((p) => p.slug)
      )
      assert.ok(Array.isArray((await provider.home.history(all)).history))
      assert.ok(required((await provider.home.insights(all)).records).length)
      const scope = { root, projects: [project] }
      const stats = await provider.home.stats(scope)
      assert.deepEqual(
        required(stats.projects).map((p) => p.slug),
        [project.slug],
        provider.id
      )
      assert.equal(required(stats.tokens).total, project.tokens.total, provider.id)
      const empty = await provider.home.stats({ root, projects: [] })
      assert.equal(empty.sessions, 0)
      assert.deepEqual(empty.projects, [])
      const activity = await provider.home.insights(scope)
      assert.ok(activity.records?.length, provider.id)
      assert.ok(
        activity.records.every((r) => r.slug === project.slug),
        provider.id
      )
      const legacyActivity = await provider.dispatch('GET', '/api/activity', new URLSearchParams({ root }))
      assert.ok(typeof legacyActivity.body === 'object' && legacyActivity.body !== null && 'daily' in legacyActivity.body && legacyActivity.body.daily)
      assert.equal('records' in legacyActivity.body ? legacyActivity.body.records : undefined, undefined)
      const history = await provider.home.history(scope)
      assert.ok(history.coverage)
      assert.ok(history.history?.every((h) => h.project === project.cwd))
      const plugins = await provider.home.plugins(scope)
      assert.ok(Array.isArray(plugins.installed))
      const resources = await provider.home.resources(scope)
      assert.ok(Array.isArray(resources.items))
      assert.equal('configToml' in resources ? resources.configToml : undefined, undefined, 'inventory does not expose full configuration contents')
    }
  })
})

describe('conversation-export-providers', async () => {
  test('real provider adapters export fictional native main/subagent histories to portable JSONL', async (t) => {
    const dir = temporaryDirectory('agentdeck-export-providers-')
    const previous = process.env.AGENTDECK_CONFIG_DIR
    process.env.AGENTDECK_CONFIG_DIR = dir
    t.after(() => {
      if (previous === undefined) delete process.env.AGENTDECK_CONFIG_DIR
      else process.env.AGENTDECK_CONFIG_DIR = previous
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const manifest = generateFixture({ out: dir, scenario: 'v2-highlights', seed: 7, now: '2026-09-09T08:00:00Z', platform: 'posix' })
    // The demo generator has standalone Antigravity conversations. Add the
    // fictional parent/child pair whose native invoke_subagent result links them.
    const agy = JSON.parse(fs.readFileSync('spec/fixtures/antigravity/fixture.json', 'utf8')).sessions.slice(0, 2)
    for (const session of agy) {
      const logs = path.join(manifest.agyHome, 'brain', session.id, '.system_generated', 'logs')
      fs.mkdirSync(logs, { recursive: true })
      fs.copyFileSync(path.join('spec/fixtures/antigravity', session.file), path.join(logs, 'transcript_full.jsonl'))
    }
    const service = createHandoffService({ providers: PROVIDERS, getStore: () => openHandoffStore(dir) })
    for (const provider of ['claude', 'codex', 'antigravity']) {
      const source =
        provider === 'antigravity'
          ? { id: agy[0].id, slug: undefined, subagents: [agy[1]] }
          : manifest.sessions.find((s) => s.provider === provider && s.subagents.length) || manifest.sessions.find((s) => s.provider === provider)
      assert.ok(source, provider)
      const result = await service.exportHistory({ source: { provider, root: manifest.rootIds[provider], id: source.id, slug: source.slug } })
      const records = fs
        .readFileSync(result.file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      assert.equal(records[0].handoff.sourceProvider, provider)
      assert.equal(result.history.complete, true, `${provider}: ${JSON.stringify(result.history.warnings)}`)
      assert.equal(result.history.conversations, 1 + source.subagents.length)
      assert.ok(records.filter((r) => r.type === 'message').every((m) => ['user', 'assistant'].includes(m.role)))
      assert.equal(
        records.some((r) => r.kind === 'tool_call'),
        false
      )
      assert.equal(JSON.stringify(records[0]).includes(dir), false)
      assert.equal(records[0].handoff.projectName.includes('/'), false)
      // Native Claude summaries historically omitted cwd, even though project
      // cards displayed it. Check the actual export receipt, not only mock data.
      const located = manifest.sessions.find((s) => s.provider === provider)
      assert.ok(located)
      const locatedResult = await service.exportHistory({
        source: { provider, root: manifest.rootIds[provider], id: located.id, slug: located.slug, cwd: '/untrusted/client/path' },
      })
      assert.equal(openHandoffStore(dir).get(locatedResult.id).cwd, located.cwd, provider)
      const locatedHeader = JSON.parse(fs.readFileSync(locatedResult.file, 'utf8').split('\n')[0]).handoff
      assert.equal(locatedHeader.projectName, path.basename(located.cwd), provider)
      assert.ok(locatedResult.filename.includes(`__${path.basename(located.cwd)}__`), provider)
    }
  })
})

describe('latest-prompt/spec/provider-contract', async () => {
  const latest = '2026-09-01T12:01:00Z'

  const ccUser = (content: string, timestamp: string) => ({ type: 'user', timestamp, message: { content } })

  const cxUser = (text: string, timestamp: string) => ({
    type: 'response_item',
    timestamp,
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  })

  const agUser = (content: string, step_index: number, created_at: string) => ({ type: 'USER_INPUT', content, step_index, created_at })

  test('every provider has bounded latest previews and neutral fields for an empty session', () => {
    for (const [summarize, records] of [
      [claude, [ccUser('問'.repeat(200), latest)]],
      [codex, [cxUser('問'.repeat(200), latest)]],
      [antigravity, [agUser('問'.repeat(200), 0, latest)]],
    ] as const) {
      const empty = summarize([], 'empty')
      assert.equal(empty.lastUserPrompt, '')
      assert.equal(empty.lastUserPromptTs, null)
      const s = summarize([...records], 'a')
      assert.equal(s.lastUserPrompt, '問'.repeat(140) + '…')
      assert.equal(s.lastUserPromptTs, latest)
    }
  })
})

test('every provider has a complete DATA contract, valid descriptor, parser goldens and explicit registrations', async () => {
  const { dataGaps } = await import('../../scripts/new-provider.ts')
  const { PROVIDER_METADATA } = await import('../../src/providers/metadata.ts')
  const { Ajv2020 } = await import('ajv/dist/2020.js')
  const { default: yaml } = await import('js-yaml')
  const { pathToFileURL, fileURLToPath } = await import('node:url')
  const repo = fileURLToPath(new URL('../../', import.meta.url))
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync(path.join(repo, 'spec/provider.schema.json'), 'utf8')))
  const providers = fs.readdirSync(path.join(repo, 'server/providers'), { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const { name: id } of providers) {
    const gaps = []
    const base = path.join(repo, 'server/providers', id)
    const dataFile = ['data.ts', 'data.js'].map((name) => path.join(base, name)).find((file) => fs.existsSync(file))
    if (!dataFile) gaps.push('DATA module missing')
    else gaps.push(...dataGaps(id, (await import(pathToFileURL(dataFile).href)).DATA))
    if (!PROVIDERS[id]) gaps.push('server registry entry missing')
    if (!PROVIDER_METADATA[id]) gaps.push('frontend metadata registry entry missing')
    const descriptor = path.join(repo, 'spec/providers', `${id}.yaml`)
    if (!fs.existsSync(descriptor)) gaps.push('provider descriptor missing')
    else {
      const value = yaml.load(fs.readFileSync(descriptor, 'utf8'))
      if (!validate(value)) gaps.push(...(validate.errors || []).map((error) => `descriptor ${error.instancePath}: ${error.message}`))
      if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== id) gaps.push('descriptor id differs from provider directory')
    }
    const fixtures = path.join(repo, 'spec/fixtures', id),
      expected = path.join(fixtures, 'expected')
    if (!fs.existsSync(fixtures) || !fs.readdirSync(fixtures).some((file) => /\.(?:jsonl|json|sqlite|db)$/.test(file)))
      gaps.push('native fixture input missing')
    if (!fs.existsSync(expected) || !fs.readdirSync(expected).some((file) => file.endsWith('.json'))) gaps.push('parser golden missing')
    assert.deepEqual(gaps, [], `${id}:\n${gaps.join('\n')}`)
  }
})
