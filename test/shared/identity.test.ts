import assert from 'node:assert/strict'
import test from 'node:test'
import * as identity from '../../shared/identity.ts'

test('query identity readers match constructor scope without confusing inventory names with root IDs', () => {
  const ref = { provider: 'claude', root: 'active-sessions', slug: 'project', id: 'one' }
  assert.deepEqual(identity.queryIdentity(identity.queryKeys.session(ref)), {
    owner: 'provider',
    provider: 'claude',
    kind: 'session',
    inventory: false,
    root: ref.root,
    slug: 'project',
    id: 'one',
    scope: undefined,
  })
  assert.equal(identity.isProviderInventoryKey(identity.queryKeys.session(ref), 'active-sessions'), false)
  assert.equal(identity.isProviderInventoryKey(identity.queryKeys.activeSessions('claude'), 'active-sessions'), true)
  assert.equal(identity.queryIdentity(identity.queryKeys.projects({ ...ref, root: 'browse' }))?.kind, 'projects')
  assert.equal(identity.queryIdentity(identity.queryKeys.browse('claude', '/fixture'))?.owner, 'filesystem')
  assert.equal(identity.queryIdentity(identity.queryKeys.resources({ ...ref, scope: 'user' }))?.scope, 'user')
  assert.deepEqual(identity.queryIdentity(identity.queryKeys.home('stats', { excluded: ['codex'] }))?.scope, { excluded: ['codex'] })
  assert.equal(identity.queryIdentity(['unrelated']), null)
})
import {
  targetKey,
  terminalKey,
  sessionKey,
  sourceKey,
  projectSessionKey,
  folderItemKey,
  homeSourceKey,
  legacyDraftKey,
  changeBatchKey,
  queryKeys,
} from '../../shared/identity.ts'

test('identity retains established scope, session, pin, folder and transient bytes', () => {
  const ref = { provider: 'codex', root: 'account:two', slug: '/a|b', id: 'session:one' }
  assert.equal(sourceKey(ref.provider, ref.root), 'codex|account:two')
  assert.equal(sessionKey(ref.provider, ref.root, ref.id), 'codex|account:two|session:one')
  assert.equal(projectSessionKey(ref), 'codex|account:two|/a|b|session:one')
  assert.equal(folderItemKey('folder|1'), '["folder","folder|1"]')
  assert.equal(homeSourceKey(ref), '["codex","account:two"]')
  assert.equal(legacyDraftKey(ref.root, ref.slug), 'account:two|new|/a|b')
  assert.equal(changeBatchKey(ref), 'codex:account:two:session:one')
  assert.equal(changeBatchKey({ provider: 'codex', root: 'r', id: null }), 'codex:r:')
})

test('target identity preserves precedence and concurrent same-folder launches', () => {
  const scope = { provider: 'claude', root: 'r', cwd: '/same', slug: 'slug' }
  const cases: [Parameters<typeof targetKey>[0], string][] = [
    [null, ''],
    [{ view: 'stats' }, ''],
    [{ kind: 'dashboard', dashboardId: 'd' }, 'dashboard|d'],
    [scope, 'claude|r|project|/same'],
    [{ ...scope, draft: true }, 'claude|r|draft|/same'],
    [{ ...scope, launchId: 'a' }, 'claude|r|launch|a'],
    [{ ...scope, launchId: 'a', terminalKey: 'old|key' }, 'claude|r|terminal|old|key'],
    [{ ...scope, launchId: 'a', terminalKey: 'old|key', id: 's' }, 'claude|r|session|s'],
  ]
  for (const [target, expected] of cases) assert.equal(targetKey(target), expected)
  assert.notEqual(targetKey({ ...scope, launchId: 'a' }), targetKey({ ...scope, launchId: 'b' }))
  assert.equal(terminalKey('claude', 'r', { id: 's', launchId: 'a' }), 'claude|r|session|s')
  assert.equal(terminalKey('claude', 'r', { launchId: 'a' }), 'claude|r|launch|a')
})

test('query identities retain account and native addressing boundaries', () => {
  const ref = { provider: 'codex', root: 'r', slug: '/project', id: 's' }
  assert.deepEqual(queryKeys.session(ref), ['provider', 'codex', 'r', 'session', '/project', 's'])
  assert.notDeepEqual(queryKeys.session(ref), queryKeys.session({ ...ref, root: 'other' }))
  assert.notDeepEqual(queryKeys.sessions(ref), queryKeys.projects(ref))
})

