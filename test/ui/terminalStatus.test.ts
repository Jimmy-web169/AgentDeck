import { required } from '../helpers/assert.ts'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { terminalStatus, canRepairConversation } from '../../src/lib/terminalStatus.ts'

test('connection and transcript states are separate, with actionable long-wait copy', () => {
  // Exercise every boolean state, including copy branches the component's
  // delayed-repair scenario does not visit. Inspect values, not source text.
  for (let mask = 0; mask < 128; mask++) {
    const flags = Object.fromEntries(
      ['loading', 'reconnecting', 'running', 'frameLoaded', 'id', 'transcriptReady', 'delayed'].map((key, bit) => [key, !!(mask & (1 << bit))])
    )
    assert.doesNotMatch(terminalStatus(flags) || '', /\p{Script=Han}/u)
  }
  assert.equal(terminalStatus({ loading: true, reconnecting: true }), 'Reconnecting to terminal…')
  assert.equal(terminalStatus({ loading: true }), 'Starting terminal…')
  assert.equal(terminalStatus({ running: false }), null)
  assert.match(required(terminalStatus({ running: true })), /Opening terminal view/)
  assert.match(required(terminalStatus({ running: true, delayed: true })), /reload it or pop it out/)
  assert.match(required(terminalStatus({ running: true, frameLoaded: true })), /waiting for its conversation record/)
  assert.match(required(terminalStatus({ running: true, frameLoaded: true, delayed: true })), /Conversation record not detected yet/)
  assert.match(required(terminalStatus({ running: true, frameLoaded: true, id: 's', delayed: true })), /keep using the terminal/)
  assert.match(required(terminalStatus({ running: true, frameLoaded: true, id: 's', transcriptReady: true })), /synced/)
})

test('repair is offered only after an unidentified loaded terminal has waited', () => {
  const ready = { running: true, frameLoaded: true, delayed: true, repair: true }
  assert.equal(canRepairConversation(ready), true)
  for (const change of [{ loading: true }, { running: false }, { frameLoaded: false }, { id: 'identified' }, { delayed: false }, { repair: null }]) {
    assert.equal(canRepairConversation({ ...ready, ...change }), false)
  }
})
