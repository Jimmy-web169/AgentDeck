import { required } from '../../helpers/assert.ts'
import { ChildProcess } from 'node:child_process'
class FakeProcess extends ChildProcess {
  override killed = false
  override exitCode: number | null = null
  override kill() {
    this.killed = true
    this.exitCode = 0
    this.emit('exit', 0)
    return true
  }
}
import { applyStateMigration, planStateMigration } from '../../../server/shared/state.ts'
import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'
import { assertContract } from '../../helpers/fixture.ts'
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createDashboardService } from '../../../server/deck/dashboards.ts'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { findTmux } from '../../../server/shared/terminal.ts'

describe('dashboard', async () => {
  function fixture(t: test.TestContext) {
    const directory = temporaryDirectory('agentdeck-dashboard-')
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const entries = [1, 2, 3].map((i) => ({
      key: `terminal-${i}`,
      provider: i === 1 ? 'claude' : 'codex',
      root: `account-${i}`,
      startedAt: i,
      tmuxName: `agent-${i}`,
      tmuxSocket: '/tmp/fake-source.sock',
      cwd: directory,
      title: `Agent ${i}`,
      sessionId: `$${i}`,
    }))
    const calls: string[][] = [],
      containers = new Set<string>(),
      panes = new Map<string, string>(),
      processes: { bin: string; args: string[]; proc: FakeProcess }[] = []
    const readonly = new Map<string, number>()
    let failSplit = false
    const run = (_bin: string, args: string[]) => {
      calls.push(args)
      if (args[0] === '-S' && args[2] === 'display-message') {
        const target = args[args.indexOf('-t') + 1]
        assert.ok(target.endsWith(':'), 'pane queries must explicitly qualify the session')
        const name = target.slice(1, -1),
          entry = entries.find((e) => e.tmuxName === name)
        if (!entry) throw Error('source ended')
        return `/tmp/fake-source.sock\t${entry.sessionId}\t12345\t42`
      }
      if (args[0] === '-S') {
        if (args[2] === 'list-clients')
          return [...panes.entries()]
            .map(([pane, s]) => `${100 + Number(pane.slice(1))}\t/dev/fake-${pane.slice(1)}\t${s}\t${readonly.get(`/dev/fake-${pane.slice(1)}`) ?? 1}`)
            .join('\n')
        if (args[2] === 'refresh-client' && required(args.at(-1)).includes('read-only')) readonly.set(args[args.indexOf('-t') + 1], 1)
        if (args[2] === 'switch-client') {
          const tty = args[args.indexOf('-c') + 1]
          readonly.set(tty, readonly.get(tty) === 0 ? 1 : 0)
        }
        return ''
      }
      assert.equal(args[0], '-L')
      assert.equal(args[2], '-f')
      assert.equal(args[3], '/dev/null')
      const cmd = args[4]
      if (['split-window', 'set-option', 'set-window-option', 'select-layout'].includes(cmd))
        assert.ok(args[args.indexOf('-t') + 1].endsWith(':'), 'window/pane commands need an explicit session-qualified target')
      if (cmd === 'new-session') {
        containers.add(args[args.indexOf('-s') + 1])
        const pane = `%${panes.size}`
        panes.set(pane, required(args.at(-1)))
        return pane
      }
      if (cmd === 'split-window') {
        if (failSplit) throw Error('split failed')
        const pane = `%${panes.size}`
        panes.set(pane, required(args.at(-1)))
        return pane
      }
      if (cmd === 'has-session') {
        if (!containers.has(required(args.at(-1)).slice(1))) throw Error('not running')
        return ''
      }
      if (cmd === 'kill-session') {
        containers.delete(required(args.at(-1)).slice(1))
        return ''
      }
      if (cmd === 'display-message') return args.at(-1) === '#{session_name}' ? [...containers][0] : String(100 + Number(args[args.indexOf('-t') + 1].slice(1)))
      return ''
    }
    const deps = {
      getDirectory: () => directory,
      live: () => entries,
      tmuxBin: () => 'tmux',
      ttydBin: () => 'ttyd',
      envBin: () => '/usr/bin/env',
      platform: 'darwin' as const,
      run,
      spawnProcess: (bin: string, args: string[]) => {
        const proc = new FakeProcess()
        processes.push({ bin, args, proc })
        return proc
      },
    }
    const service = createDashboardService(deps)
    t.after(() => service.closeFrontends())
    return {
      service,
      deps,
      entries,
      calls,
      containers,
      processes,
      setFailSplit: () => {
        failSplit = true
      },
    }
  }

  test('dashboard creates viewer clients on an isolated server without moving or cloning agents', (t) => {
    const { service, calls } = fixture(t)
    const d = service.create(['terminal-2', 'terminal-1'], 'Two agents')
    assertContract('Dashboard', d)
    assert.deepEqual(
      d.sources.map((s) => s.key),
      ['terminal-2', 'terminal-1']
    )
    assert.equal(d.control, null)
    const launch = calls.filter((args) => args.includes('attach-session'))
    assert.equal(launch.length, 2)
    for (const args of launch) {
      assert.equal(args[0], '-L')
      const at = args.indexOf('attach-session')
      assert.deepEqual(args.slice(at, at + 3), ['attach-session', '-f', 'read-only,ignore-size'])
      assert.ok(args.includes('/usr/bin/env'))
      assert.ok(args.includes('-E'), 'attaching must preserve the source environment')
      assert.ok(!args.includes('join-pane') && !args.includes('move-pane') && !args.includes('link-window'))
      assert.ok(/^\$\d+$/.test(required(args.at(-1))), 'attach the immutable native session id, not its reusable name')
    }
    assert.equal(service.list().dashboards[0].running, true)
  })

  test('dashboard rejects duplicates, unknown/nonlive terminals, excess members, and unsupported platforms', (t) => {
    const { service, deps } = fixture(t)
    for (const keys of [['terminal-1'], ['terminal-1', 'terminal-1'], ['1', '2', '3', '4', '5']]) assert.throws(() => service.create(keys), { status: 400 })
    assert.throws(() => service.create(['terminal-1', 'unknown']), { status: 410 })
    const windows = createDashboardService({ ...deps, platform: 'win32' })
    assert.equal(windows.capability().supported, false)
    assert.throws(() => windows.create(['terminal-1', 'terminal-2']), { status: 409 })
  })

  test('malformed runtime identities fail before any dashboard container is launched', (t) => {
    const { deps, calls } = fixture(t)
    for (const identity of ['/tmp/source\t\t\t42', '/tmp/source\t$1\t\t42', '/tmp/source\t$1\t123\t']) {
      const service = createDashboardService({
        ...deps,
        run: (bin, args) => (args[0] === '-S' && args[2] === 'display-message' ? identity : deps.run(bin, args)),
      })
      assert.throws(() => service.create(['terminal-1', 'terminal-2']), { status: 409 })
    }
    assert.ok(!calls.some((a) => a.includes('new-session')))
  })

  test('partial control grant restores read-only before returning an error', (t) => {
    const { deps, calls } = fixture(t)
    const service = createDashboardService({
      ...deps,
      run: (bin, args) => {
        if (args[2] === 'refresh-client' && args.at(-1) === 'ignore-size') throw Error('simulated refresh failure')
        return deps.run(bin, args)
      },
    })
    const d = service.create(['terminal-1', 'terminal-2'])
    assert.throws(() => service.control(d.id, 'terminal-1'), /simulated refresh failure/)
    assert.equal(required(calls.filter((a) => a.includes('refresh-client')).at(-1)).at(-1), 'read-only,ignore-size')
    assert.equal(service.get(d.id).control, null)
  })

  test('input handoff revokes viewers first and never changes unrelated source clients', (t) => {
    const { service, calls, entries } = fixture(t)
    const d = service.create(['terminal-1', 'terminal-2'])
    service.control(d.id, 'terminal-1')
    assertContract('Dashboard', service.get(d.id))
    calls.length = 0
    service.control(d.id, 'terminal-2')
    const flags = calls.filter((a) => a.includes('refresh-client'))
    assert.deepEqual(
      flags.map((a) => a.at(-1)),
      ['read-only,ignore-size', 'read-only,ignore-size', 'ignore-size']
    )
    const toggle = calls.find((a) => a.includes('switch-client'))
    assert.ok(toggle)
    assert.ok(toggle[toggle.indexOf('-c') + 1].startsWith('/dev/fake-'))
    assert.equal(toggle[toggle.indexOf('-t') + 1], d.sources[1].sessionId)
    assert.ok(toggle.includes('-E'), 'do not update source session environment')
    assert.ok(flags.every((a) => a[a.indexOf('-t') + 1].startsWith('/dev/fake-')))
    entries[1].startedAt = 99
    assert.throws(() => service.control(d.id, 'terminal-2'), { status: 410 })
  })

  test('frontend shutdown preserves the outer container; End kills only the outer session', async (t) => {
    const { service, deps, calls, processes, entries } = fixture(t)
    const d = service.create(['terminal-1', 'terminal-2'])
    const [a, b] = await Promise.all([service.attach(d.id), service.attach(d.id)])
    assert.equal(a.url, b.url)
    assert.equal(processes.length, 1)
    service.closeFrontends()
    assert.equal(service.list().dashboards[0].running, true)
    const restarted = createDashboardService(deps)
    assert.equal(restarted.list().dashboards[0].id, d.id)
    calls.length = 0
    restarted.stop(d.id)
    const kills = calls.filter((a) => a.includes('kill-session'))
    assert.equal(kills.length, 1)
    assert.equal(kills[0][0], '-L')
    assert.equal(kills[0].at(-1), `=${d.name}`)
    assert.equal(entries.length, 3, 'source inventory unchanged')
    assert.equal(fs.existsSync(path.join(deps.getDirectory(), `${d.id}.json`)), false)
    assert.deepEqual(restarted.list().dashboards, [])
    assert.throws(() => restarted.get(d.id), { status: 404 })
    assert.equal(restarted.stop(d.id).id, d.id, 'a repeated End is harmless')
  })

  test('failed container construction cleans up only its own outer session', (t) => {
    const { service, calls, setFailSplit, entries } = fixture(t)
    setFailSplit()
    assert.throws(() => service.create(['terminal-1', 'terminal-2']), { status: 502 })
    assert.equal(calls.filter((a) => a.includes('kill-session')).length, 1)
    assert.ok(calls.filter((a) => a.includes('kill-session')).every((a) => a[0] === '-L'))
    assert.equal(entries.length, 3)
  })

  test('removing a member kills its outer viewer pane, never a source session', (t) => {
    const { service, calls, entries } = fixture(t)
    const d = service.create(['terminal-1', 'terminal-2'])
    calls.length = 0
    const updated = service.remove(d.id, 'terminal-1')
    assert.equal(updated.sources.length, 1)
    const kills = calls.filter((a) => a.includes('kill-pane'))
    assert.equal(kills.length, 1)
    assert.equal(kills[0][0], '-L')
    assert.equal(kills[0].at(-1), d.sources[0].pane)
    assert.equal(entries.length, 3)
    const ended = service.remove(d.id, 'terminal-2')
    assert.ok(ended.endedAt)
    assert.deepEqual(service.list().dashboards, [])
    assert.throws(() => service.get(d.id), { status: 404 })
  })

  test('End preserves tracking when verification or termination fails; legacy ended records are safely retired', (t) => {
    const { service, deps, containers } = fixture(t)
    const d = service.create(['terminal-1', 'terminal-2'])
    const file = path.join(deps.getDirectory(), `${d.id}.json`)
    for (const command of ['has-session', 'kill-session']) {
      const failing = createDashboardService({
        ...deps,
        run: (bin, args) => {
          if (args[4] === command) throw Error('permission denied')
          return deps.run(bin, args)
        },
      })
      assert.throws(() => failing.stop(d.id))
      assert.ok(fs.existsSync(file))
      assert.ok(containers.has(d.name))
    }
    containers.delete(d.name)
    fs.writeFileSync(file, JSON.stringify({ ...d, endedAt: Date.now() }))
    assert.deepEqual(service.list().dashboards, [])
    assert.equal(fs.existsSync(file), false)
  })

  test('End cannot delete or kill a different dashboard through mismatched tracking metadata', (t) => {
    const { service, deps, calls } = fixture(t)
    const first = service.create(['terminal-1', 'terminal-2']),
      second = service.create(['terminal-2', 'terminal-3'])
    fs.writeFileSync(path.join(deps.getDirectory(), `${first.id}.json`), JSON.stringify(second))
    calls.length = 0
    assert.throws(() => service.stop(first.id), { status: 409 })
    assert.equal(calls.length, 0)
    assert.ok(fs.existsSync(path.join(deps.getDirectory(), `${first.id}.json`)))
    assert.ok(fs.existsSync(path.join(deps.getDirectory(), `${second.id}.json`)))
  })

  test('new dashboard state lives only under the configured .agentdeck base', (t) => {
    const { deps } = fixture(t)
    const base = deps.getDirectory()
    const service = createDashboardService({ ...deps, getDirectory: undefined, getConfigDirectory: () => base })
    assert.deepEqual(service.list().dashboards, [])
    assert.deepEqual(fs.readdirSync(base), [], 'reading a fresh store does not create directories')
    const d = service.create(['terminal-1', 'terminal-2'])
    assert.ok(fs.existsSync(path.join(base, '.agentdeck', 'dashboards', `${d.id}.json`)))
    assert.deepEqual(fs.readdirSync(base), ['.agentdeck'])
  })

  test('legacy migration preserves records, tmux identity, control and restart behavior', async (t) => {
    const { deps, calls, processes } = fixture(t)
    const base = deps.getDirectory(),
      legacy = path.join(base, 'dashboards')
    const old = createDashboardService({ ...deps, getDirectory: () => legacy })
    const d = old.create(['terminal-1', 'terminal-2'])
    old.control(d.id, 'terminal-1')
    const before = fs.readFileSync(path.join(legacy, `${d.id}.json`))
    const socket = required(calls.find((a) => a.includes('new-session')))[1]
    const upgradedDeps = { ...deps, getDirectory: undefined, getConfigDirectory: () => base }
    const upgraded = createDashboardService(upgradedDeps)
    t.after(() => upgraded.closeFrontends())
    assert.ok(fs.existsSync(legacy), 'module/service construction must not migrate on import')
    calls.length = 0
    assert.equal(upgraded.list().dashboards[0].running, true)
    assert.ok(fs.existsSync(legacy), 'normal reads retain the legacy owner until explicit apply')
    assert.ok(!fs.existsSync(path.join(base, '.agentdeck')))
    applyStateMigration(base)
    assert.ok(fs.existsSync(legacy), 'copy migration retains recoverable legacy records')
    assert.deepEqual(fs.readFileSync(path.join(base, '.agentdeck', 'dashboards', `${d.id}.json`)), before)
    assert.equal(upgraded.get(d.id).control, 'terminal-1')
    assert.equal(calls.length, 1, 'migration only checks whether the existing container is alive')
    assert.equal(calls[0][1], socket)
    await upgraded.attach(d.id)
    assert.equal(processes[0].args[processes[0].args.indexOf('-L') + 1], socket)
    upgraded.control(d.id, null)
    const restarted = createDashboardService(upgradedDeps)
    assert.equal(restarted.list().dashboards[0].running, true)
    assert.equal(restarted.get(d.id).control, null)
    restarted.remove(d.id, 'terminal-1')
    restarted.stop(d.id)
    assert.ok(calls.filter((a) => a[0] === '-L').every((a) => a[1] === socket))
    assert.deepEqual(fs.readFileSync(path.join(legacy, `${d.id}.json`)), before, 'later writes only update new storage; legacy backup remains unchanged')
  })

  test('migration never overwrites or merges competing dashboard stores', (t) => {
    const { deps, calls } = fixture(t)
    const base = deps.getDirectory(),
      legacy = path.join(base, 'dashboards')
    const destination = path.join(base, '.agentdeck', 'dashboards')
    fs.mkdirSync(legacy)
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'sentinel'), 'legacy')
    fs.writeFileSync(path.join(destination, 'sentinel'), 'new')
    const service = createDashboardService({ ...deps, getDirectory: undefined, getConfigDirectory: () => base })
    assert.deepEqual(service.list().dashboards, [], 'new owner wins without merging legacy records')
    assert.equal(planStateMigration(base)[0].status, 'conflict')
    assert.throws(() => applyStateMigration(base), /conflicting/)
    assert.equal(fs.readFileSync(path.join(legacy, 'sentinel'), 'utf8'), 'legacy')
    assert.equal(fs.readFileSync(path.join(destination, 'sentinel'), 'utf8'), 'new')
    assert.deepEqual(calls, [])
  })

  test('legacy storage symlinks are not followed or migrated', { skip: process.platform === 'win32' }, (t) => {
    const { deps } = fixture(t)
    const base = deps.getDirectory(),
      legacy = path.join(base, 'dashboards')
    fs.symlinkSync(base, legacy, 'dir')
    const service = createDashboardService({ ...deps, getDirectory: undefined, getConfigDirectory: () => base })
    assert.throws(() => service.list(), { status: 409 })
    assert.ok(fs.lstatSync(legacy).isSymbolicLink())
    assert.ok(!fs.existsSync(path.join(base, '.agentdeck')))
  })
})

