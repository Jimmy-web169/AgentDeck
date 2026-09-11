class FakeSocket extends EventEmitter {
  send: (raw: string, callback: (error?: Error | null) => void) => void = () => {}
  close() {}
}
class FakeBrowser extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  kill: (signal?: NodeJS.Signals | number) => boolean = () => true
}
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { Cdp, closeOwnedBrowser, withBrowserCleanup } from '../../../scripts/demo/lib.ts'

function browser(kill: (signal: NodeJS.Signals, child: FakeBrowser) => void) {
  const child = new FakeBrowser()
  child.exitCode = null
  child.signalCode = null
  child.kill = (signal = 'SIGTERM') => {
    kill(signal as NodeJS.Signals, child)
    return true
  }
  return child
}

test('CDP times out an unanswered command without preventing later commands or leaking pending work', async () => {
  const ws = new FakeSocket()
  const sent: { id: number }[] = []
  ws.send = (raw: string) => sent.push(JSON.parse(raw))
  const cdp = new Cdp(ws, { timeoutMs: 10 })
  await assert.rejects(cdp.send('Runtime.evaluate', { expression: 'pending' }), /Runtime.evaluate timed out/)
  assert.equal(cdp.pending.size, 0)
  const next = cdp.send('Page.enable')
  ws.emit('message', JSON.stringify({ id: sent[0].id, result: { late: true } }))
  ws.emit('message', JSON.stringify({ id: sent[1].id, result: { enabled: true } }))
  assert.deepEqual(await next, { enabled: true })
  assert.equal(cdp.pending.size, 0)
})

test('CDP disconnect rejects every waiting command and future sends immediately', async () => {
  for (const event of ['close', 'error']) {
    const ws = new FakeSocket()
    let sent = 0
    ws.send = () => {
      sent++
    }
    const cdp = new Cdp(ws)
    const waiting = [cdp.send('Page.enable'), cdp.send('Runtime.enable')]
    const rejected = waiting.map((command) => assert.rejects(command, event === 'close' ? /connection closed/ : /fixture disconnect/))
    ws.emit(event, new Error('fixture disconnect'))
    await Promise.all(rejected)
    await assert.rejects(cdp.send('Page.navigate'), event === 'close' ? /connection closed/ : /fixture disconnect/)
    assert.equal(sent, 2)
    assert.equal(cdp.pending.size, 0)
  }
})

test('CDP clears pending commands after synchronous, callback and protocol send failures', async () => {
  for (const mode of ['throw', 'callback', 'protocol']) {
    const ws = new FakeSocket()
    ws.send = (raw: string, callback: (arg0?: Error | null) => void) => {
      if (mode === 'throw') throw new Error('fixture send failed')
      if (mode === 'callback') callback(new Error('fixture send failed'))
      if (mode === 'protocol') ws.emit('message', JSON.stringify({ id: JSON.parse(raw).id, error: { message: 'fixture send failed', code: -1 } }))
    }
    const cdp = new Cdp(ws)
    await assert.rejects(cdp.send('Page.enable'), /fixture send failed/)
    assert.equal(cdp.pending.size, 0)
  }
})

test('demo browser cleanup waits for process exit before retryable profile removal', async () => {
  const events: unknown[] = []
  const child = browser((signal, process) => {
    events.push(signal)
    setImmediate(() => {
      events.push('exit')
      process.signalCode = signal
      process.emit('exit')
    })
  })
  await closeOwnedBrowser(child, 'owned-profile', {
    remove: async (profile, options) => {
      events.push('remove')
      assert.equal(profile, 'owned-profile')
      assert.deepEqual(options, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    },
  })
  assert.deepEqual(events, ['SIGTERM', 'exit', 'remove'])
  assert.equal(child.listenerCount('exit'), 0)
})

test('demo browser cleanup escalates only its process and respects retained profiles', async () => {
  const signals: unknown[] = []
  const child = browser((signal, process) => {
    signals.push(signal)
    if (signal === 'SIGKILL') {
      process.signalCode = signal
      process.emit('exit')
    }
  })
  await closeOwnedBrowser(child, 'owned-profile', { graceMs: 5, keepProfile: true, remove: async () => assert.fail('profile must remain') })
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

test('demo browser cleanup retains the profile when process exit cannot be confirmed', async () => {
  const child = browser(() => {})
  await assert.rejects(
    closeOwnedBrowser(child, 'owned-profile', { graceMs: 5, remove: async () => assert.fail('live profile must remain') }),
    /profile was retained/
  )
  assert.equal(child.listenerCount('exit'), 0)
  assert.equal(child.listenerCount('error'), 0)
})

test('demo browser cleanup does not signal an already exited process', async () => {
  const child = browser(() => assert.fail('process already exited'))
  child.exitCode = 0
  let removed = false
  await closeOwnedBrowser(child, 'owned-profile', {
    remove: async () => {
      removed = true
    },
  })
  assert.equal(removed, true)
})

test('browser cleanup preserves a primary capture failure and reports the cleanup failure', async () => {
  const primary = new Error('Scene readiness failed')
  const cleanup = new Error('Profile removal failed')
  const originalExit = process.exitCode
  const messages: unknown[] = []
  try {
    await assert.rejects(
      withBrowserCleanup(
        async () => {
          throw cleanup
        },
        async () => {
          throw primary
        },
        { error: (message) => messages.push(message) }
      ),
      (error) => error === primary
    )
    assert.deepEqual(messages, ['[browser cleanup] Profile removal failed'])
    assert.equal(process.exitCode, 1)
    await assert.rejects(
      withBrowserCleanup(
        async () => {
          throw cleanup
        },
        async () => {
          throw primary
        },
        {
          error: () => {
            throw new Error('Logger failed')
          },
        }
      ),
      (error) => error === primary
    )
  } finally {
    process.exitCode = originalExit
  }
})

test('browser cleanup surfaces its own failure after an otherwise successful capture', async () => {
  const cleanup = new Error('Browser stayed alive')
  await assert.rejects(
    withBrowserCleanup(
      async () => {
        throw cleanup
      },
      async () => 'capture result'
    ),
    (error) => error === cleanup
  )
  let closed = false
  assert.equal(
    await withBrowserCleanup(
      async () => {
        closed = true
      },
      async () => 'capture result'
    ),
    'capture result'
  )
  assert.equal(closed, true)
})
