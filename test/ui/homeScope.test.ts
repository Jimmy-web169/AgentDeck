import { required } from '../helpers/assert.ts'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { normalizeHomeScope, homeQuery, resolveHomePresentation, homeSourceKey, homeSourceEnabled, toggleHomeFilter } from '../../src/lib/homeScope.ts'

test('provider/root toggles are reversible, normalize persisted filters, and keep the remembered Provider scope', () => {
  const sources = ['future', 'second'].flatMap((provider) => ['personal', 'work'].map((root) => ({ provider, root })))
  const enabled = (scope: { excluded?: string[]; excludedRoots?: string[] }) => sources.filter((s) => homeSourceEnabled(s, scope)).map(homeSourceKey)
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
  assert.deepEqual(JSON.parse(required(parsed.get('excludedRoots'))), scope.excludedRoots)
  assert.deepEqual(normalizeHomeScope({ excludedRoots: [...(scope.excludedRoots || []), ...(scope.excludedRoots || []), 'bad', '[1,2]'] }), scope)
  assert.equal(new URLSearchParams(homeQuery('history', scope)).get('folder'), null)
  const sidebar = { provider: 'second', root: 'personal' }
  const prefs = { sidebarMode: 'folder', folderExcludedRoots: scope.excludedRoots }
  const presentation = resolveHomePresentation(prefs, { view: 'stats' }, sidebar)
  assert.deepEqual(presentation.homeScope, scope)
  assert.equal(presentation.scope, sidebar)
  assert.equal(resolveHomePresentation({ ...prefs, sidebarMode: 'source' }, { view: 'stats' }, sidebar).scope, sidebar)
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
