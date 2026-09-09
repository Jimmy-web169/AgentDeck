import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { targetKey, liveTarget } from '../src/lib/tabs.js'

const compiled = await build({ entryPoints: ['src/components/shared/QuickSwitcher.jsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic' })
const { buildGroups } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const a = { provider: 'codex', root: 'r', cwd: '/work/same', launchId: 'a', key: 'codex|r|launch|a', title: 'First draft', startedAt: 10 }
const b = { ...a, launchId: 'b', key: 'codex|r|launch|b', title: 'Second draft', startedAt: 20 }
const args = { q: '', level: null, index: { projects: [], labelOf: () => 'account' }, recent: [], pins: [], live: { ids: new Set(), slugs: new Set() }, openTabs: new Set([targetKey(liveTarget(a))]), providers: [{ id: 'codex', label: 'Codex' }], terminals: [a, b] }

test('folder pins only appear in Folder mode, search by path, and never masquerade as provider targets', () => {
  const pin = { kind: 'folder', folderId: 'folder-a', cwd: '/work/unique-project', name: 'unique-project' }
  const options = { ...args, terminals: [], pins: [pin] }
  assert.ok(!buildGroups(options).some((g) => g.title === 'Pinned'))
  for (const q of ['', 'unique-project']) {
    const groups = buildGroups({ ...options, sidebarMode: 'folder', q })
    const row = groups.flatMap((g) => g.rows).find((r) => r.kind === 'folder')
    assert.equal(row.target, pin)
    assert.equal(row.primary, 'work/unique-project')
    assert.equal(row.target.provider, undefined)
    assert.equal(row.context, 'Show in sidebar')
    assert.ok(!groups.some((g) => g.rows.some((r) => r.text === 'Nothing matches')))
  }
})

test('new-tab picker lists idle live drafts without transcripts or recent history', () => {
  const groups = buildGroups(args)
  assert.equal(groups[0].title, 'Live sessions')
  assert.deepEqual(groups[0].rows.map((r) => r.primary), ['Second draft', 'First draft'])
  assert.equal(groups[0].rows[1].open, true)
  assert.equal(groups[0].rows[0].target.terminalKey, b.key)
})

test('live terminal search matches title, provider and working folder', () => {
  assert.equal(buildGroups({ ...args, q: 'Second' })[0].rows[0].target.terminalKey, b.key)
  assert.equal(buildGroups({ ...args, q: 'same' })[0].rows.length, 2)
  assert.equal(buildGroups({ ...args, q: 'codex' })[0].rows.length, 2)
})

test('saved live sessions are not repeated in recent sessions', () => {
  const saved = { ...a, id: 'saved', slug: a.cwd }
  const groups = buildGroups({ ...args, terminals: [saved], recent: [saved] })
  assert.equal(groups.some((g) => g.title === 'Recent sessions'), false)
})

const questionSession = { provider: 'codex', root: 'r', slug: '/work/api', id: 's1', title: 'API project', firstPrompt: 'Build a server', lastUserPrompt: '請加上登入測試', lastTs: '2026-09-01T12:00:00Z' }

test('project search finds the latest question without an English preview label', () => {
  const groups = buildGroups({ ...args, q: '登入', terminals: [],
    level: { provider: 'codex', root: 'r', slug: '/work/api', name: 'api' },
    index: { ...args.index, sessionsFor: () => [questionSession] } })
  const row = groups.flatMap((g) => g.rows).find((r) => r.kind === 'session')
  assert.equal(row.target.id, questionSession.id)
  assert.equal(row.secondary, questionSession.lastUserPrompt)
  assert.equal(row.secondaryLabel, undefined)
  assert.deepEqual(row.secondaryHits, [3, 4])
})

test('global search can find a latest question in cached sessions without a matching project name', () => {
  const groups = buildGroups({ ...args, q: '登入', terminals: [],
    index: { ...args.index, cachedSessions: () => [questionSession] } })
  const rows = groups.flatMap((g) => g.rows).filter((r) => r.kind === 'session')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].target.id, questionSession.id)
})

test('hidden previews remain searchable and never fall back to the opening question', () => {
  const search = (options) => buildGroups({ ...args, q: 'Build', terminals: [],
    index: { ...args.index, cachedSessions: () => [questionSession] }, ...options })
    .flatMap((g) => g.rows).find((r) => r.kind === 'session')
  const openingMatch = search({ showLatestPrompt: true })
  assert.equal(openingMatch.secondary, questionSession.lastUserPrompt)
  assert.equal(openingMatch.secondaryHits, undefined)
  const hidden = search({ q: '登入', showLatestPrompt: false })
  assert.equal(hidden.target.id, questionSession.id)
  assert.equal(hidden.secondary, '')
  assert.equal(hidden.secondaryLabel, undefined)
  assert.equal(hidden.secondaryHits, undefined)
})
