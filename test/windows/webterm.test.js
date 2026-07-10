// webterm.js: the node-pty web terminal used instead of ttyd on native Windows.
// Covers the contract the pop-out flow depends on: one shared pty, multiple
// websocket clients, and a client disconnect NOT killing the pty.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const WEBTERM = fileURLToPath(new URL('../../server/shared/webterm.js', import.meta.url))
const PORT = 7779 // inside the pool range but high, to dodge dev servers

// a long-lived interactive child that prints a marker, echoes stdin lines
const CHILD = [process.execPath, '-e', "console.log('WEBTERM_READY');process.stdin.on('data',d=>process.stdout.write('echo:'+d));setTimeout(()=>{},600000)"]

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.binaryType = 'nodebuffer'
    const client = { ws, output: '', closed: null }
    ws.on('message', (d) => (client.output += d.toString('utf8')))
    ws.on('close', (code) => (client.closed = code))
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 's', c: 100, r: 30 }))
      resolve(client)
    })
    ws.on('error', reject)
  })
}

const until = async (fn, ms = 5000) => {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('serves the page, shares one pty across clients, survives a client closing', async () => {
  const proc = spawn(process.execPath, [WEBTERM, '-p', String(PORT), '-t', 'test', '--', ...CHILD], { stdio: 'ignore' })
  try {
    await until(() => proc.exitCode === null) // spawned
    await new Promise((r) => setTimeout(r, 700)) // let it bind

    const page = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text())
    assert.match(page, /<title>test<\/title>/)
    assert.match(page, /xterm/)

    const a = await connect(PORT) // first client spawns the pty
    await until(() => a.output.includes('WEBTERM_READY'))

    const b = await connect(PORT) // late joiner gets the scrollback replay
    await until(() => b.output.includes('WEBTERM_READY'))

    a.ws.close() // pop-out: the iframe disconnects while the tab stays
    await until(() => a.closed != null)

    b.ws.send(JSON.stringify({ t: 'i', d: 'hello\r' })) // pty must still be alive (\r = Enter in a pty)
    await until(() => b.output.includes('echo:hello'))
    assert.equal(b.closed, null)
  } finally {
    proc.kill()
  }
})

test('exits non-zero when the port is taken', async () => {
  const first = spawn(process.execPath, [WEBTERM, '-p', String(PORT + 1), '-t', 'x', '--', ...CHILD], { stdio: 'ignore' })
  try {
    await new Promise((r) => setTimeout(r, 700))
    const second = spawn(process.execPath, [WEBTERM, '-p', String(PORT + 1), '-t', 'x', '--', ...CHILD], { stdio: 'ignore' })
    const code = await new Promise((r) => second.on('exit', r))
    assert.notEqual(code, 0)
  } finally {
    first.kill()
  }
})
