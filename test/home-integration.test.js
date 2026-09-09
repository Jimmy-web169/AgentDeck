import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFolderCatalog } from '../server/deck/catalog.js'
import { createHomeService } from '../server/deck/home.js'
import { createHomeAdapter } from '../server/deck/homeAdapter.js'
import { homeHistory, homeProjects } from '../server/shared/homeQuery.js'
import { normalizeHomeScope, homeQuery, resolveHomePresentation, homeSourceKey, homeSourceEnabled, toggleHomeFilter } from '../src/lib/homeScope.js'
import { loadTabs, TABS_KEY } from '../src/lib/tabs.js'
import { fromHash, toHash } from '../src/lib/route.js'

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-home-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const cwd = path.join(fs.realpathSync(dir), 'project'), other = path.join(fs.realpathSync(dir), 'other')
  fs.mkdirSync(cwd); fs.mkdirSync(other)
  const calls = [], roots = [{ id: 'personal', label: 'Personal' }, { id: 'work', label: 'Work' }]
  const make = (id) => {
    const dispatch = async (_method, endpoint, q) => {
      calls.push([id, q.get('root'), endpoint, Object.fromEntries(q)])
      const projects = [{ slug: `${id}-project`, cwd, sessions: 2, sessionCount: 2, subagentSessions: 1, userTurns: 4, toolCalls: 3, tokens: { input: 10, output: 5, cacheRead: 0, total: 15, reasoning: 2 } }, { slug: `${id}-other`, cwd: other, sessions: 1, sessionCount: 1, userTurns: 1, toolCalls: 2, tokens: { input: 3, output: 2, cacheRead: 0, total: 5, reasoning: 1 } }]
      const selected = homeProjects(q), matched = projects.filter((p) => !selected || selected.has(p.slug))
      if (endpoint === '/api/projects') return { status: 200, body: { projects } }
      if (options.fail?.(id, endpoint)) return { status: 503, body: { error: 'Source offline' } }
      if (endpoint === '/api/stats') return { status: 200, body: { projects: matched, tokens: { total: 999999 }, fields: { common: ['input', 'output', 'cacheRead', 'total'], specific: ['reasoning'] } } }
      if (endpoint === '/api/activity') return { status: 200, body: { records: matched.flatMap((p) => [{ id: 'same-id', slug: p.slug, cwd: p.cwd, lastTs: '2026-09-08T10:00:00Z', firstTs: '2026-09-08T09:00:00Z', userTurns: 2 }, { id: 'child-id', slug: p.slug, isSubagent: true, lastTs: '2026-09-07T09:00:00Z' }]) } }
      if (endpoint === '/api/history') return { status: 200, body: homeHistory([{ display: 'Older project question', project: cwd, sessionId: 'same-id', ts: 100 }, ...Array.from({ length: 600 }, (_, i) => ({ display: `Other question ${i}`, project: other, sessionId: `s${i}`, ts: i + 200 })), { display: 'Unattributed', project: null, ts: 900 }], q) }
      if (endpoint === '/api/plugins') return { status: 200, body: { installed: [{ name: 'review', enabled: id === 'future', scope: 'user' }] } }
      if (endpoint === '/api/resources') return { status: 200, body: { base: q.get('scope') === 'project' ? cwd : '/fictional/source', skills: [{ name: 'review' }], agentsMd: '', readOnly: true } }
      return { status: 404, body: {} }
    }
    return { id, loadRoots: () => roots, dispatch, home: createHomeAdapter(dispatch) }
  }
  const providers = { future: make('future'), second: make('second') }
  const catalog = createFolderCatalog(providers), service = createHomeService(providers, options)
  const q = (view, values = {}) => new URLSearchParams({ view, ...values })
  return { cwd, providers, catalog, service, calls, q }
}