test('legacy terminal, navigation and UI keys retain unescaped persisted bytes', () => {
  const cases = [
    [() => identity.colonProjectKey({ provider: 'p', root: 'r:2', slug: 's' }), 'p:r:2:s', identity.colonProjectKey.name] as const,
    [() => identity.colonProjectKey({ provider: 'p', root: 'r' }), 'p:r:undefined', identity.colonProjectKey.name] as const,
    [() => identity.legacySessionKey('r|a', 's'), 'r|a|s', identity.legacySessionKey.name] as const,
    [() => identity.legacyProjectKey('r', '/工作'), 'r|/工作', identity.legacyProjectKey.name] as const,
    [() => identity.legacyProjectSessionKey('r', '/a|b', 's'), 'r|/a|b|s', identity.legacyProjectSessionKey.name] as const,
    [
      () => identity.pendingOpenSignature({ root: 'r', slug: '/p', id: 's', view: 'terminal', seq: 2 }),
      'r|/p|s|terminal|2',
      identity.pendingOpenSignature.name,
    ] as const,
    [() => identity.pendingOpenSignature({ root: 'r', seq: 0 }), 'r|undefined|||', identity.pendingOpenSignature.name] as const,
    [() => identity.conversationBoundaryKey('r', 's'), 'conv|r|s', identity.conversationBoundaryKey.name] as const,
    [() => identity.conversationBoundaryKey('r', 's', ''), 'conv|r||s', identity.conversationBoundaryKey.name] as const,
    [() => identity.conversationBoundaryKey('r', 's', '/p'), 'conv|r|/p|s', identity.conversationBoundaryKey.name] as const,
    [() => identity.viewBoundaryKey('history'), 'view|history', identity.viewBoundaryKey.name] as const,
    [
      () => identity.claudeSubagentKey({ root: 'r', slug: '/p', id: 's' }, { runId: 'run', agentId: 'agent' }),
      'claude|r|/p|s|run|agent',
      identity.claudeSubagentKey.name,
    ] as const,
    [() => identity.claudeSubagentKey({ root: 'r', slug: '/p', id: 's' }, {}), 'claude|r|/p|s||', identity.claudeSubagentKey.name] as const,
    [() => identity.sidebarItemKey('ws|w|g', 'all'), 'ws|w|g|all', identity.sidebarItemKey.name] as const,
    [() => identity.sidebarFolderKey('folder-project', 'pinned', 'folder|1'), 'folder-project|pinned|folder|1', identity.sidebarFolderKey.name] as const,
    [() => identity.insightProjectKey('slug', '/cwd'), 'slug|/cwd', identity.insightProjectKey.name] as const,
    [() => identity.homeViewKey('stats', '["codex","r"]'), 'stats|["codex","r"]', identity.homeViewKey.name] as const,
    [() => identity.quickSessionKey({ provider: 'codex', root: 'r', id: 's' }), 's|codex|r|session|s', identity.quickSessionKey.name] as const,
    [() => identity.handoffNonceInput('key|a', 100, 0.5), 'key|a|100|0.5', identity.handoffNonceInput.name] as const,
  ]
  for (const [run, expected, name] of cases) assert.equal(run(), expected, name)
})

test('JSON identities preserve native tuple bytes, missing values and folder namespaces', () => {
  const source = { provider: 'future', root: '工作|r', slug: 'project"x' }
  const cases = [
    [() => identity.homeProjectKey(source), '["future","工作|r","project\\"x"]', identity.homeProjectKey.name] as const,
    [() => identity.homeProjectKey({ ...source, slug: undefined }), '["future","工作|r",null]', identity.homeProjectKey.name] as const,
    [() => identity.homeProjectKey({ ...source, slug: '' }), '["future","工作|r",""]', identity.homeProjectKey.name] as const,
    [() => identity.homeRecordKey(source, 0), '["future","工作|r",0]', identity.homeRecordKey.name] as const,
    [
      () => identity.homeReportCacheKey('/base', null, ['p'], ['["p","r"]'], 'search'),
      '["/base",null,["p"],["[\\"p\\",\\"r\\"]"],"search"]',
      identity.homeReportCacheKey.name,
    ] as const,
    [() => identity.resourceEntryKey(source, 'user', undefined), '["future","工作|r","user",null]', identity.resourceEntryKey.name] as const,
    [() => identity.folderNodeKey('f'), '["folder","f"]', identity.folderNodeKey.name] as const,
    [() => identity.folderNodeKey('f', '', 'r'), '["folder","f","provider","","root","r"]', identity.folderNodeKey.name] as const,
    [() => identity.folderNodeKey('f', null, 'r'), '["folder","f","root","r"]', identity.folderNodeKey.name] as const,
    [() => identity.draftFolderKey({ ...source, cwd: '/cwd' }), 'draft:["future","工作|r","/cwd"]', identity.draftFolderKey.name] as const,
    [() => identity.folderProjectItemKey('f', { ...source, slug: null }), '["f","future","工作|r",null]', identity.folderProjectItemKey.name] as const,
    [() => identity.folderMenuKey('pinned', undefined, 'f'), '["folder-menu","pinned",null,"f"]', identity.folderMenuKey.name] as const,
    [() => identity.folderSourceActionKey('root', undefined), '["root",null]', identity.folderSourceActionKey.name] as const,
    [() => identity.historySourceKey({ id: 's', agent: '', group: 'g' }), '["s",null,"g"]', identity.historySourceKey.name] as const,
    [() => identity.tmuxSourceKey({ socket: '/sock', sessionId: '$1' }), '["/sock","$1"]', identity.tmuxSourceKey.name] as const,
  ]
  for (const [run, expected, name] of cases) assert.equal(run(), expected, name)
  assert.notEqual(identity.homeProjectKey(source), identity.projectKey(source))
})
