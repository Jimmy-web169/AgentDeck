import { required } from '../../../helpers/assert.ts'
import type { Folder, FolderSource } from '../../../../src/api/models.ts'
import type { WorkspaceItem } from '../../../../src/lib/workspaces.ts'
import type { Pin } from '../../../../src/lib/pins.ts'
import { renderWithQuery as renderDom, mockNavIndex, mockProvider, mockProviderApi, mockSidebarContext } from '../../../helpers/query.ts'
import ConversationPending from '../../../../src/components/shared/ConversationPending.tsx'
import TerminalStatus from '../../../../src/components/shared/TerminalStatus.tsx'
import LinkConversationButton from '../../../../src/components/shared/LinkConversationButton.tsx'
import Preferences from '../../../../src/components/shared/Preferences.tsx'
import HomeView from '../../../../src/components/shared/HomeView.tsx'
import RowMenu from '../../../../src/components/shared/RowMenu.tsx'
import { getPrefs, setPref as pref } from '../../../../src/lib/prefs.ts'
// @vitest-environment jsdom
import React from 'react'
import { renderStaticWithQuery as renderToStaticMarkup } from '../../../helpers/query.ts'
import FolderProjects from '../../../../src/components/shared/FolderProjects.tsx'
import ProviderFilterChips from '../../../../src/components/shared/ProviderFilterChips.tsx'
import AppSidebar, { ProjectActions } from '../../../../src/components/shared/AppSidebar.tsx'
import { togglePin, getPins } from '../../../../src/lib/pins.ts'
// Original test group: folder-sidebar. Assertions retained during module-path migration.
import { test, vi } from 'vitest'
import { screen, within, cleanup, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  folderTree,
  folderHasTarget,
  visibleFolderTree,
  resolveFolderPins,
  providerBranches,
  folderAncestorKeys,
  folderNodeKey,
} from '../../../../src/lib/folderTree.ts'
import { folderPinTarget } from '../../../../src/lib/pins.ts'
import { folderItem, folderProjects, standaloneWorkspaceItems, workspaceSources, workspaceHolding, suggestWorkspaces } from '../../../../src/lib/workspaces.ts'
import { HOME_VIEWS, normalizeView, sameTarget, loadTabs, TABS_KEY } from '../../../../src/lib/tabs.ts'
import { fromHash } from '../../../../src/lib/route.ts'
import type { UIProvider } from '../../../../src/providers/views.ts'

const folders = [
  {
    id: 'canonical',
    cwd: '/work/repo',
    name: 'repo',
    resolved: true,
    sessionCount: 3,
    sources: [
      { provider: 'claude', root: 'personal', rootLabel: 'Personal', slug: '-work-repo', cwd: '/work/repo', sessionCount: 1 },
      { provider: 'codex', root: 'work', rootLabel: 'Work', slug: '/work/repo', cwd: '/work/repo', sessionCount: 1 },
      { provider: 'claude', root: 'work', rootLabel: 'Work', slug: '-work-repo', cwd: '/work/repo', sessionCount: 1 },
    ],
  },
] satisfies Folder[]

