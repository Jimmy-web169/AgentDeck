import { mockNavIndex, mockNavSession, mockProvider } from '../helpers/query.ts'
import type { Pin } from '../../src/lib/pins.ts'
import { buildGroups, pinTargetOf } from '../../src/lib/quickSwitcher.ts'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { targetKey, liveTarget } from '../../src/lib/tabs.ts'
import type { Folder } from '../../src/api/models.ts'
import type { NavProject } from '../../src/api/useNavIndex.ts'

function action(row: ReturnType<typeof buildGroups>[number]['rows'][number] | undefined) {
  assert.ok(row && 'target' in row, 'expected an actionable search result')
  return row
}
const a = { provider: 'codex', root: 'r', cwd: '/work/same', launchId: 'a', key: 'codex|r|launch|a', title: 'First draft', startedAt: 10 }
const b = { ...a, launchId: 'b', key: 'codex|r|launch|b', title: 'Second draft', startedAt: 20 }
const args: Parameters<typeof buildGroups>[0] = {
  q: '',
  level: null,
  index: mockNavIndex(),
  recent: [],
  pins: [],
  live: { ids: new Set(), slugs: new Set() },
  openTabs: new Set([targetKey(liveTarget(a))]),
  providers: [mockProvider('codex', 'Codex')],
  terminals: [a, b],
}

test('folder pins only appear in Folder mode, search by path, and never masquerade as provider targets', () => {
  const pin: Pin = { kind: 'folder', folderId: 'folder-a', cwd: '/work/unique-project', name: 'unique-project' }
  const options = { ...args, terminals: [], pins: [pin] }
  assert.ok(!buildGroups(options).some((g) => g.title === 'Pinned'))
  for (const q of ['', 'unique-project']) {
    const groups = buildGroups({ ...options, sidebarMode: 'folder', q })
    const row = action(groups.flatMap((g) => g.rows).find((r) => r.kind === 'folder'))
    assert.equal(row.target, pin)
    assert.equal(row.primary, 'work/unique-project')
    assert.equal(row.target.provider, undefined)
    assert.equal(row.context, 'Show in sidebar')
    assert.ok(!groups.some((g) => g.rows.some((r) => 'text' in r && r.text === 'Nothing matches')))
  }
})

test('new-tab picker lists idle live drafts without transcripts or recent history', () => {
  const groups = buildGroups(args)
  assert.equal(groups[0].title, 'Navigation')
  assert.equal(action(groups[0].rows[0]).kind, 'home')
  assert.equal(groups[1].title, 'Live sessions')
  assert.deepEqual(
    groups[1].rows.map((r) => action(r).primary),
    ['Second draft', 'First draft']
  )
  assert.equal(action(groups[1].rows[1]).open, true)
  assert.equal(action(groups[1].rows[0]).target.terminalKey, b.key)
})

test('live terminal search matches title, provider and working folder', () => {
  assert.equal(action(buildGroups({ ...args, q: 'Second' })[0].rows[0]).target.terminalKey, b.key)
  assert.equal(buildGroups({ ...args, q: 'same' })[0].rows.length, 2)
  assert.equal(buildGroups({ ...args, q: 'codex' })[0].rows.length, 2)
})

test('saved live sessions are not repeated in recent sessions', () => {
  const saved = { ...a, id: 'saved', slug: a.cwd }
  const groups = buildGroups({ ...args, terminals: [saved], recent: [saved] })
  assert.equal(
    groups.some((g) => g.title === 'Recent sessions'),
    false
  )
})

const questionSession = mockNavSession({
  provider: 'codex',
  root: 'r',
  slug: '/work/api',
  id: 's1',
  title: 'API project',
  firstPrompt: 'Build a server',
  lastUserPrompt: '請加上登入測試',
  lastTs: '2026-09-01T12:00:00Z',
})

test('project search finds the latest question without an English preview label', () => {
  const groups = buildGroups({
    ...args,
    q: '登入',
    terminals: [],
    level: { provider: 'codex', root: 'r', slug: '/work/api', name: 'api' },
    index: { ...args.index, sessionsFor: () => [questionSession] },
  })
  const row = action(groups.flatMap((g) => g.rows).find((r) => r.kind === 'session'))
  assert.equal(row.target.id, questionSession.id)
  assert.equal(row.secondary, questionSession.lastUserPrompt)
  assert.equal('secondaryLabel' in row ? row.secondaryLabel : undefined, undefined)
  assert.deepEqual(row.secondaryHits, [3, 4])
})

