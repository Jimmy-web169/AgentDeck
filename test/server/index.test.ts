import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { type TestContext } from 'node:test'
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

// Starts the real bootstrap on an ephemeral port and resolves once it reports
// its listener; output keeps accumulating so callers can assert on it later.
async function startServer(t: TestContext, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../../server/index.ts', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  const log = { output: '' }
  child.stderr.on('data', (chunk: Buffer) => {
    log.output += chunk.toString()
  })
  const listening = await new Promise<{ port: string; bind: string }>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      log.output += chunk.toString()
      const match = /AgentDeck API.*http:\/\/localhost:(\d+)\s+\(bind: ([^)]+)\)/.exec(log.output)
      if (match) {
        child.stdout.off('data', onData)
        resolve({ port: match[1], bind: match[2] })
      }
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.once('exit', () => reject(new Error(`Exited before listening: ${log.output}`)))
  })
  return { child, exited, log, ...listening }
}

for (const legacyHost of [undefined, '0.0.0.0']) {
  test(`startup binds loopback ${legacyHost ? 'despite the retired container override' : 'by default'} and shuts down its own listener`, {
    timeout: 15000,
  }, async (t) => {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENTDECK_PORT: '0', AGENTDECK_CONFIG_DIR: temporaryDirectory('index-test-') }
    delete env.AGENTDECK_HOST
    if (legacyHost) env.AGENTDECK_HOST = legacyHost
    const { child, exited, log, port, bind } = await startServer(t, env)
    assert.equal(bind, '127.0.0.1')
    assert.notEqual(port, '0')
    await connect(port)
    assert.equal(child.kill('SIGTERM'), true)
    const [code, signal] = await exited
    // Windows child.kill forcibly terminates the process instead of delivering
    // a catchable POSIX signal. Still verify binding and port release there.
    if (process.platform === 'win32') t.diagnostic('Graceful SIGTERM exit is a POSIX-only assertion; Windows uses forced child termination.')
    else {
      assert.equal(code, 0, log.output)
      assert.equal(signal, null)
    }
    await assert.rejects(connect(port), { code: 'ECONNREFUSED' })
  })
}

test('startup copies clean legacy state into .agentdeck/ and keeps the originals readable by older versions', { timeout: 15000 }, async (t) => {
  const dir = temporaryDirectory('index-migrate-')
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const legacy = path.join(dir, 'roots.claude.json')
  const original = JSON.stringify([{ id: 'legacyroot', label: 'legacy', dir: home }], null, 2)
  fs.writeFileSync(legacy, original)
  const env: NodeJS.ProcessEnv = { ...process.env, AGENTDECK_PORT: '0', AGENTDECK_CONFIG_DIR: dir }
  delete env.AGENTDECK_HOST
  const { child, exited, log } = await startServer(t, env)
  assert.match(log.output, /state: copied 1 legacy item\(s\)/)
  assert.equal(fs.readFileSync(path.join(dir, '.agentdeck', 'roots', 'claude.json'), 'utf8'), original)
  assert.equal(fs.readFileSync(legacy, 'utf8'), original)
  assert.ok(fs.existsSync(`${legacy}.migrated`))
  child.kill('SIGTERM')
  await exited
})