describe('dashboard-tmux', async () => {
  // Opt-in integration test: real tmux, but only disposable echo processes on
  // isolated sockets. Never attaches to, sends input to, or ends a user's agents.
  test('real tmux dashboard survives storage migration and controls only isolated viewers', {
    skip: process.env.AGENTDECK_TEST_REAL_TMUX !== '1' || process.platform === 'win32',
  }, async (t) => {
    const bin = findTmux()
    assert.ok(bin, 'tmux must be installed for the opt-in test')
    const directory = temporaryDirectory('agentdeck-tmux-test-')
    const legacyDirectory = path.join(directory, 'dashboards')
    const socket = path.join(directory, 'source.sock')
    const outerName = 'agentdeck-dash-' + crypto.createHash('sha256').update(legacyDirectory).digest('hex').slice(0, 12)
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color' }
    delete env.TMUX
    delete env.TMUX_PANE
    const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { env, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] })
    const source = (args: string[]) => run(bin, ['-S', socket, '-f', '/dev/null', ...args]).trim()
    t.after(() => {
      // Both server identities are created solely by this test, from its mkdtemp.
      for (const args of [
        ['-L', outerName, 'kill-server'],
        ['-S', socket, 'kill-server'],
      ]) {
        try {
          run(bin, args)
        } catch {}
      }
      fs.rmSync(directory, { recursive: true, force: true })
    })
    const entries = [1, 2].map((i) => ({ key: `test-${i}`, provider: 'test', root: 'isolated', startedAt: i, tmuxName: `test-agent-${i}`, tmuxSocket: socket }))
    for (const e of entries)
      source([
        'new-session',
        '-d',
        '-s',
        e.tmuxName,
        process.execPath,
        '-e',
        'process.stdin.setRawMode(true); process.stdin.on("data", data => process.stdout.write("received:" + data.toString("hex") + "\\n")); console.log("ready")',
      ])
    const before = source(['list-sessions', '-F', '#{session_id}:#{session_created}'])
    const deps = { live: () => entries, tmuxBin: () => bin, ttydBin: () => 'unused-test-ttyd', envBin: () => '/usr/bin/env', run }
    let service = createDashboardService({ ...deps, getDirectory: () => legacyDirectory })
    const d = service.create(entries.map((e) => e.key))
    applyStateMigration(directory)
    service = createDashboardService({ ...deps, getConfigDirectory: () => directory })
    assert.equal(service.list().dashboards[0].running, true, 'migration retains the existing outer server')
    assert.ok(fs.existsSync(legacyDirectory), 'explicit migration retains legacy records')
    assert.ok(fs.existsSync(path.join(directory, '.agentdeck', 'dashboards', `${d.id}.json`)))
    assert.ok(d.sources.every((s) => /^\$\d+$/.test(s.sessionId) && /^\d+$/.test(s.sessionCreated)))
    const flags = () => source(['list-clients', '-F', '#{session_id}|#{client_flags}']).split('\n').filter(Boolean)
    for (let i = 0; i < 40 && flags().length !== 2; i++) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(flags().length, 2)
    assert.ok(flags().every((s) => s.includes('read-only') && s.includes('ignore-size')))
    const type = (s: { pane?: string }, text: string) => run(bin, ['-L', outerName, 'send-keys', '-t', required(s.pane), '-l', text])
    const screen = (s: { sessionId: string }) => source(['capture-pane', '-p', '-t', `${s.sessionId}:`])
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
    assert.equal(
      source(['list-sessions', '-F', '#{session_id}:#{session_created}']),
      before,
      'source processes retain their identities after viewer removal/end'
    )
  })
})
