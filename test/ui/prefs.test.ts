import { required } from '../helpers/assert.ts'
// Original groups remain named below; test assertions are unchanged.
import { test, vi, afterEach } from 'vitest'
import { describe } from 'vitest'
import assert from 'node:assert/strict'

describe('prefs', () => {
  async function boot(storage: Map<string, string>, root?: { dataset: Record<string, string>; style: { fontSize?: string } }) {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('document', root ? { documentElement: root } : undefined)
    return import('../../src/lib/prefs.ts')
  }
  afterEach(() => vi.unstubAllGlobals())

  test('retired first-question choice is removed and latest defaults on', async () => {
    const prefs = (await boot(new Map([['agentdeck_prefs', JSON.stringify({ showFirstPrompt: false })]]))).getPrefs()
    assert.equal('showFirstPrompt' in prefs, false)
    assert.equal(prefs.showLatestPrompt, true)
  })

  test('only the latest-question choice persists, without the retired preference', async () => {
    const storage = new Map([['agentdeck_prefs', JSON.stringify({ showFirstPrompt: true, showLatestPrompt: false })]])
    const app = await boot(storage)
    app.setPref('showLatestPrompt', false)
    app.setPref('showFirstPrompt', true)
    let prefs = (await boot(storage)).getPrefs()
    assert.equal(prefs.showLatestPrompt, false)
    assert.equal('showFirstPrompt' in prefs, false)
    assert.equal('showFirstPrompt' in JSON.parse(required(storage.get('agentdeck_prefs'))), false)
    app.setPref('showLatestPrompt', true)
    prefs = (await boot(storage)).getPrefs()
    assert.equal(prefs.showLatestPrompt, true)
    assert.equal('showFirstPrompt' in prefs, false)
  })

  test('malformed question preview values fall back to boolean defaults', async () => {
    const prefs = (await boot(new Map([['agentdeck_prefs', JSON.stringify({ showFirstPrompt: null, showLatestPrompt: 'false' })]]))).getPrefs()
    assert.equal('showFirstPrompt' in prefs, false)
    assert.equal(prefs.showLatestPrompt, true)
  })

  test('font size defaults to original, applies live and persists; invalid sizes cannot break layout', async () => {
    const storage = new Map(),
      root: { dataset: Record<string, string>; style: { fontSize?: string } } = { dataset: {}, style: {} }
    const app = await boot(storage, root)
    assert.equal(app.getPrefs().fontSize, 100)
    assert.equal(root.style.fontSize, '100%')
    app.setPref('fontSize', 125)
    assert.equal(root.style.fontSize, '125%')
    assert.equal((await boot(storage)).getPrefs().fontSize, 125)
    app.setPref('fontSize', 0)
    assert.equal(root.style.fontSize, '125%')
    storage.set('agentdeck_prefs', JSON.stringify({ fontSize: 'huge' }))
    assert.equal((await boot(storage)).getPrefs().fontSize, 100)
  })

  test('sidebar grouping is opt-in, persists, and rejects unsupported modes', async () => {
    const storage = new Map(),
      app = await boot(storage)
    assert.equal(app.getPrefs().sidebarMode, 'source')
    app.setPref('sidebarMode', 'folder')
    assert.equal((await boot(storage)).getPrefs().sidebarMode, 'folder')
    app.setPref('sidebarMode', 'invalid')
    assert.equal(app.getPrefs().sidebarMode, 'folder')
    storage.set('agentdeck_prefs', JSON.stringify({ sidebarMode: 'invalid' }))
    assert.equal((await boot(storage)).getPrefs().sidebarMode, 'source')
  })

  test('Recent projects has no independent mode after restoring old preferences', async () => {
    const storage = new Map([['agentdeck_prefs', JSON.stringify({ sidebarMode: 'folder', recentProjectsBy: 'source' })]])
    const app = await boot(storage)
    assert.equal(app.getPrefs().sidebarMode, 'folder')
    assert.equal('recentProjectsBy' in app.getPrefs(), false)
    app.setPref('recentProjectsBy', 'source')
    app.setPref('homeProjects', 10)
    assert.equal('recentProjectsBy' in JSON.parse(required(storage.get('agentdeck_prefs'))), false)
  })

  test('folder visibility defaults are quiet, persist, and normalize malformed values', async () => {
    const storage = new Map(),
      app = await boot(storage)
    assert.equal(app.getPrefs().showUnavailableFolders, false)
    assert.deepEqual(app.getPrefs().folderExcludedProviders, [])
    app.setPref('showUnavailableFolders', true)
    app.setPref('folderExcludedProviders', ['claude', 'claude', null])
    assert.equal((await boot(storage)).getPrefs().showUnavailableFolders, true)
    assert.deepEqual((await boot(storage)).getPrefs().folderExcludedProviders, ['claude'])
    app.setPref('showUnavailableFolders', 'false')
    app.setPref('folderExcludedProviders', 'codex')
    assert.equal(app.getPrefs().showUnavailableFolders, true)
    assert.deepEqual(app.getPrefs().folderExcludedProviders, ['claude'])
    storage.set('agentdeck_prefs', JSON.stringify({ showUnavailableFolders: 'yes', folderExcludedProviders: ['future', '', 1, 'future'] }))
    assert.equal((await boot(storage)).getPrefs().showUnavailableFolders, false)
    assert.deepEqual((await boot(storage)).getPrefs().folderExcludedProviders, ['future'])
  })

  test('provider and exact-root filters persist atomically without changing unrelated preferences', async () => {
    const storage = new Map(),
      app = await boot(storage)
    const root = JSON.stringify(['claude', 'work'])
    assert.deepEqual(app.getPrefs().folderExcludedRoots, [])
    app.setPref('fontSize', 125)
    const seen: ReturnType<typeof app.getPrefs>[] = []
    app.subscribePrefs(() => seen.push(app.getPrefs()))
    app.setFolderFilter({ excluded: ['codex'], excludedRoots: [root, root, 'bad', '[null,1]'] })
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].folderExcludedProviders, ['codex'])
    assert.deepEqual(seen[0].folderExcludedRoots, [root])
    const restored = (await boot(storage)).getPrefs()
    assert.deepEqual(restored.folderExcludedRoots, [root])
    assert.equal(restored.fontSize, 125)
    assert.equal(restored.sidebarMode, 'source')
    app.setFolderFilter({})
    assert.deepEqual((await boot(storage)).getPrefs().folderExcludedRoots, [])
    assert.deepEqual((await boot(storage)).getPrefs().folderExcludedProviders, [])
  })

  test('the sub-agent pane share is clamped per arrangement and falls back to its defaults', async () => {
    const storage = new Map([['agentdeck_prefs', JSON.stringify({ subagentPane: { stacked: 0.95, beside: 'wide' } })]])
    const app = await boot(storage)
    assert.deepEqual(app.getPrefs().subagentPane, { stacked: 0.8, beside: 0.42 })
    app.setPref('subagentPane', { stacked: 0.1, beside: 0.6 })
    assert.deepEqual(app.getPrefs().subagentPane, { stacked: 0.2, beside: 0.6 })
    assert.deepEqual(JSON.parse(required(storage.get('agentdeck_prefs'))).subagentPane, { stacked: 0.2, beside: 0.6 })
    assert.deepEqual((await boot(new Map())).getPrefs().subagentPane, app.DEFAULT_PANE_SHARES)
  })
})
