import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createDashboardService } from '../server/deck/dashboards.js'
import { findTmux } from '../server/shared/terminal.js'

// Opt-in integration test: real tmux, but only disposable echo processes on
// isolated sockets. Never attaches to, sends input to, or ends a user's agents.
test('real tmux dashboard survives storage migration and controls only isolated viewers', {
  skip: process.env.AGENTDECK_TEST_REAL_TMUX !== '1' || process.platform === 'win32',
}, async (t) => {
  const bin = findTmux()
  assert.ok(bin, 'tmux must be installed for the opt-in test')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdeck-tmux-test-'))
  const legacyDirectory = path.join(directory, 'dashboards')
  const socket = path.join(directory, 'source.sock')
  const outerName = 'agentdeck-dash-' + crypto.createHash('sha256').update(legacyDirectory).digest('hex').slice(0, 12)
  const env = { ...process.env, TERM: 'xterm-256color' }; delete env.TMUX; delete env.TMUX_PANE
  const run = (cmd, args) => execFileSync(cmd, args, { env, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] })
  const source = (args) => run(bin, ['-S', socket, '-f', '/dev/null', ...args]).trim()
  t.after(() => {
    // Both server identities are created solely by this test, from its mkdtemp.
    for (const args of [['-L', outerName, 'kill-server'], ['-S', socket, 'kill-server']]) {
      try { run(bin, args) } catch {}
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const entries = [1, 2].map((i) => ({ key: `test-${i}`, provider: 'test', root: 'isolated', startedAt: i, tmuxName: `test-agent-${i}`, tmuxSocket: socket }))
  for (const e of entries) source(['new-session', '-d', '-s', e.tmuxName, process.execPath, '-e', 'process.stdin.setRawMode(true); process.stdin.on("data", data => process.stdout.write("received:" + data.toString("hex") + "\\n")); console.log("ready")'])
  const before = source(['list-sessions', '-F', '#{session_id}:#{session_created}'])
  const deps = { live: () => entries, tmuxBin: () => bin, ttydBin: () => 'unused-test-ttyd', envBin: () => '/usr/bin/env', run }
  let service = createDashboardService({ ...deps, getDirectory: () => legacyDirectory })
  const d = service.create(entries.map((e) => e.key))
  service = createDashboardService({ ...deps, getConfigDirectory: () => directory })
  assert.equal(service.list().dashboards[0].running, true, 'migration retains the existing outer server')
  assert.ok(!fs.existsSync(legacyDirectory))
  assert.ok(fs.existsSync(path.join(directory, '.agentdeck', 'dashboards', `${d.id}.json`)))
  assert.ok(d.sources.every((s) => /^\$\d+$/.test(s.sessionId) && /^\d+$/.test(s.sessionCreated)))
  const flags = () => source(['list-clients', '-F', '#{session_id}|#{client_flags}']).split('\n').filter(Boolean)
  for (let i = 0; i < 40 && flags().length !== 2; i++) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(flags().length, 2)
  assert.ok(flags().every((s) => s.includes('read-only') && s.includes('ignore-size')))
  const type = (s, text) => run(bin, ['-L', outerName, 'send-keys', '-t', s.pane, '-l', text])
  const screen = (s) => source(['capture-pane', '-p', '-t', `${s.sessionId}:`])
  type(d.sources[0], 'x')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.doesNotMatch(screen(d.sources[0]), /received:78/, 'read-only viewer must not deliver keystrokes')
  service.control(d.id, entries[0].key)
  assert.equal(flags().filter((s) => s.includes('read-only')).length, 1, flags().join('\n'))
  assert.ok(flags().every((s) => s.includes('ignore-size')))
  type(d.sources[0], 'y')
  for (let i = 0; i < 40 && !screen(d.sources[0]).includes('received:79'); i++) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.match(screen(d.sources[0]), /received:79/, 'selected viewer can deliver keystrokes to its original process')
  service.control(d.id, null)
  assert.ok(flags().every((s) => s.includes('read-only')))
  type(d.sources[0], 'z')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.doesNotMatch(screen(d.sources[0]), /received:7a/, 'revoking control stops further input')
  service.remove(d.id, entries[0].key)
  assert.equal(service.get(d.id).sources.length, 1)
  service.stop(d.id)
  assert.equal(fs.existsSync(path.join(directory, '.agentdeck', 'dashboards', `${d.id}.json`)), false)
  assert.deepEqual(service.list().dashboards, [])
  assert.throws(() => service.get(d.id), { status: 404 })
  assert.equal(source(['list-sessions', '-F', '#{session_id}:#{session_created}']), before, 'source processes retain their identities after viewer removal/end')
})