test('folder tree preserves canonical folder and provider/root/session identities', () => {
  const before = JSON.stringify(folders),
    tree = folderTree(folders)
  assert.equal(tree.length, 1)
  assert.equal(tree[0].sources.length, 3)
  assert.equal(JSON.stringify(folders), before)
  assert.equal(folderHasTarget(tree[0], { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' }), true)
  assert.equal(folderHasTarget(tree[0], { provider: 'claude', root: 'untracked', slug: '-work-repo' }), false)
  assert.equal(sameTarget({ ...tree[0].sources[0], id: 's' }, { ...tree[0].sources[1], id: 's' }), false)
  const unresolved = [
    { ...folders[0], id: 'unresolved-a', resolved: false },
    { ...folders[0], id: 'unresolved-b', resolved: false },
  ]
  assert.equal(folderTree(unresolved).length, 2, 'never merges missing paths by spelling')
})

test('folder pins are dynamic exact-identity references with reversible root filters and safe unavailable placeholders', () => {
  const pin = folderPinTarget(folders[0])
  const updated = [
    {
      ...folders[0],
      sources: [...folders[0].sources, { provider: 'future', root: 'next', rootLabel: 'next', cwd: '/work/repo', slug: 'new', sessionCount: 2 }],
    },
  ]
  assert.equal(resolveFolderPins([pin], updated)[0].sources.length, 4)
  const filtered = resolveFolderPins([pin], updated, { excludedRoots: [JSON.stringify(['claude', 'work'])] })[0]
  assert.equal(filtered.sources.length, 3)
  assert.ok(filtered.sources.some((s) => s.provider === 'codex' && s.root === 'work'))
  const empty = resolveFolderPins([pin], updated, { excludedProviders: ['claude', 'codex', 'future'] })[0]
  assert.equal(empty.sources.length, 0)
  assert.match(required(empty.pinStatus), /filters/)
  const moved = resolveFolderPins([pin], [{ ...updated[0], id: 'different-identity' }])[0]
  assert.equal(moved.sources.length, 0, 'matching display names or paths cannot retarget a pin')
  assert.match(required(moved.pinStatus), /unavailable/)
})

test('folder pins persist alongside legacy project/session pins without altering their identities', async () => {
  const previous = globalThis.localStorage
  const legacy = { provider: 'claude', root: 'work', slug: 'repo' }
  const storage = new Map([['agentdeck_pins', JSON.stringify([legacy, { kind: 'folder', folderId: '' }])]])
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) })
  try {
    const app = (await import('../../../../src/lib/pins.ts' + '?folder-write')) as typeof import('../../../../src/lib/pins.ts')
    assert.deepEqual(app.getPins(), [legacy])
    const pin = folderPinTarget(folders[0])
    app.togglePin(pin)
    const restored = (await import('../../../../src/lib/pins.ts' + '?folder-reload')) as typeof import('../../../../src/lib/pins.ts')
    assert.equal(restored.getPins().length, 2)
    assert.deepEqual(restored.pinsForMode(restored.getPins(), 'source'), [legacy])
    assert.equal(restored.pinsForMode(restored.getPins(), 'folder').length, 2)
    assert.equal(restored.getPins()[0].provider, undefined)
    assert.equal(restored.getPins()[0].sources, undefined, 'do not freeze membership')
    restored.togglePin(pin)
    assert.deepEqual(restored.getPins(), [legacy])
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else globalThis.localStorage = previous
  }
})

test('folder tree keeps new drafts visible and has stable alphabetical order across writes', () => {
  const drafts = [
    { provider: 'future', root: 'r', cwd: '/work/repo', draft: true, launchId: 'a' },
    { provider: 'future', root: 'r', cwd: '/work/new', draft: true, launchId: 'b' },
  ]
  const tree = folderTree(folders, drafts, [{ provider: 'future', root: 'r', rootLabel: 'New account' }])
  assert.equal(tree.length, 2)
  assert.equal(tree[0].cwd, '/work/new')
  assert.equal(tree[1].sources.length, 4)
  assert.equal(required(tree[1].sources.find((s) => s.provider === 'future')).rootLabel, 'New account')
  assert.deepEqual(
    folderTree(
      folders.map((f) => ({ ...f, lastActivity: Date.now() })),
      drafts
    ).map((f) => f.id),
    tree.map((f) => f.id)
  )
})

