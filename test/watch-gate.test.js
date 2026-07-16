import test from 'node:test'
import assert from 'node:assert/strict'
import { registerWatchControl, withWatchersPaused, restartWatchers, _resetWatchGateForTests } from '../server/shared/watchGate.js'

const tick = () => new Promise((r) => setImmediate(r))

function makeControl() {
  const log = []
  let releaseStop
  const stopGate = new Promise((r) => (releaseStop = r))
  registerWatchControl(
    async () => {
      log.push('stop')
      await stopGate
    },
    async () => log.push('start'),
    () => log.push('notify')
  )
  return { log, releaseStop }
}

test('runs the fn even when no watcher control is registered', async () => {
  _resetWatchGateForTests()
  const out = await withWatchersPaused(async () => 'ok')
  assert.equal(out, 'ok')
})

test('single pause: stop, fn, start, notify in order', async () => {
  _resetWatchGateForTests()
  const { log, releaseStop } = makeControl()
  releaseStop()
  await withWatchersPaused(async () => log.push('fn'))
  assert.deepEqual(log, ['stop', 'fn', 'start', 'notify'])
})

test('concurrent pauses share one stop and restart only after the last leaves', async () => {
  _resetWatchGateForTests()
  const { log, releaseStop } = makeControl()
  let releaseA, releaseB
  const a = withWatchersPaused(async () => {
    log.push('a')
    await new Promise((r) => (releaseA = r))
  })
  const b = withWatchersPaused(async () => {
    log.push('b')
    await new Promise((r) => (releaseB = r))
  })
  await tick()
  // both callers are blocked on the same in-flight stop
  assert.deepEqual(log, ['stop'])
  releaseStop()
  await tick()
  assert.deepEqual(log, ['stop', 'a', 'b'])
  releaseA()
  await tick()
  // first caller left, second still holds the pause: no restart yet
  assert.ok(!log.includes('start'))
  releaseB()
  await Promise.all([a, b])
  assert.deepEqual(log, ['stop', 'a', 'b', 'start', 'notify'])
  // exactly one stop and one start for the whole window
  assert.equal(log.filter((x) => x === 'stop').length, 1)
  assert.equal(log.filter((x) => x === 'start').length, 1)
})

test('a caller arriving while stop is in flight awaits that same stop', async () => {
  _resetWatchGateForTests()
  const { log, releaseStop } = makeControl()
  const a = withWatchersPaused(async () => log.push('a'))
  await tick()
  const b = withWatchersPaused(async () => log.push('b'))
  await tick()
  assert.deepEqual(log, ['stop']) // neither fn ran before stop settled
  releaseStop()
  await Promise.all([a, b])
  assert.deepEqual(log, ['stop', 'a', 'b', 'start', 'notify'])
})

test('restart requested mid-pause is deferred; resume covers it', async () => {
  _resetWatchGateForTests()
  const { log, releaseStop } = makeControl()
  releaseStop()
  const p = withWatchersPaused(async () => {
    await restartWatchers() // mid-pause: must not start a generation now
    log.push('fn')
  })
  await p
  assert.deepEqual(log, ['stop', 'fn', 'start', 'notify'])
})

test('restart outside a pause starts immediately', async () => {
  _resetWatchGateForTests()
  const { log } = makeControl()
  await restartWatchers()
  assert.deepEqual(log, ['start'])
})

test('watchers restart even when the paused fn throws', async () => {
  _resetWatchGateForTests()
  const { log, releaseStop } = makeControl()
  releaseStop()
  await assert.rejects(
    withWatchersPaused(async () => {
      throw new Error('boom')
    }),
    /boom/
  )
  assert.deepEqual(log, ['stop', 'start', 'notify'])
})
