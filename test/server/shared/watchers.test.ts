import type { ChokidarOptions } from 'chokidar'
import type { Root } from '../../../shared/types.d.ts'
import type { WatchProvider } from '../../../server/shared/watchers.ts'
class FakeWatcher extends EventEmitter {
  close: () => Promise<void> = async () => {}
}
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createWatchers } from '../../../server/shared/watchers.ts'
import type { ChangeEvent } from '../../../shared/types.js'

function fixture() {
  const events: ChangeEvent[] = []
  const handles: { handle: FakeWatcher; dir: string; options: Partial<ChokidarOptions> }[] = []
  const messages: string[] = []
  let roots: Root[] = [{ id: 'one', label: 'one', dir: '/synthetic/one' }]
  const provider: WatchProvider = {
    id: 'fixture',
    loadRoots: () => roots,
    watch: {
      watchDir: (dir) => dir,
      ignored: (_root, file) => file.endsWith('.ignored'),
      toEvent: (root, _dir, file) => ({ provider: 'fixture', root, id: file }),
    },
  }
  const controller = createWatchers({ fixture: provider }, (event) => events.push(event), {
    exists: (dir) => !dir.endsWith('missing'),
    watch: (dir, options) => {
      const handle = new FakeWatcher()
      handle.close = async () => {}
      handles.push({ handle, dir, options })
      return handle
    },
    log: {
      log() {},
      warn(message) {
        messages.push(message)
      },
    },
  })
  return {
    controller,
    events,
    handles,
    messages,
    roots: (next: Root[]) => {
      roots = next
    },
  }
}

test('watchers use current roots, ignore missing directories and forward add/change/unlink events', async () => {
  const fx = fixture()
  fx.roots([
    { id: 'one', label: 'one', dir: '/synthetic/one' },
    { id: 'missing', label: 'missing', dir: '/synthetic/missing' },
  ])
  await fx.controller.start()
  assert.equal(fx.handles.length, 1)
  const { handle, options } = fx.handles[0]
  assert.equal(options.ignoreInitial, true)
  assert.equal(typeof options.ignored, 'function')
  assert.ok(typeof options.ignored === 'function')
  assert.equal(options.ignored('/synthetic/file.ignored'), true)
  for (const name of ['add', 'change', 'unlink']) handle.emit(name, name)
  assert.deepEqual(
    fx.events.map((event) => event.id),
    ['add', 'change', 'unlink']
  )
  handle.emit('error', new Error('watch error'))
  assert.match(fx.messages[0], /watch error/)
  await fx.controller.close()
  handle.emit('change', 'after-close')
  assert.equal(fx.events.length, 3)
})

test('watchers recover all roots after a memoized close rejection and ignore retired events', async () => {
  const fx = fixture()
  fx.roots([
    { id: 'one', label: 'one', dir: '/synthetic/one' },
    { id: 'two', label: 'two', dir: '/synthetic/two' },
  ])
  await fx.controller.start()
  let attempts = 0
  let failedClose: Promise<never> | undefined
  const retired = fx.handles[0].handle
  retired.close = () => {
    attempts++
    failedClose ||= Promise.reject(new Error('locked'))
    return failedClose
  }
  await fx.controller.start()
  assert.equal(attempts, 1, 'retrying a memoized rejection cannot repair a closed watcher')
  assert.equal(fx.handles.length, 4)
  assert.match(fx.messages[0], /close failed.*locked/)
  retired.emit('change', 'retired')
  retired.emit('unlink', 'retired-unlink')
  fx.handles[2].handle.emit('change', 'one-resumed')
  fx.handles[3].handle.emit('change', 'two-resumed')
  assert.deepEqual(
    fx.events.map((event) => [event.root, event.id]),
    [
      ['one', 'one-resumed'],
      ['two', 'two-resumed'],
    ]
  )
  await fx.controller.close()
  await fx.controller.start()
  assert.equal(fx.handles.length, 4)
})

test('a synchronous watcher close failure does not skip closing healthy handles or restoring monitoring', async () => {
  const fx = fixture()
  fx.roots([
    { id: 'one', label: 'one', dir: '/synthetic/one' },
    { id: 'two', label: 'two', dir: '/synthetic/two' },
  ])
  await fx.controller.start()
  let healthyClosed = false
  fx.handles[0].handle.close = () => {
    throw new Error('synchronous close failure')
  }
  fx.handles[1].handle.close = async () => {
    healthyClosed = true
  }
  await fx.controller.start()
  assert.equal(healthyClosed, true)
  assert.equal(fx.handles.length, 4)
  fx.handles[3].handle.emit('change', 'healthy-resumed')
  assert.equal(fx.events[0].id, 'healthy-resumed')
  await fx.controller.close()
})

test('watchers close cancels a queued restart while awaiting the old generation', async () => {
  const fx = fixture()
  await fx.controller.start()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  fx.handles[0].handle.close = () => blocked
  const restarting = fx.controller.start()
  const closing = fx.controller.close()
  release()
  await Promise.all([restarting, closing])
  assert.equal(fx.handles.length, 1)
})