test('Home totals cover all registered sources; legacy folder filters cannot narrow the report', async (t) => {
  const f = fixture(t), folder = (await f.catalog.list()).folders.find((x) => x.cwd === f.cwd)
  const result = await f.service.read(f.q('stats', { folder: folder.id }))
  assert.equal(result.scope.sources.length, 4)
  assert.equal(result.totals.sessions, 12)
  assert.equal(result.totals.tokens.total, 80)
  assert.equal(result.totals.tokens.reasoning, undefined, 'provider-specific fields never become global totals')
  assert.equal(result.sources[0].stats.tokens.reasoning, 3)
  const filtered = await f.service.read(f.q('stats', { folder: folder.id, excluded: '["future"]' }))
  assert.equal(filtered.totals.tokens.total, 40)
  assert.equal(filtered.scope.sources.length, 2)
  assert.ok(f.calls.filter((x) => x[2] === '/api/stats').every((x) => !('slugs' in x[3])))
  assert.equal(result.folders.length, 2)
  assert.equal(result.folders.find((f) => f.cwd === f.cwd).sources.length, 4)
  const empty = await f.service.read(f.q('stats', { excluded: '["future","second"]' }))
  assert.equal(empty.scope.sources.length, 0)
  assert.equal((await f.service.read(f.q('stats', { folder: 'missing' }))).totals.sessions, 12)
})

test('Insights recomputes activity from main records; native IDs stay distinct across providers and roots', async (t) => {
  const f = fixture(t, { now: () => Date.parse('2026-09-09T10:00:00Z') })
  const result = await f.service.read(f.q('insights'))
  assert.equal(result.activity.totals.sessions, 4)
  assert.equal(result.activity.totals.activeDays, 1)
  assert.equal(result.activity.sessionsDetail.medianDurationMin, 60)
  assert.equal(result.activity.compare.thisWeek.activeDays, 1)
  const folder = result.folders.find((folder) => folder.cwd === f.cwd)
  assert.equal(folder.sources.length, 4)
  assert.deepEqual(new Set(folder.sources.map((s) => JSON.stringify([s.provider, s.root, s.slug]))).size, 4)
  for (const source of folder.sources) {
    assert.equal(source.slug, `${source.provider}-project`)
    assert.equal(source.activity.totals.sessions, 1)
    assert.equal(source.activity.sessionsDetail.medianDurationMin, 60)
    assert.equal(source.activity.topProjects[0].slug, source.slug, 'native detail keeps the actual project slug')
  }
})

test('exact root filters apply before adapter reads across all Home pages and cache keys', async (t) => {
  const f = fixture(t)
  const excludedRoots = JSON.stringify([homeSourceKey({ provider: 'future', root: 'personal' })])
  for (const view of ['stats', 'insights', 'history', 'plugins', 'resources']) {
    await f.service.read(f.q(view))
    f.calls.length = 0
    const filtered = await f.service.read(f.q(view, { excludedRoots }))
    assert.equal(filtered.scope.sources.length, 3)
    if (view !== 'history') assert.equal(filtered.sources.length, 3)
    assert.ok(filtered.scope.sources.some((s) => s.provider === 'second' && s.root === 'personal'))
    assert.ok(f.calls.length > 0)
    assert.ok(f.calls.every(([p, r]) => p !== 'future' || r !== 'personal'))
    if (view === 'stats') assert.equal(filtered.totals.tokens.total, 60)
    if (view === 'insights') assert.equal(filtered.activity.totals.sessions, 3)
    if (view === 'history') {
      assert.equal(filtered.total, 1806)
      await assert.rejects(f.service.read(f.q(view, { cursor: filtered.nextCursor })), { status: 409 })
    }
  }
  for (const value of ['["personal"]', '["[]"]', '[1]', '{}']) await assert.rejects(f.service.read(f.q('stats', { excludedRoots: value })), { status: 400 })
  const empty = await f.service.read(f.q('stats', { excludedRoots: JSON.stringify(['future', 'second'].flatMap((provider) => ['personal', 'work'].map((root) => homeSourceKey({ provider, root })))) }))
  assert.equal(empty.scope.sources.length, 0)
})

