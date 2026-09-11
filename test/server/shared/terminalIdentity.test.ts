import test from 'node:test'
import assert from 'node:assert/strict'
import { findTerminal, terminalIdentity } from '../../../server/shared/terminalIdentity.ts'

test('terminal lookup requires a usable key and exact provider/root scope', () => {
  const launchId = '01234567-1234-4321-8765-012345678901'
  const entries: { provider: string; root: string; launchId: string | null; key?: string }[] = [
    { provider: 'future', root: 'r', launchId },
    { provider: 'future', root: 'r', launchId, key: '' },
    { provider: 'other', root: 'r', launchId, key: 'wrong-provider' },
    { provider: 'future', root: 'other', launchId, key: 'wrong-root' },
  ]
  assert.equal(findTerminal(entries, 'future', 'r', { launchId }), undefined)
  const identity = terminalIdentity('future', 'r', { launchId })
  const valid = { provider: 'future', root: 'r', ...identity }
  entries.push(valid)
  assert.equal(findTerminal(entries, 'future', 'r', { launchId }), valid)
  assert.equal(findTerminal(entries, 'future', 'r', { terminalKey: valid.key }), valid)
  assert.equal(findTerminal(entries, 'future', 'r', { terminalKey: 'missing', launchId }), undefined)
})
