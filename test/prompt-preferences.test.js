import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const compiled = await build({ entryPoints: ['src/lib/prefs.js'], bundle: true, write: false, format: 'cjs', platform: 'node' })
function boot(storage, root) {
  const bundled = { exports: {} }
  Function('require', 'module', 'exports', 'localStorage', 'document', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports, {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }, root ? { documentElement: root } : undefined)
  return bundled.exports
}

test('retired first-question choice is removed and latest defaults on', () => {
  const prefs = boot(new Map([['agentdeck_prefs', JSON.stringify({ showFirstPrompt: false })]])).getPrefs()
  assert.equal('showFirstPrompt' in prefs, false)
  assert.equal(prefs.showLatestPrompt, true)
})

test('only the latest-question choice persists, without the retired preference', () => {
  const storage = new Map([['agentdeck_prefs', JSON.stringify({ showFirstPrompt: true, showLatestPrompt: false })]])
  const app = boot(storage)
  app.setPref('showLatestPrompt', false)
  app.setPref('showFirstPrompt', true)
  let prefs = boot(storage).getPrefs()
  assert.equal(prefs.showLatestPrompt, false)
  assert.equal('showFirstPrompt' in prefs, false)
  assert.equal('showFirstPrompt' in JSON.parse(storage.get('agentdeck_prefs')), false)
  app.setPref('showLatestPrompt', true)
  prefs = boot(storage).getPrefs()
  assert.equal(prefs.showLatestPrompt, true)
  assert.equal('showFirstPrompt' in prefs, false)
})

test('malformed question preview values fall back to boolean defaults', () => {
  const prefs = boot(new Map([['agentdeck_prefs', JSON.stringify({ showFirstPrompt: null, showLatestPrompt: 'false' })]])).getPrefs()
  assert.equal('showFirstPrompt' in prefs, false)
  assert.equal(prefs.showLatestPrompt, true)
})

test('font size defaults to original, applies live and persists; invalid sizes cannot break layout', () => {
  const storage = new Map(), root = { dataset: {}, style: {} }
  const app = boot(storage, root)
  assert.equal(app.getPrefs().fontSize, 100)
  assert.equal(root.style.fontSize, '100%')
  app.setPref('fontSize', 125)
  assert.equal(root.style.fontSize, '125%')
  assert.equal(boot(storage).getPrefs().fontSize, 125)
  app.setPref('fontSize', 0)
  assert.equal(root.style.fontSize, '125%')
  storage.set('agentdeck_prefs', JSON.stringify({ fontSize: 'huge' }))
  assert.equal(boot(storage).getPrefs().fontSize, 100)
})

test('sidebar grouping is opt-in, persists, and rejects unsupported modes', () => {
  const storage = new Map(), app = boot(storage)
  assert.equal(app.getPrefs().sidebarMode, 'source')
  app.setPref('sidebarMode', 'folder')
  assert.equal(boot(storage).getPrefs().sidebarMode, 'folder')
  app.setPref('sidebarMode', 'invalid')
  assert.equal(app.getPrefs().sidebarMode, 'folder')
  storage.set('agentdeck_prefs', JSON.stringify({ sidebarMode: 'invalid' }))
  assert.equal(boot(storage).getPrefs().sidebarMode, 'source')
})

test('Recent projects has no independent mode after restoring old preferences', () => {
  const storage = new Map([['agentdeck_prefs', JSON.stringify({ sidebarMode: 'folder', recentProjectsBy: 'source' })]])
  const app = boot(storage)
  assert.equal(app.getPrefs().sidebarMode, 'folder')
  assert.equal('recentProjectsBy' in app.getPrefs(), false)
  app.setPref('recentProjectsBy', 'source')
  app.setPref('homeProjects', 10)
  assert.equal('recentProjectsBy' in JSON.parse(storage.get('agentdeck_prefs')), false)
})

test('folder visibility defaults are quiet, persist, and normalize malformed values', () => {
  const storage = new Map(), app = boot(storage)
  assert.equal(app.getPrefs().showUnavailableFolders, false)
  assert.deepEqual(app.getPrefs().folderExcludedProviders, [])
  app.setPref('showUnavailableFolders', true)
  app.setPref('folderExcludedProviders', ['claude', 'claude', null])
  assert.equal(boot(storage).getPrefs().showUnavailableFolders, true)
  assert.deepEqual(boot(storage).getPrefs().folderExcludedProviders, ['claude'])
  app.setPref('showUnavailableFolders', 'false')
  app.setPref('folderExcludedProviders', 'codex')
  assert.equal(app.getPrefs().showUnavailableFolders, true)
  assert.deepEqual(app.getPrefs().folderExcludedProviders, ['claude'])
  storage.set('agentdeck_prefs', JSON.stringify({ showUnavailableFolders: 'yes', folderExcludedProviders: ['future', '', 1, 'future'] }))
  assert.equal(boot(storage).getPrefs().showUnavailableFolders, false)
  assert.deepEqual(boot(storage).getPrefs().folderExcludedProviders, ['future'])
})

test('provider and exact-root filters persist atomically without changing unrelated preferences', () => {
  const storage = new Map(), app = boot(storage)
  const root = JSON.stringify(['claude', 'work'])
  assert.deepEqual(app.getPrefs().folderExcludedRoots, [])
  app.setPref('fontSize', 125)
  const seen = []
  app.subscribePrefs(() => seen.push(app.getPrefs()))
  app.setFolderFilter({ excluded: ['codex'], excludedRoots: [root, root, 'bad', '[null,1]'] })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].folderExcludedProviders, ['codex'])
  assert.deepEqual(seen[0].folderExcludedRoots, [root])
  const restored = boot(storage).getPrefs()
  assert.deepEqual(restored.folderExcludedRoots, [root])
  assert.equal(restored.fontSize, 125)
  assert.equal(restored.sidebarMode, 'source')
  app.setFolderFilter({})
  assert.deepEqual(boot(storage).getPrefs().folderExcludedRoots, [])
  assert.deepEqual(boot(storage).getPrefs().folderExcludedProviders, [])
})
