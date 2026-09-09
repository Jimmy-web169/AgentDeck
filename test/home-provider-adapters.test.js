import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateFixture } from '../scripts/demo/make-fixture.mjs'
import { PROVIDERS } from '../server/registry.js'

test('all three native Home adapters restrict projects before aggregating and expose raw activity only to the Home query', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-home-native-'))
  const prior = process.env.AGENTDECK_CONFIG_DIR
  process.env.AGENTDECK_CONFIG_DIR = dir
  t.after(() => { if (prior === undefined) delete process.env.AGENTDECK_CONFIG_DIR; else process.env.AGENTDECK_CONFIG_DIR = prior; fs.rmSync(dir, { recursive: true, force: true }) })
  const manifest = generateFixture({ out: dir, scenario: 'v2-highlights', seed: 7, now: '2026-09-09T08:00:00Z', platform: 'posix' })
  for (const provider of Object.values(PROVIDERS)) {
    const root = manifest.rootIds[provider.id]
    const native = await provider.dispatch('GET', '/api/stats', new URLSearchParams({ root }))
    assert.equal(native.status, 200)
    const project = native.body.projects[0]
    assert.ok(project, provider.id)
    const all = { root, allProjects: true }
    const allStats = await provider.home.stats(all)
    assert.deepEqual(allStats.projects.map((p) => p.slug), native.body.projects.map((p) => p.slug))
    assert.ok(Array.isArray((await provider.home.history(all)).history))
    assert.ok((await provider.home.insights(all)).records.length)
    const scope = { root, projects: [project] }
    const stats = await provider.home.stats(scope)
    assert.deepEqual(stats.projects.map((p) => p.slug), [project.slug], provider.id)
    assert.equal(stats.tokens.total, project.tokens.total, provider.id)
    const empty = await provider.home.stats({ root, projects: [] })
    assert.equal(empty.sessions, 0)
    assert.deepEqual(empty.projects, [])
    const activity = await provider.home.insights(scope)
    assert.ok(activity.records.length, provider.id)
    assert.ok(activity.records.every((r) => r.slug === project.slug), provider.id)
    const legacyActivity = await provider.dispatch('GET', '/api/activity', new URLSearchParams({ root }))
    assert.ok(legacyActivity.body.daily)
    assert.equal(legacyActivity.body.records, undefined)
    const history = await provider.home.history(scope)
    assert.ok(history.coverage)
    assert.ok(history.history.every((h) => h.project === project.cwd))
    const plugins = await provider.home.plugins(scope)
    assert.ok(Array.isArray(plugins.installed))
    const resources = await provider.home.resources(scope)
    assert.ok(Array.isArray(resources.items))
    assert.equal(resources.configToml, undefined, 'inventory does not expose full configuration contents')
  }
})
