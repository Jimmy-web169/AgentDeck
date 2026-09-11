import { test, expect } from 'vitest'
import { queryKeys as qk, matchesChange, coalesceChanges } from '../../../src/api/queryPolicy.ts'

test('query invalidation separates accounts and providers and refreshes a child’s parent', () => {
  const child = { provider: 'codex', root: 'a', slug: 'child-folder', id: 'child', parentId: 'parent' }
  const parent = { ...child, slug: 'parent-folder', id: 'parent' }
  expect(matchesChange(qk.session(parent), child)).toBe(true)
  expect(matchesChange(qk.subagents(parent), child)).toBe(true)
  expect(matchesChange(qk.raw({ ...child, id: 'unrelated' }), child)).toBe(false)
  expect(matchesChange(qk.session({ ...child, root: 'b' }), child)).toBe(false)
  expect(matchesChange(qk.session({ ...child, provider: 'claude' }), child)).toBe(false)
  expect(matchesChange(qk.roots('codex'), child)).toBe(true)
  expect(matchesChange(qk.terminals('claude'), child)).toBe(false)
  expect(matchesChange(qk.activeSessions('claude'), child)).toBe(true)
  expect(matchesChange(qk.sessions({ ...child, slug: 'another-folder' }), child)).toBe(false)
})

test('Home query cache identity canonicalizes exclusions and SSE respects excluded sources', () => {
  const change = { provider: 'codex', root: 'a' }
  expect(qk.home('stats', { excluded: ['claude', 'claude', 'codex'] })).toEqual(qk.home('stats', { excluded: ['codex', 'claude'] }))
  expect(matchesChange(qk.home('stats', { excluded: ['codex'] }), change)).toBe(false)
  expect(matchesChange(qk.home('stats', { excludedRoots: ['["codex","a"]'] }), change)).toBe(false)
  expect(matchesChange(qk.home('stats', { excludedRoots: ['["codex","b"]'] }), change)).toBe(true)
  expect(matchesChange(qk.folderCatalog(), change)).toBe(true)
  expect(
    coalesceChanges([
      { ...change, id: 'one', at: 1 },
      { ...change, id: 'two' },
      { ...change, id: 'one', at: 2 },
    ])
  ).toEqual([
    { ...change, id: 'one', at: 2 },
    { ...change, id: 'two' },
  ])
})