test('provider/root toggles are reversible, normalize persisted filters, and keep the remembered Provider scope', () => {
  const sources = ['future', 'second'].flatMap((provider) => ['personal', 'work'].map((root) => ({ provider, root })))
  const enabled = (scope) => sources.filter((s) => homeSourceEnabled(s, scope)).map(homeSourceKey)
  let scope = toggleHomeFilter({}, sources, 'future')
  assert.equal(enabled(scope).length, 2)
  scope = toggleHomeFilter(scope, sources, 'future', 'work')
  assert.equal(enabled(scope).length, 3)
  assert.ok(!enabled(scope).includes(homeSourceKey(sources[0])))
  scope = toggleHomeFilter(scope, sources, 'future')
  assert.equal(enabled(scope).length, 2)
  scope = toggleHomeFilter(scope, sources, 'future')
  assert.equal(enabled(scope).length, 4)
  scope = toggleHomeFilter(scope, sources, 'future', 'personal')
  const parsed = new URLSearchParams(homeQuery('stats', scope))
  assert.deepEqual(JSON.parse(parsed.get('excludedRoots')), scope.excludedRoots)
  assert.deepEqual(normalizeHomeScope({ excludedRoots: [...scope.excludedRoots, ...scope.excludedRoots, 'bad', '[1,2]'] }), scope)
  const sidebar = { provider: 'second', root: 'personal' }
  const prefs = { sidebarMode: 'folder', folderExcludedRoots: scope.excludedRoots }
  const presentation = resolveHomePresentation(prefs, { view: 'stats' }, sidebar)
  assert.deepEqual(presentation.homeScope, scope)
  assert.equal(presentation.scope, sidebar)
  assert.equal(resolveHomePresentation({ ...prefs, sidebarMode: 'source' }, { view: 'stats' }, sidebar).scope, sidebar)
})

test('History filters before the legacy 500 limit and pages frozen results with scope-bound cursors', async (t) => {
  let clock = 1000
  const f = fixture(t, { pageSize: 2, now: () => clock }), folder = (await f.catalog.list()).folders.find((x) => x.cwd === f.cwd)
  const query = { folder: folder.id, search: 'Older project question' }
  const first = await f.service.read(f.q('history', query))
  assert.equal(first.total, 4)
  assert.equal(first.history.length, 2)
  assert.ok(first.history.every((h) => h.display === 'Older project question'))
  assert.equal(first.notices.length, 4, 'unattributed prompts are reported, never guessed into a folder')
  const next = await f.service.read(f.q('history', { ...query, cursor: first.nextCursor }))
  assert.equal(new Set([...first.history, ...next.history].map((h) => h.key)).size, 4)
  assert.equal(next.nextCursor, null)
  await assert.rejects(f.service.read(f.q('history', { ...query, excluded: '["future"]', cursor: first.nextCursor })), { status: 409 })
  await assert.rejects(f.service.read(f.q('stats', { ...query, cursor: first.nextCursor })), { status: 409 })
  clock += 120001
  await assert.rejects(f.service.read(f.q('history', { ...query, cursor: first.nextCursor })), { status: 409 })
  const searched = await f.service.read(f.q('history', { search: 'Other question 599' }))
  assert.equal(searched.total, 4)
})

test('partial or unsupported sources remain explicit; a future adapter works without page-specific provider switches', async (t) => {
  const f = fixture(t, { fail: (id, endpoint) => id === 'second' && endpoint === '/api/stats' })
  const result = await f.service.read(f.q('stats'))
  assert.equal(result.errors.length, 2)
  assert.equal(result.sources.length, 2)
  assert.deepEqual(result.coverage.total, { available: 2, sources: 4 })
  delete f.providers.second.home.insights
  const insights = await f.service.read(f.q('insights'))
  assert.ok(insights.errors.every((e) => /does not support/.test(e.error)))
  assert.equal(insights.sources.length, 2)
})

test('plugins and resources use registered roots, never project scope; resource reads do not leak config contents', async (t) => {
  const f = fixture(t), plugins = await f.service.read(f.q('plugins'))
  assert.equal(plugins.sources.length, 4)
  assert.equal(plugins.sources[0].data.installed[0].name, 'review')
  const folder = (await f.catalog.list()).folders.find((x) => x.cwd === f.cwd)
  const resources = await f.service.read(f.q('resources', { folder: folder.id }))
  assert.equal(resources.sources.length, 4)
  for (const source of resources.sources) {
    assert.deepEqual(source.entries.map((e) => e.scope), ['user'])
    assert.equal(source.entries[0].readOnly, true)
    assert.equal(source.entries[0].agentsMd, undefined)
    assert.ok(source.entries[0].items.some((g) => g.names.includes('AGENTS.md')), 'empty instruction files still exist')
  }
})