test('whole-folder Workspace membership resolves dynamically without merging roots or deleting explicit members', () => {
  const project = { ...folders[0].sources[0], kind: 'project' },
    session = { ...project, kind: 'session', id: 'kept' }
  const w = { id: 'ws', name: 'Group', at: 0, items: [folderItem(folders[0]), project, session] },
    before = JSON.stringify(w)
  assert.equal(folderProjects(w, folders).length, 3)
  assert.equal(workspaceSources(w, folders).length, 3)
  assert.deepEqual(standaloneWorkspaceItems(w, folders), [])
  assert.equal(workspaceHolding(folders[0].sources[1], [w], folders), w)
  assert.equal(workspaceHolding({ ...project, root: 'other' }, [w], folders), null)
  const next = [
    {
      ...folders[0],
      sources: [...folders[0].sources, { provider: 'future', root: 'work', rootLabel: 'work', cwd: '/work/repo', slug: 'new', sessionCount: 1 }],
    },
  ]
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
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) })
  try {
    const app = (await import('../../../../src/lib/workspaces.ts' + '?folder-write')) as typeof import('../../../../src/lib/workspaces.ts')
    const original = app.getWorkspaces()[0].items
    const item = folderItem(folders[0])
    app.addToWorkspace('legacy', item)
    app.addToWorkspace('legacy', item)
    assert.equal(app.getWorkspaces()[0].items.length, 2)
    assert.equal(app.inWorkspace(app.getWorkspaces()[0], item), true)
    app.addToWorkspace('legacy', { kind: 'folder', folderId: '', cwd: '/work/repo' })
    assert.equal(app.getWorkspaces()[0].items.length, 2)
    const loaded = (await import('../../../../src/lib/workspaces.ts' + '?folder-reload')) as typeof import('../../../../src/lib/workspaces.ts')
    assert.deepEqual(loaded.getWorkspaces()[0].items[1], item)
    assert.equal(loaded.getWorkspaces()[0].items[1].sources, undefined)
    loaded.removeFromWorkspace('legacy', item)
    loaded.removeFromWorkspace('legacy', item)
    assert.deepEqual(loaded.getWorkspaces()[0].items, original)
    const id = loaded.createWorkspace('Folder workspace', [item, item])
    assert.equal(loaded.createWorkspace('Duplicate', [item]), id)
    assert.deepEqual(required(loaded.getWorkspaces().find((w) => w.id === id)).items, [item])
    loaded.deleteWorkspace(id)
    assert.equal(loaded.getWorkspaces().length, 1)
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else globalThis.localStorage = previous
  }
})

type TreeProps = React.ComponentProps<typeof FolderProjects>
const tree = (
  props: Omit<TreeProps, 'ctx' | 'catalog'> & { ctx: Parameters<typeof mockSidebarContext>[0]; catalog: Pick<TreeProps['catalog'], 'folders' | 'errors'> }
) => captureDom(FolderProjects, { ...props, ctx: mockSidebarContext(props.ctx), catalog: { loading: false, error: '', ...props.catalog } })
const chips = (props: {
  providers: UIProvider[]
  scopes: { provider: string; root: string; rootLabel?: string }[]
  excluded?: string[]
  excludedRoots?: string[]
}) =>
  renderToStaticMarkup(
    React.createElement(ProviderFilterChips, {
      ...props,
      scopes: props.scopes.map((scope) => ({ providerLabel: scope.provider, rootLabel: scope.root, exists: true, probe: null, ...scope })),
      onToggle() {},
      onReset() {},
      onManage() {},
    })
  )
const actions = (props: Omit<React.ComponentProps<typeof ProjectActions>, 'ctx'> & { ctx: Parameters<typeof mockSidebarContext>[0] }) =>
  captureDom(ProjectActions, { ...props, ctx: mockSidebarContext(props.ctx) })

