import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { folderTree, folderHasTarget, visibleFolderTree, resolveFolderPins, providerBranches, folderAncestorKeys, folderNodeKey } from '../src/lib/folderTree.js'
import { folderPinTarget } from '../src/lib/pins.js'
import { folderItem, folderProjects, standaloneWorkspaceItems, workspaceSources, workspaceHolding, suggestWorkspaces } from '../src/lib/workspaces.js'
import { HOME_VIEWS, normalizeView, sameTarget, loadTabs, TABS_KEY } from '../src/lib/tabs.js'
import { fromHash } from '../src/lib/route.js'

const folders = [{ id: 'canonical', cwd: '/work/repo', name: 'repo', resolved: true, sessionCount: 3, sources: [
  { provider: 'claude', root: 'personal', rootLabel: 'Personal', slug: '-work-repo', cwd: '/work/repo', sessionCount: 1 },
  { provider: 'codex', root: 'work', rootLabel: 'Work', slug: '/work/repo', cwd: '/work/repo', sessionCount: 1 },
  { provider: 'claude', root: 'work', rootLabel: 'Work', slug: '-work-repo', cwd: '/work/repo', sessionCount: 1 },
] }]

test('folder tree preserves canonical folder and provider/root/session identities', () => {
  const before = JSON.stringify(folders), tree = folderTree(folders)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].sources.length, 3)
  assert.equal(JSON.stringify(folders), before)
  assert.equal(folderHasTarget(tree[0], { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' }), true)
  assert.equal(folderHasTarget(tree[0], { provider: 'claude', root: 'untracked', slug: '-work-repo' }), false)
  assert.equal(sameTarget({ ...tree[0].sources[0], id: 's' }, { ...tree[0].sources[1], id: 's' }), false)
  const unresolved = [{ ...folders[0], id: 'unresolved-a', resolved: false }, { ...folders[0], id: 'unresolved-b', resolved: false }]
  assert.equal(folderTree(unresolved).length, 2, 'never merges missing paths by spelling')
})

test('folder pins are dynamic exact-identity references with reversible root filters and safe unavailable placeholders', () => {
  const pin = folderPinTarget(folders[0])
  const updated = [{ ...folders[0], sources: [...folders[0].sources, { provider: 'future', root: 'next', slug: 'new', sessionCount: 2 }] }]
  assert.equal(resolveFolderPins([pin], updated)[0].sources.length, 4)
  const filtered = resolveFolderPins([pin], updated, { excludedRoots: [JSON.stringify(['claude', 'work'])] })[0]
  assert.equal(filtered.sources.length, 3)
  assert.ok(filtered.sources.some((s) => s.provider === 'codex' && s.root === 'work'))
  const empty = resolveFolderPins([pin], updated, { excludedProviders: ['claude', 'codex', 'future'] })[0]
  assert.equal(empty.sources.length, 0)
  assert.match(empty.pinStatus, /filters/)
  const moved = resolveFolderPins([pin], [{ ...updated[0], id: 'different-identity' }])[0]
  assert.equal(moved.sources.length, 0, 'matching display names or paths cannot retarget a pin')
  assert.match(moved.pinStatus, /unavailable/)
})

test('folder pins persist alongside legacy project/session pins without altering their identities', async () => {
  const previous = globalThis.localStorage
  const legacy = { provider: 'claude', root: 'work', slug: 'repo' }
  const storage = new Map([['agentdeck_pins', JSON.stringify([legacy, { kind: 'folder', folderId: '' }])]])
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  try {
    const app = await import('../src/lib/pins.js?folder-write')
    assert.deepEqual(app.getPins(), [legacy])
    const pin = folderPinTarget(folders[0])
    app.togglePin(pin)
    const restored = await import('../src/lib/pins.js?folder-reload')
    assert.equal(restored.getPins().length, 2)
    assert.deepEqual(restored.pinsForMode(restored.getPins(), 'source'), [legacy])
    assert.equal(restored.pinsForMode(restored.getPins(), 'folder').length, 2)
    assert.equal(restored.getPins()[0].provider, undefined)
    assert.equal(restored.getPins()[0].sources, undefined, 'do not freeze membership')
    restored.togglePin(pin)
    assert.deepEqual(restored.getPins(), [legacy])
  } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous }
})

