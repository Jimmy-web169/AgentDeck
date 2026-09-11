// Original test group: watch-gate. Assertions retained during module-path migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWatchGate, runWithWatchGate, withWatchersPaused } from '../../../server/shared/watchGate.ts'

const tick = () => new Promise((r) => setImmediate(r))

function makeControl() {
  const log: string[] = []
  let releaseStop!: () => void
  const stopGate = new Promise<void>((r) => (releaseStop = r))
  const gate = createWatchGate(
    async () => {
      log.push('stop')
      await stopGate
    },
    async () => log.push('start'),
    () => log.push('notify')
  )
  return { log, releaseStop, pause: gate.pause, restart: gate.restart }
}

test('runs the fn even when no watcher control is registered', async () => {
  const messages: unknown[] = []
  const out = await createWatchGate(undefined, undefined, undefined, { warn: (message) => messages.push(message) }).pause(async () => 'ok')
  assert.equal(out, 'ok')
  assert.deepEqual(messages, ['[watchGate] no watcher control registered — running without pausing watchers'])
})

test('single pause: stop, fn, start, notify in order', async () => {
  const { log, releaseStop, pause } = makeControl()
  releaseStop()
  await pause(async () => log.push('fn'))
  assert.deepEqual(log, ['stop', 'fn', 'start', 'notify'])
})

test('concurrent pauses share one stop and restart only after the last leaves', async () => {
  const { log, releaseStop, pause } = makeControl()
  let releaseA!: () => void
  let releaseB!: () => void
  const a = pause(async () => {
    log.push('a')
    await new Promise<void>((r) => (releaseA = r))
  })
  const b = pause(async () => {
    log.push('b')
    await new Promise<void>((r) => (releaseB = r))
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
  const { log, releaseStop, pause } = makeControl()
  const a = pause(async () => log.push('a'))
  await tick()
  const b = pause(async () => log.push('b'))
  await tick()
  assert.deepEqual(log, ['stop']) // neither fn ran before stop settled
  releaseStop()
  await Promise.all([a, b])
  assert.deepEqual(log, ['stop', 'a', 'b', 'start', 'notify'])
})

test('restart requested mid-pause is deferred; resume covers it', async () => {
  const { log, releaseStop, pause, restart } = makeControl()
  releaseStop()
  const p = pause(async () => {
    await restart() // mid-pause: must not start a generation now
    log.push('fn')
  })
  await p
  assert.deepEqual(log, ['stop', 'fn', 'start', 'notify'])
})

test('restart outside a pause starts immediately', async () => {
  const { log, restart } = makeControl()
  await restart()
  assert.deepEqual(log, ['start'])
})

test('watchers restart even when the paused fn throws', async () => {
  const { log, releaseStop, pause } = makeControl()
  releaseStop()
  await assert.rejects(
    pause(async () => {
      throw new Error('boom')
    }),
    /boom/
  )
  assert.deepEqual(log, ['stop', 'start', 'notify'])
})

test('scoped gates survive awaits and restore the outer gate after nested work', async () => {
  const log: unknown[] = []
  const control = (name: string) =>
    createWatchGate(
      () => log.push(`${name}:stop`),
      () => log.push(`${name}:start`)
    )
  await runWithWatchGate(control('outer'), async () => {
    await tick()
    await runWithWatchGate(control('inner'), () => withWatchersPaused(() => log.push('inner:work')))
    await withWatchersPaused(() => log.push('outer:work'))
  })
  assert.throws(() => withWatchersPaused(() => log.push('unowned:work')), /host watch gate is required/)
  assert.deepEqual(log, ['inner:stop', 'inner:work', 'inner:start', 'outer:stop', 'outer:work', 'outer:start'])
})

test('concurrent scoped pauses share one stop and one resume', async () => {
  let release!: () => void
  const stopped = new Promise<void>((resolve) => {
    release = resolve
  })
  const log: unknown[] = []
  const gate = createWatchGate(
    async () => {
      log.push('stop')
      await stopped
    },
    () => log.push('start')
  )
  const first = runWithWatchGate(gate, () => withWatchersPaused(() => log.push('a')))
  const second = runWithWatchGate(gate, () => withWatchersPaused(() => log.push('b')))
  await tick()
  assert.deepEqual(log, ['stop'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(log, ['stop', 'a', 'b', 'start'])
})

test('a failed watcher pause aborts the mutation and restores monitoring', async () => {
  const log: unknown[] = [],
    warnings: unknown[] = []
  const gate = createWatchGate(
    () => {
      throw new Error('locked handle')
    },
    () => log.push('resume'),
    null,
    { warn: (message) => warnings.push(message) }
  )
  await assert.rejects(
    gate.pause(() => {
      log.push('operation')
      return 'result'
    }),
    /locked handle/
  )
  assert.deepEqual(log, ['resume'])
  assert.equal(warnings.length, 0, 'the pause error is returned to the caller rather than swallowed')
})

test('production requires a scoped gate and never executes an unowned mutation', async () => {
  let ran = false
  {
    assert.throws(
      () =>
        withWatchersPaused(() => {
          ran = true
        }),
      /host watch gate is required/
    )
    assert.equal(ran, false)
    const gate = createWatchGate(
      () => {},
      () => {}
    )
    await runWithWatchGate(gate, () =>
      withWatchersPaused(() => {
        ran = true
      })
    )
    assert.equal(ran, true)
    assert.throws(() => withWatchersPaused(() => {}), /host watch gate is required/)
  }
})