test('folder/provider/root layers are lazy; only the active branch auto-expands', () => {
  const reads: unknown[][] = []
  const props = {
    catalog: { folders, errors: [] },
    ctx: {
      drafts: [],
      index: { scopes: [] },
      providers: [mockProvider('claude', 'Claude Code'), mockProvider('codex', 'Codex')],
      newConversationItems: () => [],
    },
    filter: '',
    renderSessions: (src: WorkspaceItem) => {
      reads.push([src.provider, src.root, src.slug])
      return null
    },
    renderDrafts: () => null,
  }
  tree(props)
  assert.equal(reads.length, 0)
  tree({ ...props, filter: 'repo' })
  assert.equal(reads.length, 0, 'expanding a folder does not load every provider')
  const html = tree({ ...props, ctx: { ...props.ctx, activeTarget: { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' } } })
  assert.deepEqual(
    [...new Set(reads.map((read) => JSON.stringify(read)))].map((read) => JSON.parse(read)),
    [['claude', 'work', '-work-repo']],
    'live effects may reread the cached active branch, but never request another branch'
  )
  assert.match(html, /Claude Code.*Personal/)
  assert.match(html, /Codex.*Work/)
  assert.match(html, /font-semibold text-zinc-300/, 'providers are headings, not session rows')
  assert.match(html, /my-1 border-l border-zinc-700\/70 bg-ink-800\/20/, 'session lists have their own guide and spacing')
  assert.doesNotMatch(html, /<select/)
  reads.length = 0
  const hidden = tree({
    ...props,
    excludedProviders: ['claude'],
    ctx: { ...props.ctx, activeTarget: { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' } },
    filter: 'repo',
  })
  assert.doesNotMatch(hidden, /Claude Code/)
  assert.equal(reads.length, 0, 'an active tab does not override an excluded provider')
})

test('folder, provider and root counts reserve equal action space even without controls', () => {
  const html = tree({
    catalog: { folders, errors: [] },
    ctx: { drafts: [], index: { scopes: [] }, providers: [], activeTarget: folders[0].sources[0] },
    filter: '',
    renderSessions: () => null,
    renderDrafts: () => null,
  })
  assert.equal((html.match(/class="flex items-center w-14 shrink-0"/g) || []).length, 5, 'folder, two providers and two roots use the same action slot')
  assert.equal((html.match(/tabular-nums text-right/g) || []).length, 5, 'counts stay unshrunk and right-aligned')
})

test('Folder project actions reuse pin and workspace ownership without changing provider/root identities', () => {
  const src = folders[0].sources[2]
  const props = { src, menuKey: 'project', ctx: { menuFor: 'project', workspaces: [], newConversationItems: () => [{ label: 'New conversation here' }] } }
  const html = actions(props)
  assert.match(html, /Pin project/)
  assert.match(html, /title="More"/)
  assert.match(html, /Workspaces|New workspace with this/)
  assert.match(html, /New conversation here/)
  togglePin(src)
  try {
    const pinned = getPins()[0]
    assert.equal(pinned.provider, 'claude')
    assert.equal(pinned.root, 'work')
    assert.equal(pinned.slug, '-work-repo')
    assert.match(actions(props), /Unpin project/)
  } finally {
    togglePin(src)
  }
})

test('whole folders move into Workspace trees, retain menus, and filters do not mutate membership', () => {
  const w = { id: 'ws', name: 'Group', at: 0, items: [folderItem(folders[0])] }
  const ctx = { drafts: [], index: { scopes: [] }, providers: [], workspaces: [w], hideGrouped: true, activeTarget: folders[0].sources[0] }
  const props = { catalog: { folders, errors: [] }, ctx, filter: '', renderSessions: () => null, renderDrafts: () => null }
  assert.doesNotMatch(tree(props), /data-folder-id="canonical"/)
  const workspace = { ...props, section: 'workspace', workspace: w, ctx: { ...ctx, hideGrouped: false } }
  assert.match(tree(workspace), /data-folder-id="canonical"/)
  assert.match(tree(workspace), /title="More"/)
  assert.match(tree({ ...workspace, excludedProviders: ['claude', 'codex'] }), /No sources match the current filters/)
  assert.match(tree({ ...workspace, catalog: { folders: [], errors: [] } }), /Folder unavailable or no longer tracked/)
  assert.match(tree({ ...props, ctx: { ...ctx, hideGrouped: false } }), /data-folder-id="canonical"/)
  assert.equal(w.items.length, 1)
})

test('Folder projects move into Pinned or Workspaces just like Provider projects', async () => {
  const props = {
    catalog: { folders, errors: [] },
    ctx: { drafts: [], index: { scopes: [] }, providers: [], projectHidden: (s: Pin) => s.provider === 'claude' },
    filter: '',
    renderSessions: () => null,
    renderDrafts: () => null,
  }
  const html = tree(props)
  assert.match(html, /2 projects moved · see Pinned \/ Workspaces/)
  assert.doesNotMatch(html, /New conversation in/)
  const previous = getPrefs()
  try {
    pref('sidebarMode', 'folder')
    pref('showPinned', true)
    pref('showWorkspaces', true)
    pref('folderExcludedProviders', [])
    pref('folderExcludedRoots', [])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        assert.equal(new URL(url, 'http://fixture.invalid').pathname, '/api/deck/folders')
        return new Response(JSON.stringify({ folders, errors: [] }), { headers: { 'Content-Type': 'application/json' } })
      })
    )
    const source = folders[0].sources[0]
    const pin = { ...source, kind: 'project' }
    togglePin(pin)
    try {
      const { container } = renderDom(React.createElement(AppSidebar, sidebarProps(source)))
      await waitFor(() => assert.ok(container.querySelector('[data-folder-id="canonical"]')))
      assert.match(container.textContent, /projects? moved/)
      assert.ok(container.querySelector('aside'))
    } finally {
      cleanup()
      togglePin(pin)
    }
    const closed = vi.fn(),
      chosen = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 700, 300, 24))
    const { container } = renderDom(
      React.createElement(
        'div',
        null,
        React.createElement(RowMenu, {
          open: true,
          bounded: true,
          onClose: closed,
          items: [{ label: 'Keep working', onClick: chosen }],
        })
      )
    )
    const button = screen.getByRole('button', { name: 'Keep working' }),
      menu = button.parentElement
    assert.ok(menu)
    assert.equal(menu.parentElement, document.body, 'bounded menus portal beyond the sidebar clipping region')
    assert.equal(container.contains(menu), false)
    assert.equal(menu.style.position, '', 'fixed positioning is supplied by its theme class')
    assert.ok(menu.classList.contains('fixed'))
    assert.ok(Number.parseFloat(menu.style.maxHeight) > 0)
    assert.ok(Number.parseFloat(menu.style.maxHeight) <= window.innerHeight - 16)
    await userEvent.setup().click(button)
    assert.equal(chosen.mock.calls.length, 1)
    assert.equal(closed.mock.calls.length, 1)
  } finally {
    cleanup()
    for (const key of ['sidebarMode', 'showPinned', 'showWorkspaces', 'folderExcludedProviders', 'folderExcludedRoots'] as const) pref(key, previous[key])
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

test('outer folder pins move the existing tree and retain individually moved source projects', () => {
  const pin = folderPinTarget(folders[0])
  const props = {
    catalog: { folders, errors: [] },
    ctx: {
      drafts: [],
      index: { scopes: [] },
      providers: [mockProvider('claude', 'Claude Code'), mockProvider('codex', 'Codex')],
      hidePinned: true,
      folderPins: [pin],
    },
    filter: '',
    renderSessions: () => null,
    renderDrafts: () => null,
  }
  togglePin(pin)
  try {
    assert.doesNotMatch(tree(props), /data-folder-id="canonical"/)
    const pinned = tree({ ...props, section: 'pinned' })
    assert.match(pinned, /data-folder-id="canonical"/)
    assert.match(pinned, /Unpin folder/)
    assert.match(tree({ ...props, ctx: { ...props.ctx, hidePinned: false } }), /data-folder-id="canonical"/)
    const expanded = tree({ ...props, section: 'pinned', filter: 'repo', ctx: { ...props.ctx, projectHidden: (s: Pin) => s.provider === 'claude' } })
    assert.match(expanded, /Codex/)
    assert.doesNotMatch(expanded, /Claude Code/)
  } finally {
    togglePin(pin)
  }
  assert.match(tree(props), /data-folder-id="canonical"/)
})

test('unavailable folders are opt-in; filters remove empty folders and recalculate visible counts without mutation', () => {
  const missing = { ...folders[0], id: 'missing', resolved: false },
    draft = { ...missing, id: 'draft', draftOnly: true }
  const input = [...folders, missing, draft],
    before = JSON.stringify(input)
  assert.deepEqual(
    visibleFolderTree(input)
      .map((f) => f.id)
      .sort(),
    ['canonical', 'draft']
  )
  assert.equal(visibleFolderTree(input, { showUnavailable: true }).length, 3)
  const filtered = visibleFolderTree(input, { excludedProviders: ['claude'] })
  assert.equal(filtered[0].sessionCount, 1)
  assert.equal(
    filtered.every((f) => f.sources.every((s) => s.provider === 'codex')),
    true
  )
  assert.deepEqual(visibleFolderTree(input, { excludedProviders: ['claude', 'codex'], showUnavailable: true }), [])
  assert.equal(JSON.stringify(input), before)
})

test('provider branches aggregate roots without merging identities; order is stable and numeric', () => {
  const branches = providerBranches(folders[0], [{ id: 'codex' }, { id: 'claude' }])
  assert.deepEqual(
    branches.map((b) => [b.provider, b.roots.length, b.sessionCount]),
    [
      ['codex', 1, 1],
      ['claude', 2, 2],
    ]
  )
  assert.deepEqual(
    branches[1].roots.map((r) => r.root),
    ['personal', 'work']
  )
  const target = { provider: 'claude', root: 'work', slug: '-work-repo', id: 's' }
  assert.deepEqual(folderAncestorKeys(folders, target), [
    folderNodeKey('canonical'),
    folderNodeKey('canonical', 'claude'),
    folderNodeKey('canonical', 'claude', 'work'),
  ])
  assert.deepEqual(folderAncestorKeys(visibleFolderTree(folders, { excludedProviders: ['claude'] }), target), [])
  const named = ['project10', 'project2', 'alpha'].map((name, i) => ({ ...folders[0], id: name, name, cwd: `/parent${2 - i}/${name}` }))
  assert.deepEqual(
    folderTree(named).map((f) => f.name),
    ['alpha', 'project2', 'project10']
  )
})

test('provider filter chips expose individual roots in the same sidebar group and keep the manage-sources plus', () => {
  const props = {
    providers: [mockProvider('claude', 'Claude Code'), mockProvider('codex', 'Codex')],
    scopes: folders[0].sources,
    excluded: ['claude'],
  }
  const html = chips(props)
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
  assert.deepEqual(
    visible[0].sources.map((s) => [s.provider, s.root]),
    [
      ['claude', 'personal'],
      ['codex', 'work'],
    ]
  )
  assert.deepEqual(folderAncestorKeys(visible, { provider: 'claude', root: 'work', slug: '-work-repo' }), [])
  assert.equal(JSON.stringify(folders), before)
})

test('Home Folders is retired; old links and saved tabs fall back to Activity without removing sidebar folders', async () => {
  assert.equal(
    ['jsx', 'tsx'].some((ext) => fs.existsSync('src/components/shared/FolderView.' + ext)),
    false
  )
  assert.equal(
    HOME_VIEWS.some((v) => v.k === 'folders'),
    false
  )
  assert.equal(normalizeView(required(fromHash('#/home/folders')).view), 'activity')
  const oldStorage = globalThis.localStorage
  try {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'old', target: { provider: null, view: 'folders' } }], activeKey: 'old' }) : null,
    })
    assert.deepEqual(required(loadTabs()).tabs[0].target, { provider: null, view: 'activity', focus: null })
    assert.equal(required(loadTabs()).activeKey, 'old')
  } finally {
    if (oldStorage === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else globalThis.localStorage = oldStorage
  }
  const previous = getPrefs()
  try {
    pref('sidebarMode', 'source')
    const html = renderToStaticMarkup(
      React.createElement(HomeView, {
        providers: [],
        index: mockNavIndex(),
        tabKey: null,
        scope: null,
        onOpen() {},
        visible: false,
        target: { view: 'folders' },
        live: { ids: new Set<string>() },
        termKeys: new Set<string>(),
      })
    )
    assert.match(html, /Latest sessions|Recent projects/)
    assert.doesNotMatch(html, />Folders</)
    pref('sidebarMode', 'folder')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        assert.equal(new URL(url, 'http://fixture.invalid').pathname, '/api/deck/folders')
        return new Response(JSON.stringify({ folders, errors: [] }), { headers: { 'Content-Type': 'application/json' } })
      })
    )
    const { container } = renderDom(React.createElement(AppSidebar, sidebarProps(folders[0].sources[0])))
    await waitFor(() => assert.ok(container.querySelector('aside [data-folder-id="canonical"]')))
    assert.ok(screen.getByRole('group', { name: 'Folder providers' }), 'Folder mode remains in the one sidebar')
  } finally {
    cleanup()
    pref('sidebarMode', previous.sidebarMode)
    vi.unstubAllGlobals()
  }
})

