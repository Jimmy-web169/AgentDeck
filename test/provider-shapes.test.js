import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateFixture } from '../scripts/demo/make-fixture.mjs'
import { COMMON_TOKEN_FIELDS } from '../server/shared/tokens.js'
import { CHILD_FIELDS } from '../server/shared/children.js'

// The shapes every provider must agree on (spec/PROVIDER-SPEC.md §1):
//  - GET /api/stats carries `fields.tokens` { common, specific } and a
//    provider-computed `total` on every tokens object
//  - GET /api/subagents carries `children[]` in the shared child shape
// Driven through the real dispatch tables on a generated fixture, so a
// provider that drifts from the shape fails here, not in the UI.

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-shapes-'))
const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime()
async function withConfigDir(dir, fn) {
  const prev = process.env.AGENTDECK_CONFIG_DIR
  process.env.AGENTDECK_CONFIG_DIR = dir
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.AGENTDECK_CONFIG_DIR
    else process.env.AGENTDECK_CONFIG_DIR = prev
  }
}
const q = (s) => new URLSearchParams(s)
const ok = (r, what) => {
  assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body).slice(0, 200)}`)
  return r.body
}
const SPECIFIC = { claude: ['cacheCreate'], codex: ['reasoning'] }
const STATUSES = new Set(['done', 'running', 'stalled', 'unknown'])

test('stats: every provider declares common vs specific token fields and computes total', async () => {
  const { PROVIDERS } = await import('../server/registry.js')
  const out = path.join(tmp(), 'root')
  const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'win32' })
  await withConfigDir(out, async () => {
    for (const id of ['claude', 'codex']) {
      const root = manifest.rootIds[id]
      const stats = ok(await PROVIDERS[id].dispatch('GET', '/api/stats', q(`root=${root}`)), `${id} stats`)
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
        const { sessions } = ok(await PROVIDERS[id].dispatch('GET', '/api/sessions', q(`root=${root}&slug=${encodeURIComponent(p.slug)}`)), `${id} sessions`)
        for (const s of sessions) assert.ok(typeof s.tokens.total === 'number' && s.tokens.total > 0, `${id} ${s.id}: session total`)
      }
    }
  })
  fs.rmSync(out, { recursive: true, force: true })
})

test('subagents: every provider returns children[] in the shared child shape', async () => {
  const { PROVIDERS } = await import('../server/registry.js')
  const out = path.join(tmp(), 'root')
  const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'win32' })
  await withConfigDir(out, async () => {
    for (const id of ['claude', 'codex']) {
      const root = manifest.rootIds[id]
      const parent = manifest.sessions.find((s) => s.provider === id && s.subagents.length)
      assert.ok(parent, `${id}: the fixture has a session with sub-agents`)
      const params = id === 'claude' ? `root=${root}&slug=${encodeURIComponent(parent.slug)}&id=${parent.id}` : `root=${root}&id=${parent.id}`
      const body = ok(await PROVIDERS[id].dispatch('GET', '/api/subagents', q(params)), `${id} subagents`)
      assert.ok(Array.isArray(body.children) && body.children.length === parent.subagents.length, `${id}: ${parent.subagents.length} children`)
      for (const c of body.children) {
        for (const k of CHILD_FIELDS) assert.ok(k in c, `${id}: child has ${k}`)
        assert.equal(c.parentId, parent.id, `${id}: parentId`)
        assert.equal(c.kind, id === 'claude' ? 'agent' : 'session', `${id}: kind`)
        assert.ok(typeof c.label === 'string' && c.label.length > 0, `${id}: label`)
        assert.ok(STATUSES.has(c.status), `${id}: status ${c.status}`)
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
  const { PROVIDERS } = await import('../server/registry.js')
  const out = path.join(tmp(), 'root')
  const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'posix' })
  await withConfigDir(out, async () => {
    for (const id of ['claude', 'codex', 'antigravity']) {
      const root = manifest.rootIds[id]
      const stats = ok(await PROVIDERS[id].dispatch('GET', '/api/stats', q(`root=${root}`)), `${id} stats`)
      assert.equal(typeof stats.subagentSessions, 'number', `${id}: subagentSessions at the root`)
      const sum = (k) => stats.projects.reduce((n, p) => n + p[k], 0)
      assert.equal(stats.sessions, sum('sessions'), `${id}: root sessions = Σ projects`)
      assert.equal(stats.subagentSessions, sum('subagentSessions'), `${id}: root subagentSessions = Σ projects`)
      assert.equal(stats.userTurns, sum('userTurns'), `${id}: root userTurns = Σ projects`)
      assert.equal(stats.tokens.total, sum('tokens') === 0 ? stats.tokens.total : stats.projects.reduce((n, p) => n + p.tokens.total, 0), `${id}: root total = Σ projects`)
      // the sidebar's session list and the stats count the same population
      for (const p of stats.projects) {
        const { sessions } = ok(await PROVIDERS[id].dispatch('GET', '/api/sessions', q(`root=${root}&slug=${encodeURIComponent(p.slug)}`)), `${id} sessions`)
        assert.equal(p.sessions, sessions.filter((s) => !s.isSubagent).length, `${id} ${p.slug}: stats.sessions = top-level sessions listed`)
      }
      if (id === 'codex') assert.ok(stats.subagentSessions > 0, 'codex: the fixture spawns children, so subagentSessions > 0')
    }
  })
  fs.rmSync(out, { recursive: true, force: true })
})

test('history / usage / roots / plugins / memory: the same keys from every provider', async () => {
  const { PROVIDERS } = await import('../server/registry.js')
  const out = path.join(tmp(), 'root')
  const manifest = generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'posix' })
  await withConfigDir(out, async () => {
    for (const id of ['claude', 'codex', 'antigravity']) {
      const root = manifest.rootIds[id]
      const { history } = ok(await PROVIDERS[id].dispatch('GET', '/api/history', q(`root=${root}`)), `${id} history`)
      assert.ok(history.length > 0, `${id}: the fixture writes history`)
      for (const h of history) {
        assert.deepEqual(Object.keys(h).sort(), ['display', 'project', 'sessionId', 'ts'], `${id}: history entry keys`)
        assert.ok(typeof h.ts === 'number' && h.ts > 1e12, `${id}: ts in ms`)
      }
      if (id !== 'antigravity') assert.ok(history.some((h) => typeof h.project === 'string' && h.project.length), `${id}: history names the project`)

      const usage = ok(await PROVIDERS[id].dispatch('GET', '/api/usage', q(`root=${root}`)), `${id} usage`)
      for (const k of ['root', 'rateLimits', 'contextWindow', 'sessionId', 'ts']) assert.ok(k in usage, `${id}: usage.${k}`)
      assert.equal(usage.root, root, `${id}: usage.root`)
      assert.ok(usage.ts === null || (typeof usage.ts === 'number' && usage.ts > 1e12), `${id}: usage.ts is ms or null`)

      const { roots } = ok(await PROVIDERS[id].dispatch('GET', '/api/roots', q('')), `${id} roots`)
      for (const r of roots) assert.equal(typeof r.hasSessions, 'boolean', `${id}: roots[].hasSessions`)

      const plugins = ok(await PROVIDERS[id].dispatch('GET', '/api/plugins', q(`root=${root}`)), `${id} plugins`)
      assert.ok(Array.isArray(plugins.marketplaces), `${id}: plugins.marketplaces[]`)
      for (const m of plugins.marketplaces) assert.ok(typeof m.name === 'string' && 'repo' in m, `${id}: marketplace {name, repo}`)

      const slug = manifest.projects.find((p) => p.providers.includes(id))?.slug
      const memParams = id === 'claude' ? `root=${root}&slug=${encodeURIComponent(slug)}` : `root=${root}`
      const mem = ok(await PROVIDERS[id].dispatch('GET', '/api/memory', q(memParams)), `${id} memory`)
      assert.ok(['project', 'thread', 'artifacts'].includes(mem.scope), `${id}: memory.scope`)
      assert.equal(typeof mem.writable, 'boolean', `${id}: memory.writable`)
      assert.equal(mem.writable, id === 'claude', `${id}: only claude's project notes are writable`)
    }
  })
  fs.rmSync(out, { recursive: true, force: true })
})

test('browse: one shared implementation behind every provider', async () => {
  const { PROVIDERS } = await import('../server/registry.js')
  const { getBrowse } = await import('../server/shared/browse.js')
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'visible'))
  fs.mkdirSync(path.join(dir, '.hidden'))
  for (const id of ['claude', 'codex', 'antigravity']) {
    const body = ok(await PROVIDERS[id].dispatch('GET', '/api/browse', q(`path=${encodeURIComponent(dir)}`)), `${id} browse`)
    assert.deepEqual(body.dirs.map((d) => d.name), ['visible'], `${id}: lists visible dirs only`)
    assert.deepEqual(body, getBrowse(q(`path=${encodeURIComponent(dir)}`)), `${id}: same answer as the shared function`)
    const miss = await PROVIDERS[id].dispatch('GET', '/api/browse', q(`path=${encodeURIComponent(path.join(dir, 'nope'))}`))
    assert.equal(miss.status, 404, `${id}: 404 for a missing dir`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
