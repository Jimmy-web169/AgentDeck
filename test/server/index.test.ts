import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'

async function connect(port: string) {
  const socket = createConnection({ host: '127.0.0.1', port: Number(port) })
  socket.setTimeout(3000, () => socket.destroy(new Error('Connection timed out')))
  try {
    await once(socket, 'connect')
  } finally {
    socket.destroy()
  }
}

for (const legacyHost of [undefined, '0.0.0.0']) {
  test(`startup binds loopback ${legacyHost ? 'despite the retired container override' : 'by default'} and shuts down its own listener`, {
    timeout: 15000,
  }, async (t) => {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENTDECK_PORT: '0', AGENTDECK_CONFIG_DIR: temporaryDirectory('index-test-') }
    delete env.AGENTDECK_HOST
    if (legacyHost) env.AGENTDECK_HOST = legacyHost
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../server/index.ts', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
    })
    let output = ''
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const port = await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        output += chunk.toString()
        const match = /AgentDeck API.*http:\/\/localhost:(\d+)\s+\(bind: ([^)]+)\)/.exec(output)
        if (match) {
          child.stdout.off('data', onData)
          if (match[2] !== '127.0.0.1') reject(new Error(`Expected bind 127.0.0.1, got ${match[2]}`))
          else resolve(match[1])
        }
      }
      child.stdout.on('data', onData)
      child.once('error', reject)
      child.once('exit', () => reject(new Error(`Exited before listening: ${output}`)))
    })
    assert.notEqual(port, '0')
    await connect(port)
    assert.equal(child.kill('SIGTERM'), true)
    const [code, signal] = await exited
    // Windows child.kill forcibly terminates the process instead of delivering
    // a catchable POSIX signal. Still verify binding and port release there.
    if (process.platform === 'win32') t.diagnostic('Graceful SIGTERM exit is a POSIX-only assertion; Windows uses forced child termination.')
    else {
      assert.equal(code, 0, output)
      assert.equal(signal, null)
    }
    await assert.rejects(connect(port), { code: 'ECONNREFUSED' })
  })
}