test('global search can find a latest question in cached sessions without a matching project name', () => {
  const groups = buildGroups({ ...args, q: '登入', terminals: [], index: { ...args.index, cachedSessions: () => [questionSession] } })
  const rows = groups.flatMap((g) => g.rows).filter((r) => r.kind === 'session')
  assert.equal(rows.length, 1)
  assert.equal(action(rows[0]).target.id, questionSession.id)
})

test('hidden previews remain searchable and never fall back to the opening question', () => {
  const search = (options: Partial<Parameters<typeof buildGroups>[0]>) =>
    buildGroups({ ...args, q: 'Build', terminals: [], index: { ...args.index, cachedSessions: () => [questionSession] }, ...options })
      .flatMap((g) => g.rows)
      .find((r) => r.kind === 'session')
  const openingMatch = action(search({ showLatestPrompt: true }))
  assert.equal(openingMatch.secondary, questionSession.lastUserPrompt)
  assert.equal(openingMatch.secondaryHits, undefined)
  const hidden = action(search({ q: '登入', showLatestPrompt: false }))
  assert.equal(hidden.target.id, questionSession.id)
  assert.equal(hidden.secondary, '')
  assert.equal('secondaryLabel' in hidden ? hidden.secondaryLabel : undefined, undefined)
  assert.equal(hidden.secondaryHits, undefined)
})

const folder: Folder = {
  id: 'shared-folder',
  cwd: '/work/shared',
  name: 'shared',
  resolved: true,
  sessionCount: 5,
  sources: [
    { provider: 'claude', root: 'c', rootLabel: 'Claude work', slug: 'claude-slug', cwd: '/work/shared', sessionCount: 2 },
    { provider: 'codex', root: 'r', rootLabel: 'Codex work', slug: 'codex-slug', cwd: '/work/shared', sessionCount: 3 },
  ],
}
const folderArgs: Parameters<typeof buildGroups>[0] = {
  ...args,
  terminals: [],
  sidebarMode: 'folder',
  folders: [folder],
  providers: [mockProvider('claude', 'Claude'), mockProvider('codex', 'Codex')],
}
const allRows = (options: Parameters<typeof buildGroups>[0]) => buildGroups(options).flatMap((group) => group.rows)

test('Home is available without projects and is searchable without producing an empty-result message', () => {
  for (const sidebarMode of ['source', 'folder']) {
    const options = { ...args, terminals: [], sidebarMode }
    for (const q of ['', 'h', 'ho', 'Home']) {
      const rows = allRows({ ...options, q })
      const home = action(rows.find((row) => row.kind === 'home'))
      assert.deepEqual(home.target, { provider: null, view: 'activity' })
      assert.equal(pinTargetOf(home), null)
      assert.ok(!rows.some((row) => 'text' in row && row.text === 'Nothing matches'))
    }
    assert.ok(!allRows({ ...options, q: 'unmatched' }).some((row) => row.kind === 'home'))
    for (const q of ['o', 'm', 'e']) assert.ok(!allRows({ ...options, q }).some((row) => row.kind === 'home'))
  }
  const competing = buildGroups({ ...args, q: 'h', terminals: [{ ...a, title: 'h' }] })
  assert.equal(competing[0].title, 'Navigation', 'Home is an explicit prefix command ahead of data search matches')
  assert.equal(action(competing[0].rows[0]).kind, 'home')
  assert.equal(action(competing[1].rows[0]).primary, 'h', 'an exact live match remains reachable after the Home command')
})

