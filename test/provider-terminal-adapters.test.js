import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateFixture } from '../scripts/demo/make-fixture.mjs'
import { resolveClaudeSession } from '../server/providers/claude/terminal.js'
import { resolveCodexSession } from '../server/providers/codex/terminal.js'
import { resolveAntigravitySession, prepareAntigravityLaunch } from '../server/providers/antigravity/terminal.js'

test('provider adapters use exact session evidence, reject other roots, and tolerate delayed metadata', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-adapters-'))
  const dir = path.join(tmp, 'data')
  const prior = process.env.AGENTDECK_CONFIG_DIR
  generateFixture({ out: dir, scenario: 'v2-highlights', seed: 42 })
  process.env.AGENTDECK_CONFIG_DIR = dir
  t.after(() => {
    if (prior == null) delete process.env.AGENTDECK_CONFIG_DIR
    else process.env.AGENTDECK_CONFIG_DIR = prior
    fs.rmSync(tmp, { recursive: true, force: true })
  })
  const { PROVIDERS } = await import('../server/registry.js')
  const resolvers = { claude: resolveClaudeSession, codex: resolveCodexSession, antigravity: resolveAntigravitySession }
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const root = provider.loadRoots()[0]
    assert.ok(root, id + ' fixture root')
    const paths = await import(`../server/providers/${id}/paths.js`)
    const q = new URLSearchParams({ root: root.id })
    const projects = (await provider.dispatch('GET', '/api/projects', q)).body.projects
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
      assert.equal(resolve({ meta: { ...meta, expectedSessionId: entries[0].id }, files: () => [] }).id, entries[0].id)
      assert.equal(resolve({ meta: { ...meta, expectedSessionId: '00000000-0000-4000-8000-000000000000' }, files: () => [] }), null)
    }
  }
  assert.throws(() => prepareAntigravityLaunch({ configDir: dir }), { status: 409 })
})