test('folder tree keeps new drafts visible and has stable alphabetical order across writes', () => {
  const drafts = [{ provider: 'future', root: 'r', cwd: '/work/repo', draft: true, launchId: 'a' }, { provider: 'future', root: 'r', cwd: '/work/new', draft: true, launchId: 'b' }]
  const tree = folderTree(folders, drafts, [{ provider: 'future', root: 'r', rootLabel: 'New account' }])
  assert.equal(tree.length, 2)
  assert.equal(tree[0].cwd, '/work/new')
  assert.equal(tree[1].sources.length, 4)
  assert.equal(tree[1].sources.find((s) => s.provider === 'future').rootLabel, 'New account')
  assert.deepEqual(folderTree(folders.map((f) => ({ ...f, lastActivity: Date.now() })), drafts).map((f) => f.id), tree.map((f) => f.id))
})

test('whole-folder Workspace membership resolves dynamically without merging roots or deleting explicit members', () => {
  const project = { ...folders[0].sources[0], kind: 'project' }, session = { ...project, kind: 'session', id: 'kept' }
  const w = { id: 'ws', items: [folderItem(folders[0]), project, session] }, before = JSON.stringify(w)
  assert.equal(folderProjects(w, folders).length, 3)
  assert.equal(workspaceSources(w, folders).length, 3)
  assert.deepEqual(standaloneWorkspaceItems(w, folders), [])
  assert.equal(workspaceHolding(folders[0].sources[1], [w], folders), w)
  assert.equal(workspaceHolding({ ...project, root: 'other' }, [w], folders), null)
  const next = [{ ...folders[0], sources: [...folders[0].sources, { provider: 'future', root: 'work', slug: 'new', sessionCount: 1 }] }]
  assert.equal(folderProjects(w, next).length, 4)
  assert.deepEqual(suggestWorkspaces(folders[0].sources, [w], folders), [])
  assert.equal(folderProjects(w, [{ ...folders[0], id: 'moved' }]).length, 0, 'same cwd cannot retarget a canonical reference')
  assert.equal(folderProjects(w, [{ ...folders[0], resolved: false }]).length, 0)
  assert.deepEqual(standaloneWorkspaceItems(w, []), [project, session], 'unavailable folder does not hide explicit members')
  assert.deepEqual(standaloneWorkspaceItems({ ...w, items: [project, session] }, folders), [project, session])
  assert.equal(JSON.stringify(w), before)
})

test('folder Workspace items persist with legacy members; add/remove is idempotent and reversible', async () => {
  const previous = globalThis.localStorage
  const legacy = { id: 'legacy', name: 'Existing', projects: [folders[0].sources[0]] }
  const storage = new Map([['agentdeck_workspaces', JSON.stringify([legacy])]])
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  try {
    const app = await import('../src/lib/workspaces.js?folder-write')
    const original = app.getWorkspaces()[0].items
    const item = folderItem(folders[0])
    app.addToWorkspace('legacy', item)
    app.addToWorkspace('legacy', item)
    assert.equal(app.getWorkspaces()[0].items.length, 2)
    assert.equal(app.inWorkspace(app.getWorkspaces()[0], item), true)
    app.addToWorkspace('legacy', { kind: 'folder', folderId: '', cwd: '/work/repo' })
    assert.equal(app.getWorkspaces()[0].items.length, 2)
    const loaded = await import('../src/lib/workspaces.js?folder-reload')
    assert.deepEqual(loaded.getWorkspaces()[0].items[1], item)
    assert.equal(loaded.getWorkspaces()[0].items[1].sources, undefined)
    loaded.removeFromWorkspace('legacy', item)
    loaded.removeFromWorkspace('legacy', item)
    assert.deepEqual(loaded.getWorkspaces()[0].items, original)
    const id = loaded.createWorkspace('Folder workspace', [item, item])
    assert.equal(loaded.createWorkspace('Duplicate', [item]), id)
    assert.deepEqual(loaded.getWorkspaces().find((w) => w.id === id).items, [item])
    loaded.deleteWorkspace(id)
    assert.equal(loaded.getWorkspaces().length, 1)
  } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous }
})