test('Folder mode merges source projects by catalog identity while Source mode retains both source projects', () => {
  const projects: NavProject[] = folder.sources.map((source) => ({
    ...source,
    slug: source.slug || '',
    cwd: source.cwd || '',
    name: 'shared',
    path: '/work/shared',
    providerLabel: source.provider,
    lastActivity: 0,
    exists: true,
    probe: null,
  }))
  const options = { ...folderArgs, index: mockNavIndex({ projects }) }
  const sources = allRows({ ...options, sidebarMode: 'source' }).filter((row) => row.kind === 'project')
  assert.equal(sources.length, 2)
  assert.notEqual(action(sources[0]).key, action(sources[1]).key)
  const folders = allRows(options).filter((row) => row.kind === 'folder-project')
  assert.equal(folders.length, 1)
  assert.equal(action(folders[0]).count, 5)
  assert.equal(action(folders[0]).context, 'Claude · Codex')
  assert.equal(action(folders[0]).target.sources?.length, 2)
  const folderRow = action(folders[0])
  assert.deepEqual(pinTargetOf({ ...folderRow, target: { ...folderRow.target, name: '' } }), {
    kind: 'folder',
    folderId: folder.id,
    cwd: folder.cwd,
    name: folder.cwd,
  })
  assert.equal(pinTargetOf({ ...folderRow, target: { ...folderRow.target, cwd: null } }), null)
  assert.equal(allRows(options).filter((row) => row.kind === 'project').length, 0)
  const sameName = {
    ...folder,
    id: 'different-folder',
    cwd: '/other/shared',
    sources: folder.sources.map((source) => ({ ...source, slug: source.slug + '-other', cwd: '/other/shared' })),
  }
  const distinct = allRows({ ...options, folders: [folder, sameName] }).filter((row) => row.kind === 'folder-project')
  assert.equal(new Set(distinct.map((row) => row.key)).size, 2, 'same basename must not merge different folder identities')
})

test('Folder mode uses the sidebar filters, exposes loading and searches folder paths and providers', () => {
  const filtered = { ...folderArgs, folderFilter: { excludedProviders: ['claude'] } }
  const row = action(allRows(filtered).find((row) => row.kind === 'folder-project'))
  assert.equal(row.count, 3)
  assert.deepEqual(
    row.target.sources?.map((source) => source.provider),
    ['codex']
  )
  assert.equal(allRows({ ...filtered, q: 'Claude' }).filter((row) => row.kind === 'folder-project').length, 0)
  assert.equal(allRows({ ...filtered, q: '/work/shared' }).filter((row) => row.kind === 'folder-project').length, 1)
  assert.ok(allRows({ ...folderArgs, folders: [], foldersLoading: true }).some((row) => 'text' in row && row.text === 'Loading folders…'))
  assert.equal(allRows({ ...folderArgs, folders: [{ ...folder, resolved: false }] }).filter((row) => row.kind === 'folder-project').length, 0)
  assert.equal(
    allRows({ ...folderArgs, folders: [{ ...folder, resolved: false }], folderFilter: { showUnavailable: true } }).filter(
      (row) => row.kind === 'folder-project'
    ).length,
    1
  )
})

test('folder drill-down keeps same-ID sessions from different sources distinct and offers explicit creation sources', () => {
  const calls: string[][] = []
  const index = mockNavIndex({
    sessionsFor: (provider, root, slug) => {
      calls.push([provider, root, slug])
      return [mockNavSession({ provider, root, slug, id: 'same-id', lastTs: provider === 'codex' ? '2026-09-10T12:00:00Z' : '2026-09-09T12:00:00Z' })]
    },
  })
  const level = action(allRows(folderArgs).find((row) => row.kind === 'folder-project')).target
  const rows = allRows({ ...folderArgs, index, level })
  assert.deepEqual(calls, [
    ['claude', 'c', 'claude-slug'],
    ['codex', 'r', 'codex-slug'],
  ])
  const sessions = rows.filter((row) => row.kind === 'session').map(action)
  assert.deepEqual(
    sessions.map((row) => row.target.provider),
    ['codex', 'claude']
  )
  assert.equal(new Set(sessions.map((row) => row.key)).size, 2)
  const drafts = rows.filter((row) => row.kind === 'new').map(action)
  assert.deepEqual(
    drafts.map((row) => row.target.provider),
    ['claude', 'codex']
  )
  assert.ok(drafts.every((row) => row.target.cwd === '/work/shared'))
  assert.equal(rows.filter((row) => row.kind === 'home').length, 0)
  calls.length = 0
  const filtered = allRows({ ...folderArgs, index, level, folderFilter: { excludedProviders: ['claude'] } })
  assert.deepEqual(calls, [['codex', 'r', 'codex-slug']], 'filter changes must not retain the stale source list from the opened row')
  assert.equal(filtered.filter((row) => row.kind === 'new').length, 1)
  assert.ok(buildGroups({ ...folderArgs, index, level, folderFilter: { excludedProviders: ['claude'] } }).some((group) => group.title === 'shared · 1 source'))
})