test('folder, preferences and conversation-repair interface copy stays in English', async () => {
  const previous = getPrefs()
  const user = userEvent.setup()
  try {
    pref('sidebarMode', 'folder')
    const { container } = renderDom(
      React.createElement(
        'div',
        null,
        React.createElement(Preferences, { providers: [] }),
        React.createElement(LinkConversationButton, {
          api: mockProviderApi('codex', { projects: async () => ({ projects: [] }) }),
          provider: 'codex',
          root: 'r',
          cwd: '/fixture',
          terminalKey: 'fixture',
        }),
        React.createElement(TerminalStatus, { running: true, frameLoaded: false, terminalKey: 'fixture' }),
        React.createElement(ConversationPending, { target: { id: 'saved' }, error: 'fixture unavailable', onRetry() {} })
      )
    )
    await user.click(screen.getByTitle('Preferences'))
    const toggle = screen.getByRole('switch', { name: 'Show unavailable folders' })
    const before = toggle.getAttribute('aria-checked')
    await user.click(toggle)
    assert.notEqual(toggle.getAttribute('aria-checked'), before)
    assert.doesNotMatch(container.textContent, /\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: 'Match current conversation manually' }))
    const dialog = screen.getByRole('dialog', { name: 'Match current conversation manually' })
    await within(dialog).findByText(/No matching conversations/)
    assert.doesNotMatch(dialog.textContent, /\p{Script=Han}/u)
    assert.match(container.textContent, /Retry loading record/)
    const folderMarkup = tree({
      catalog: { folders, errors: [] },
      ctx: { drafts: [], index: { scopes: [] }, providers: [] },
      filter: '',
      renderSessions: () => null,
      renderDrafts: () => null,
    })
    assert.doesNotMatch(folderMarkup, /\p{Script=Han}/u)
    assert.doesNotMatch(chips({ providers: [mockProvider('codex', 'Codex')], scopes: folders[0].sources, excluded: [], excludedRoots: [] }), /\p{Script=Han}/u)
  } finally {
    cleanup()
    pref('sidebarMode', previous.sidebarMode)
    pref('showUnavailableFolders', previous.showUnavailableFolders)
  }
})

