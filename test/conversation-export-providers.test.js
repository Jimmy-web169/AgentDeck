import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateFixture } from '../scripts/demo/make-fixture.mjs'
import { PROVIDERS } from '../server/registry.js'
import { createHandoffService } from '../server/deck/handoff.js'
import { openHandoffStore } from '../server/deck/handoffStore.js'

test('real provider adapters export fictional native main/subagent histories to portable JSONL', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-export-providers-'))
  const previous = process.env.AGENTDECK_CONFIG_DIR
  process.env.AGENTDECK_CONFIG_DIR = dir
  t.after(() => { if (previous === undefined) delete process.env.AGENTDECK_CONFIG_DIR; else process.env.AGENTDECK_CONFIG_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }) })
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
    const source = provider === 'antigravity' ? { id: agy[0].id, subagents: [agy[1]] } : manifest.sessions.find((s) => s.provider === provider && s.subagents.length) || manifest.sessions.find((s) => s.provider === provider)
    assert.ok(source, provider)
    const result = await service.exportHistory({ source: { provider, root: manifest.rootIds[provider], id: source.id, slug: source.slug } })
    const records = fs.readFileSync(result.file, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(records[0].handoff.sourceProvider, provider)
    assert.equal(result.history.complete, true, `${provider}: ${JSON.stringify(result.history.warnings)}`)
    assert.equal(result.history.conversations, 1 + source.subagents.length)
    assert.ok(records.filter((r) => r.type === 'message').every((m) => ['user', 'assistant'].includes(m.role)))
    assert.equal(records.some((r) => r.kind === 'tool_call'), false)
    assert.equal(JSON.stringify(records[0]).includes(dir), false)
    assert.equal(records[0].handoff.projectName.includes('/'), false)
    // Native Claude summaries historically omitted cwd, even though project
    // cards displayed it. Check the actual export receipt, not only mock data.
    const located = manifest.sessions.find((s) => s.provider === provider)
    const locatedResult = await service.exportHistory({ source: { provider, root: manifest.rootIds[provider], id: located.id, slug: located.slug, cwd: '/untrusted/client/path' } })
    assert.equal(openHandoffStore(dir).get(locatedResult.id).cwd, located.cwd, provider)
    const locatedHeader = JSON.parse(fs.readFileSync(locatedResult.file, 'utf8').split('\n')[0]).handoff
    assert.equal(locatedHeader.projectName, path.basename(located.cwd), provider)
    assert.ok(locatedResult.filename.includes(`__${path.basename(located.cwd)}__`), provider)
  }
})