test('pinned folders stay non-actionable until the catalog resolves their current members', () => {
  for (const q of ['', 'shared']) {
    const options = { ...folderArgs, q, pins: [{ kind: 'folder', folderId: folder.id, cwd: folder.cwd }] }
    const pending = allRows({ ...options, folders: [], foldersLoading: true, pinnedFolders: [] })
    assert.ok(pending.some((row) => row.kind === 'loading' && row.text === 'Loading pinned folder…'))
    assert.ok(!pending.some((row) => row.kind === 'folder' || row.kind === 'folder-project'))
    const ready = allRows({ ...options, foldersLoading: false, pinnedFolders: [folder] })
    assert.equal(ready.filter((row) => row.kind === 'folder-project').length, 1)
    assert.equal(action(ready.find((row) => row.kind === 'folder-project')).target.sources?.length, 2)
  }
})

test('folder catalog loading and failure remain visible alongside global live and recent rows', () => {
  const options = { ...folderArgs, folders: [], terminals: [a, b], recent: [questionSession] }
  for (const q of ['', 'Second', 'no-match']) {
    const failed = allRows({ ...options, q, foldersError: 'Fixture catalog unavailable' })
    assert.equal(failed.filter((row) => row.kind === 'empty' && row.text === 'Fixture catalog unavailable').length, 1)
    assert.ok(!failed.some((row) => row.kind === 'empty' && row.text === 'Nothing matches'))
    const pending = allRows({ ...options, q, foldersLoading: true })
    assert.ok(pending.some((row) => row.kind === 'loading' && row.text === 'Loading folders…'))
    if (!q) {
      assert.equal(failed.filter((row) => row.kind === 'terminal').length, 2)
      assert.equal(failed.filter((row) => row.kind === 'session').length, 1)
    }
  }
})

test('folder drill-down renders loaded members while others load and does not duplicate live or pinned rows', () => {
  const level = action(allRows(folderArgs).find((row) => row.kind === 'folder-project')).target
  const saved = { ...a, root: 'r', slug: 'codex-slug', cwd: '/work/shared', id: 'live' }
  const rows = allRows({
    ...folderArgs,
    level,
    terminals: [saved],
    index: mockNavIndex({
      sessionsFor: (provider, root, slug) =>
        provider === 'claude' ? null : [mockNavSession({ provider, root, slug, id: 'live' }), mockNavSession({ provider, root, slug, id: 'other' })],
    }),
  })
  assert.equal(rows.filter((row) => row.kind === 'terminal').length, 1)
  assert.equal(rows.filter((row) => row.kind === 'loading').length, 1)
  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => action(row).target.id),
    ['other']
  )
  for (const q of ['', 'shared']) {
    const pinned = allRows({ ...folderArgs, q, pins: [{ kind: 'folder', folderId: folder.id, cwd: folder.cwd }], pinnedFolders: [folder] })
    assert.equal(pinned.filter((row) => row.kind === 'folder-project').length, 1)
  }
})

test('folder filters do not hide global live, pinned or recent navigation outside the visible catalog', () => {
  const pin = { provider: 'claude', root: 'hidden', slug: 'old-project', id: 'pinned', title: 'Pinned outside catalog' }
  const recent = mockNavSession({ provider: 'claude', root: 'hidden', slug: 'old-project', id: 'recent', title: 'Recent outside catalog' })
  const options = {
    ...folderArgs,
    folderFilter: { excludedProviders: ['claude'], excludedRoots: ['hidden'] },
    folders: [],
    terminals: [a, b],
    pins: [pin],
    recent: [recent],
    index: mockNavIndex({ cachedSessions: () => [recent] }),
  }
  const rows = allRows(options)
  assert.equal(rows.filter((row) => row.kind === 'terminal').length, 2)
  assert.deepEqual(
    rows.filter((row) => row.kind === 'session').map((row) => action(row).target.id),
    ['pinned', 'recent']
  )
  assert.equal(rows.filter((row) => row.kind === 'folder-project').length, 0)
  assert.equal(allRows({ ...options, q: 'Second' }).filter((row) => row.kind === 'terminal').length, 1)
  assert.equal(action(allRows({ ...options, q: 'Recent' }).find((row) => row.kind === 'session')).target.id, 'recent')
})