const compiled = await build({ stdin: { contents: `
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import FolderProjects from './src/components/shared/FolderProjects.jsx'
import TabStrip from './src/components/shared/TabStrip.jsx'
import ProviderFilterChips from './src/components/shared/ProviderFilterChips.jsx'
import { ProjectActions } from './src/components/shared/AppSidebar.jsx'
import { togglePin, getPins } from './src/lib/pins.js'
export const tree = (props) => renderToStaticMarkup(React.createElement(FolderProjects, props))
export const strip = (count) => renderToStaticMarkup(React.createElement(TabStrip, { tabs: [], providers: [], liveCount: count, onLive() {} }))
export const chips = (props) => renderToStaticMarkup(React.createElement(ProviderFilterChips, props))
export const actions = (props) => renderToStaticMarkup(React.createElement(ProjectActions, props))
export const pin = togglePin
export const pins = getPins
`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' } })
const bundled = { exports: {} }
Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)

test('folder/provider/root layers are lazy; only the active branch auto-expands', () => {
  const reads = []
  const props = { catalog: { folders, errors: [] }, ctx: { drafts: [], index: { scopes: [] }, providers: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }], newConversationItems: () => [] }, filter: '',
    renderSessions: (src) => { reads.push([src.provider, src.root, src.slug]); return null }, renderDrafts: () => null }
  bundled.exports.tree(props)
  assert.equal(reads.length, 0)
  bundled.exports.tree({ ...props, filter: 'repo' })
  assert.equal(reads.length, 0, 'expanding a folder does not load every provider')
  const html = bundled.exports.tree({ ...props, ctx: { ...props.ctx, activeTarget: { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' } } })
  assert.deepEqual(reads, [['claude', 'work', '-work-repo']])
  assert.match(html, /Claude Code.*Personal/)
  assert.match(html, /Codex.*Work/)
  assert.match(html, /font-semibold text-zinc-300/, 'providers are headings, not session rows')
  assert.match(html, /my-1 border-l border-zinc-700\/70 bg-ink-800\/20/, 'session lists have their own guide and spacing')
  assert.doesNotMatch(html, /<select/)
  reads.length = 0
  const hidden = bundled.exports.tree({ ...props, excludedProviders: ['claude'], ctx: { ...props.ctx, activeTarget: { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' } }, filter: 'repo' })
  assert.doesNotMatch(hidden, /Claude Code/)
  assert.equal(reads.length, 0, 'an active tab does not override an excluded provider')
})

test('folder, provider and root counts reserve equal action space even without controls', () => {
  const html = bundled.exports.tree({ catalog: { folders, errors: [] }, ctx: { drafts: [], index: { scopes: [] }, providers: [], activeTarget: folders[0].sources[0] }, filter: '', renderSessions: () => null, renderDrafts: () => null })
  assert.equal((html.match(/class="flex items-center w-14 shrink-0"/g) || []).length, 5, 'folder, two providers and two roots use the same action slot')
  assert.equal((html.match(/tabular-nums text-right/g) || []).length, 5, 'counts stay unshrunk and right-aligned')
})

test('Folder project actions reuse pin and workspace ownership without changing provider/root identities', () => {
  const src = folders[0].sources[2]
  const props = { src, menuKey: 'project', ctx: { menuFor: 'project', workspaces: [], newConversationItems: () => [{ label: 'New conversation here' }] } }
  const html = bundled.exports.actions(props)
  assert.match(html, /Pin project/)
  assert.match(html, /title="More"/)
  assert.match(html, /Workspaces|New workspace with this/)
  assert.match(html, /New conversation here/)
  bundled.exports.pin(src)
  try {
    const pinned = bundled.exports.pins()[0]
    assert.equal(pinned.provider, 'claude')
    assert.equal(pinned.root, 'work')
    assert.equal(pinned.slug, '-work-repo')
    assert.match(bundled.exports.actions(props), /Unpin project/)
  } finally { bundled.exports.pin(src) }
})

test('whole folders move into Workspace trees, retain menus, and filters do not mutate membership', () => {
  const w = { id: 'ws', name: 'Group', items: [folderItem(folders[0])] }
  const ctx = { drafts: [], index: { scopes: [] }, providers: [], workspaces: [w], hideGrouped: true, activeTarget: folders[0].sources[0] }
  const props = { catalog: { folders, errors: [] }, ctx, filter: '', renderSessions: () => null, renderDrafts: () => null }
  assert.doesNotMatch(bundled.exports.tree(props), /data-folder-id="canonical"/)
  const workspace = { ...props, section: 'workspace', workspace: w, ctx: { ...ctx, hideGrouped: false } }
  assert.match(bundled.exports.tree(workspace), /data-folder-id="canonical"/)
  assert.match(bundled.exports.tree(workspace), /title="More"/)
  assert.match(bundled.exports.tree({ ...workspace, excludedProviders: ['claude', 'codex'] }), /No sources match the current filters/)
  assert.match(bundled.exports.tree({ ...workspace, catalog: { folders: [], errors: [] } }), /Folder unavailable or no longer tracked/)
  assert.match(bundled.exports.tree({ ...props, ctx: { ...ctx, hideGrouped: false } }), /data-folder-id="canonical"/)
  assert.equal(w.items.length, 1)
})

test('Folder projects move into Pinned or Workspaces just like Provider projects', () => {
  const props = { catalog: { folders, errors: [] }, ctx: { drafts: [], index: { scopes: [] }, providers: [], projectHidden: (s) => s.provider === 'claude' }, filter: '', renderSessions: () => null, renderDrafts: () => null }
  const html = bundled.exports.tree(props)
  assert.match(html, /2 projects moved · see Pinned \/ Workspaces/)
  assert.doesNotMatch(html, /New conversation in/)
  const sidebar = fs.readFileSync('src/components/shared/AppSidebar.jsx', 'utf8')
  assert.doesNotMatch(sidebar, /hideGrouped: false, hidePinned: false/)
  assert.match(sidebar, /renderProjectActions=.*<ProjectActions/)
  const menu = fs.readFileSync('src/components/shared/RowMenu.jsx', 'utf8')
  assert.match(menu, /createPortal\(menu, document.body\)/)
  assert.match(menu, /maxHeight:/)
})

test('outer folder pins move the existing tree and retain individually moved source projects', () => {
  const pin = folderPinTarget(folders[0])
  const props = { catalog: { folders, errors: [] }, ctx: { drafts: [], index: { scopes: [] }, providers: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }], hidePinned: true, folderPins: [pin] }, filter: '', renderSessions: () => null, renderDrafts: () => null }
  bundled.exports.pin(pin)
  try {
    assert.doesNotMatch(bundled.exports.tree(props), /data-folder-id="canonical"/)
    const pinned = bundled.exports.tree({ ...props, section: 'pinned' })
    assert.match(pinned, /data-folder-id="canonical"/)
    assert.match(pinned, /Unpin folder/)
    assert.match(bundled.exports.tree({ ...props, ctx: { ...props.ctx, hidePinned: false } }), /data-folder-id="canonical"/)
    const expanded = bundled.exports.tree({ ...props, section: 'pinned', filter: 'repo', ctx: { ...props.ctx, projectHidden: (s) => s.provider === 'claude' } })
    assert.match(expanded, /Codex/)
    assert.doesNotMatch(expanded, /Claude Code/)
  } finally { bundled.exports.pin(pin) }
  assert.match(bundled.exports.tree(props), /data-folder-id="canonical"/)
})

test('unavailable folders are opt-in; filters remove empty folders and recalculate visible counts without mutation', () => {
  const missing = { ...folders[0], id: 'missing', resolved: false }, draft = { ...missing, id: 'draft', draftOnly: true }
  const input = [...folders, missing, draft], before = JSON.stringify(input)
  assert.deepEqual(visibleFolderTree(input).map((f) => f.id).sort(), ['canonical', 'draft'])
  assert.equal(visibleFolderTree(input, { showUnavailable: true }).length, 3)
  const filtered = visibleFolderTree(input, { excludedProviders: ['claude'] })
  assert.equal(filtered[0].sessionCount, 1)
  assert.equal(filtered.every((f) => f.sources.every((s) => s.provider === 'codex')), true)
  assert.deepEqual(visibleFolderTree(input, { excludedProviders: ['claude', 'codex'], showUnavailable: true }), [])
  assert.equal(JSON.stringify(input), before)
})

test('provider branches aggregate roots without merging identities; order is stable and numeric', () => {
  const branches = providerBranches(folders[0], [{ id: 'codex' }, { id: 'claude' }])
  assert.deepEqual(branches.map((b) => [b.provider, b.roots.length, b.sessionCount]), [['codex', 1, 1], ['claude', 2, 2]])
  assert.deepEqual(branches[1].roots.map((r) => r.root), ['personal', 'work'])
  const target = { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' }
  assert.deepEqual(folderAncestorKeys(folders, target), [folderNodeKey('canonical'), folderNodeKey('canonical', 'claude'), folderNodeKey('canonical', 'claude', 'work')])
  assert.deepEqual(folderAncestorKeys(visibleFolderTree(folders, { excludedProviders: ['claude'] }), target), [])
  const named = ['project10', 'project2', 'alpha'].map((name, i) => ({ ...folders[0], id: name, name, cwd: `/parent${2 - i}/${name}` }))
  assert.deepEqual(folderTree(named).map((f) => f.name), ['alpha', 'project2', 'project10'])
})

test('provider filter chips expose individual roots in the same sidebar group and keep the manage-sources plus', () => {
  const props = { providers: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }], scopes: folders[0].sources, excluded: ['claude'] }
  const html = bundled.exports.chips(props)
  assert.equal((html.match(/aria-pressed=/g) || []).length, 4, 'two provider chips plus two individually selectable Claude roots')
  assert.match(html, /aria-label="Claude Code \/ Personal"/)
  assert.match(html, /aria-label="Claude Code \/ Work"/)
  assert.match(html, /Filter by provider and root/)
  assert.match(html, /aria-pressed="false"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /Show all/)
  assert.match(html, /Add or manage sources/)
  assert.match(html, /Show all Claude Code folders \(2 roots\)/)
  assert.match(html, /Hide all Codex folders \(1 root\)/)
  assert.doesNotMatch(html, /All providers &amp; roots|Manage sources/)
})

test('root exclusions retain same-named roots from other providers and do not reopen hidden active branches', () => {
  const before = JSON.stringify(folders)
  const visible = visibleFolderTree(folders, { excludedRoots: [JSON.stringify(['claude', 'work'])] })
  assert.equal(visible[0].sessionCount, 2)
  assert.deepEqual(visible[0].sources.map((s) => [s.provider, s.root]), [['claude', 'personal'], ['codex', 'work']])
  assert.deepEqual(folderAncestorKeys(visible, { provider: 'claude', root: 'work', slug: '-work-repo' }), [])
  assert.equal(JSON.stringify(folders), before)
})

test('Live is global even with zero terminals, while Home no longer lists dashboards', () => {
  for (const count of [0, 3]) assert.match(bundled.exports.strip(count), /Live sessions &amp; dashboards · all providers/)
  assert.equal(HOME_VIEWS.some((v) => v.k === 'dashboards'), false)
  assert.equal(normalizeView('dashboards'), 'activity')
  for (const p of ['ClaudeApp.jsx', 'IdApp.jsx']) assert.doesNotMatch(fs.readFileSync(`src/${p}`, 'utf8'), /LiveSessionsPanel|setShowLive|onManagerEnter/)
  assert.match(fs.readFileSync('src/App.jsx', 'utf8'), /openTarget\(liveTarget\(t\), \{ newTab: true \}\)/)
})

test('Home Folders is retired; old links and saved tabs fall back to Activity without removing sidebar folders', () => {
  assert.equal(HOME_VIEWS.some((v) => v.k === 'folders'), false)
  assert.equal(normalizeView(fromHash('#/home/folders').view), 'activity')
  const oldStorage = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: (key) => key === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'old', target: { provider: null, view: 'folders' } }], activeKey: 'old' }) : null }
    assert.deepEqual(loadTabs().tabs[0].target, { provider: null, view: 'activity', focus: null })
    assert.equal(loadTabs().activeKey, 'old')
  } finally { if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage }
  assert.doesNotMatch(fs.readFileSync('src/components/shared/HomeView.jsx', 'utf8'), /FolderView|view === 'folders'/)
  assert.match(fs.readFileSync('src/components/shared/AppSidebar.jsx', 'utf8'), /<FolderProjects/)
  assert.doesNotMatch(fs.readFileSync('src/App.jsx', 'utf8'), /FolderView/)
  assert.equal(fs.existsSync('src/components/shared/FolderView.jsx'), false)
})

test('folder, preferences and conversation-repair interface copy stays in English', () => {
  for (const file of ['ProviderFilterChips', 'FolderProjects', 'Preferences', 'LinkConversationButton', 'TerminalStatus', 'ConversationPending']) {
    assert.doesNotMatch(fs.readFileSync(`src/components/shared/${file}.jsx`, 'utf8'), /\p{Script=Han}/u, `${file} should not contain hard-coded Chinese UI copy`)
  }
  assert.doesNotMatch(fs.readFileSync('src/lib/terminalStatus.js', 'utf8'), /\p{Script=Han}/u)
  assert.match(fs.readFileSync('src/components/shared/Preferences.jsx', 'utf8'), /label="Show unavailable folders"/)
})