function sidebarProps(source: FolderSource) {
  return {
    providers: [mockProvider('claude', 'Claude Code'), mockProvider('codex', 'Codex')],
    index: mockNavIndex({
      scopes: folders[0].sources.map((source) => ({ ...source, providerLabel: source.provider, exists: true, probe: null })),
      projects: folders[0].sources.map((source) => ({
        ...source,
        slug: source.slug || '',
        cwd: source.cwd || '',
        providerLabel: source.provider,
        exists: true,
        probe: null,
        path: source.cwd || '',
        name: 'repo',
        lastActivity: 0,
      })),
      sessionsFor: () => [],
    }),
    scope: source,
    activeTarget: source,
    live: { ids: new Set<string>(), slugs: new Set<string>(), connection: 'live' as const, lastEvents: {} },
    termKeys: new Set<string>(),
    onScope() {},
    onOpenTarget() {},
    onManageFolders() {},
    onNewProject() {},
  }
}

test('Provider projects render with their current root label after sidebar section extraction', () => {
  const previous = getPrefs().sidebarMode
  try {
    pref('sidebarMode', 'source')
    const source = { ...folders[0].sources[0], rootLabel: 'Current account label' }
    const props = sidebarProps(source)
    props.index.scopes = [{ ...source, providerLabel: source.provider, exists: true, probe: null }]
    props.index.projects = [
      {
        ...source,
        providerLabel: source.provider,
        exists: true,
        probe: null,
        path: source.cwd || '',
        lastActivity: 0,
        name: 'Visible provider project',
        sessionCount: 1,
      },
    ]
    renderDom(React.createElement(AppSidebar, props))
    assert.ok(screen.getByTitle(source.cwd))
    assert.ok(screen.getByText('Current account label'))
  } finally {
    cleanup()
    pref('sidebarMode', previous)
  }
})

function captureDom<P extends object>(Component: React.ComponentType<P>, props: P) {
  const mounted = renderDom(React.createElement(Component, props))
  const html = mounted.container.innerHTML
  mounted.unmount()
  return html
}
