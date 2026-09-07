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