test('explicit empty project scopes do not expand, and malformed lists fail closed', () => {
  assert.equal(homeProjects(new URLSearchParams()), null)
  assert.equal(homeProjects(new URLSearchParams({ slugs: '[]' })).size, 0)
  assert.throws(() => homeProjects(new URLSearchParams({ slugs: '{}' })), { status: 400 })
  assert.deepEqual(homeHistory([{ project: '/fictional', display: 'Question' }], new URLSearchParams({ home: '1', cwds: '[]' })).history, [])
})

test('unavailable registered roots are explicit failures, not successful empty totals', async (t) => {
  const f = fixture(t)
  f.providers.second.loadRoots = () => [{ id: 'missing', dir: path.join(f.cwd, 'missing-root') }]
  const result = await f.service.read(f.q('stats'))
  assert.equal(result.scope.sources.length, 3)
  assert.equal(result.sources.length, 2)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0].error, /root is unavailable/)
  assert.deepEqual(result.coverage.total, { available: 2, sources: 3 })
})

test('legacy Home links round-trip without overriding current sidebar scope', () => {
  assert.deepEqual(normalizeHomeScope({ folder: 1, excluded: ['codex', '', 'codex', 2] }), { excluded: ['codex'] })
  const target = { provider: null, view: 'resources', homeScope: { excluded: ['codex'] }, homeSource: { provider: 'claude', root: 'work' } }
  assert.deepEqual(fromHash(toHash(target)), target)
  const prior = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: (key) => key === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'a', target }, { key: 'b', target: { provider: null, view: 'stats', homeScope: { folder: 'folder-b', excluded: [] } } }], activeKey: 'a' }) : null }
    const restored = loadTabs()
    assert.deepEqual(restored.tabs[0].target.homeScope, target.homeScope)
    assert.deepEqual(restored.tabs[0].target.homeSource, target.homeSource)
    assert.deepEqual(restored.tabs[1].target.homeScope, { excluded: [] })
  } finally { if (prior === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior }
  assert.equal(new URLSearchParams(homeQuery('history', target.homeScope)).get('folder'), null)
})

test('mode switching and source exclusions never replace the remembered Provider root', () => {
  const sidebar = { provider: 'codex', root: 'personal' }
  const target = { view: 'stats', homeScope: { excluded: ['claude'] } }
  const providerPrefs = { sidebarMode: 'source', folderExcludedProviders: ['codex'] }
  const provider = resolveHomePresentation(providerPrefs, target, sidebar)
  assert.equal(provider.integrated, false)
  assert.equal(provider.scope, sidebar)
  const folder = resolveHomePresentation({ ...providerPrefs, sidebarMode: 'folder' }, target, sidebar)
  assert.equal(folder.integrated, true)
  assert.deepEqual(folder.homeScope.excluded, ['codex'], 'only sidebar exclusions feed aggregate reads')
  assert.equal(folder.scope, sidebar)
  assert.equal(resolveHomePresentation(providerPrefs, target, sidebar).scope, sidebar)
  const focused = resolveHomePresentation({ sidebarMode: 'folder' }, { ...target, focus: { slug: 'project', id: 'session' } }, sidebar)
  assert.equal(focused.integrated, false, 'Session -> Stats keeps native focus')
  for (const view of ['plugins', 'resources']) {
    const source = { provider: 'claude', root: 'work' }
    const pinned = resolveHomePresentation({ sidebarMode: 'folder' }, { view, homeSource: source }, sidebar)
    assert.deepEqual(pinned.scope, source)
    assert.equal(pinned.integrated, false)
    assert.equal(resolveHomePresentation(providerPrefs, { view, homeSource: source }, sidebar).scope, sidebar)
  }
})

test('source pages do not consult the folder catalog; History includes unattributed and old folders', async (t) => {
  const f = fixture(t)
  const service = createHomeService(f.providers)
  for (const view of ['plugins', 'resources', 'history', 'stats', 'insights']) {
    const result = await service.read(f.q(view, { folder: 'deleted-folder' }))
    assert.equal(result.scope.sources.length, 4)
    assert.equal(result.errors.length, 0)
    if (view === 'history') {
      assert.equal(result.total, 2408)
      assert.equal(result.history.filter((h) => h.display === 'Unattributed').length, 4)
      assert.ok(result.history.filter((h) => h.display === 'Unattributed').every((h) => h.cwd === null))
    }
  }
  assert.equal(homeHistory([{ display: 'Past question', project: '/no-longer-exists' }], new URLSearchParams({ home: '1' })).history.length, 1)
})
