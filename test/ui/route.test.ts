import assert from 'node:assert/strict'
import { expect, test, vi } from 'vitest'
import {
  currentHash,
  replaceHash,
  fromHash,
  toHash,
  toPopoutHash,
  fromPopoutHash,
  isPopoutHash,
  popoutWindowName,
  focusMainWindow,
} from '../../src/lib/route.ts'
import { newDraft, sameTarget } from '../../src/lib/tabs.ts'

const scope = { provider: 'codex', root: 'account-a', cwd: '/work/project' }

test('route adapter round-trips Home scope and replaces browser history only when needed', () => {
  const target = { provider: null, view: 'resources', homeScope: { excluded: ['codex'] }, homeSource: { provider: 'claude', root: 'work' } }
  assert.deepEqual(fromHash(toHash(target)), target)
  assert.equal(toHash({ kind: 'folder', folderId: 'a', title: 'Project' }), '#/')
  assert.deepEqual(fromHash('#/folder/a'), { provider: null, view: 'activity' })
  const dashboard = { kind: 'dashboard', dashboardId: 'a' }
  assert.deepEqual(fromHash(toHash(dashboard)), dashboard)
  assert.equal(sameTarget({ kind: 'dashboard', dashboardId: 'd' }, fromHash(toHash({ kind: 'dashboard', dashboardId: 'd' }))), true)
  const previous = { location: globalThis.location, history: globalThis.history }
  const calls: unknown[] = []
  try {
    Reflect.deleteProperty(globalThis, 'location')
    Reflect.deleteProperty(globalThis, 'history')
    assert.equal(currentHash(), '')
    replaceHash('#ignored-without-browser')
    vi.stubGlobal('location', { hash: '#old' })
    vi.stubGlobal('history', { replaceState: (...args: unknown[]) => calls.push(args) })
    assert.equal(currentHash(), '#old')
    replaceHash('#old')
    assert.equal(calls.length, 0)
    replaceHash('#new')
    assert.deepEqual(calls, [[null, '', '#new']])
    globalThis.history.replaceState = () => {
      throw new Error('History unavailable')
    }
    assert.doesNotThrow(() => replaceHash('#new'))
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key)
      else Reflect.set(globalThis, key, value)
    }
  }
})

test('deep links restore exact drafts and saved sessions without creating project tabs', () => {
  for (const target of [newDraft(scope), { ...newDraft(scope), terminalKey: 'codex|root|launch|key' }, { ...scope, id: 'session-a' }]) {
    const restored = fromHash(toHash(target), ['codex'])
    assert.equal(sameTarget(target, restored), true)
    assert.ok(restored)
    assert.equal(restored.cwd, scope.cwd)
  }
})

test('a popped-out terminal link names the exact terminal and finds the main window by name', () => {
  const target = {
    provider: 'claude',
    root: 'acc',
    slug: 'p',
    id: 'one',
    title: 'Fix the flaky test',
    terminalKey: 'claude|acc|session|one',
    cwd: '/home/demo/orbit-api',
  }
  const hash = toPopoutHash(target)
  expect(hash).toBe('#/popout/claude/acc/p/one?terminal=claude%7Cacc%7Csession%7Cone&title=Fix+the+flaky+test')
  expect(isPopoutHash(hash)).toBe(true)
  expect(isPopoutHash('#/claude/acc/p/one')).toBe(false)
  expect(fromPopoutHash(hash, ['claude'])).toEqual({
    provider: 'claude',
    root: 'acc',
    slug: 'p',
    id: 'one',
    terminalKey: 'claude|acc|session|one',
    title: 'Fix the flaky test',
  })
  expect(fromPopoutHash(hash, ['codex'])).toBeNull()
  expect(fromPopoutHash('#/claude/acc/p/one')).toBeNull()
  const draft = { provider: 'codex', root: 'acc', cwd: '/home/demo/harness', launchId: 'l2', terminalKey: 'codex|acc|launch|l2', draft: true }
  expect(fromPopoutHash(toPopoutHash(draft))).toEqual({
    provider: 'codex',
    root: 'acc',
    cwd: '/home/demo/harness',
    launchId: 'l2',
    terminalKey: 'codex|acc|launch|l2',
    draft: true,
  })
  expect(popoutWindowName('codex|acc|launch|l2')).toBe('agentdeck-term-codex|acc|launch|l2')
  // the main window exists: it is sent to the conversation without reloading,
  // and this tab closes itself so the browser returns to it
  const self = {} as Window
  const existing = { location: { href: 'http://localhost/#/', hash: '#/' }, focus: vi.fn(), closed: false }
  const env = () => ({
    open: vi.fn(() => existing as unknown as Window),
    self,
    close: vi.fn(),
    closed: () => true,
    navigate: vi.fn(),
    later: (run: () => void) => run(),
  })
  const ok = env()
  expect(focusMainWindow(target, ok)).toBe('main')
  expect(ok.open).toHaveBeenCalledWith('', 'agentdeck-main')
  expect(existing.location.hash).toBe('#/claude/acc/p/one?terminal=claude%7Cacc%7Csession%7Cone')
  expect(existing.location.href).toBe('http://localhost/#/')
  expect(existing.focus).toHaveBeenCalled()
  expect(ok.close).toHaveBeenCalled()
  expect(ok.navigate).not.toHaveBeenCalled()
  // a tab the browser refuses to close becomes the main window on that conversation
  const stuck = { ...env(), closed: () => false }
  expect(focusMainWindow(target, stuck)).toBe('main')
  expect(stuck.navigate).toHaveBeenCalledWith(expect.stringMatching(/#\/claude\/acc\/p\/one\?terminal=claude%7Cacc%7Csession%7Cone$/))
  // the main window was closed: the blank tab `open` made is dropped and this tab becomes the main window
  const blank = { location: { href: 'about:blank', hash: '' }, focus: vi.fn(), closed: false, close: vi.fn() }
  const gone = { ...env(), open: vi.fn(() => blank as unknown as Window) }
  expect(focusMainWindow(target, gone)).toBe('self')
  expect(blank.close).toHaveBeenCalled()
  expect(gone.close).not.toHaveBeenCalled()
  expect(gone.navigate).toHaveBeenCalledWith(expect.stringMatching(/#\/claude\/acc\/p\/one\?terminal=/))
  // the named window shows another origin: its location throws, so this tab becomes the main window
  const foreign = {
    get location(): Location {
      throw new Error('cross-origin')
    },
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
  }
  const other = { ...env(), open: vi.fn(() => foreign as unknown as Window) }
  expect(focusMainWindow(target, other)).toBe('self')
  expect(other.navigate).toHaveBeenCalled()
})
