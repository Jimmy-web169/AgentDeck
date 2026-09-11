import ts from 'typescript'
// Windows regression coverage: CLI discovery (`findOnPath`): Windows extension handling (`.exe/.cmd/.bat`), the `node_modules/.bin` exclusion (the embedded terminal must run the *user's* CLI, not the SDK's bundled `codex` — the perpetual-update-prompt bug), and explicit fallback candidates (psmux's winget path).
import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { terminalIdentity, findTerminal } from '../../../server/shared/terminalIdentity.ts'
import { uniqueSession } from '../../../server/shared/terminalDiscovery.ts'
import { findOnPath, resolveVendoredExe } from '../../../server/shared/terminal.ts'

describe('terminal-lifecycle', async () => {
  test('terminal identity isolates providers, accounts and concurrent drafts; retries are idempotent', () => {
    const a = terminalIdentity('one', 'root'),
      b = terminalIdentity('one', 'root')
    assert.notEqual(a.key, b.key)
    assert.equal(terminalIdentity('one', 'root', a).key, a.key)
    assert.notEqual(terminalIdentity('two', 'root', a).key, a.key)
    assert.notEqual(terminalIdentity('one', 'other', a).key, a.key)
    assert.throws(() => terminalIdentity('one', 'root', { launchId: '../bad' }), { status: 400 })
    assert.equal(findTerminal([{ provider: 'one', root: 'root', key: a.key }], 'two', 'root', { terminalKey: a.key }), undefined)
  })

  test('discovery requires one observed parent session; competing sessions remain unbound', () => {
    assert.equal(uniqueSession([]), null)
    assert.equal(uniqueSession([{ id: 'a' }, { id: 'b' }]), null)
    assert.deepEqual(uniqueSession([{ id: 'a' }, { id: 'a' }]), { id: 'a' })
  })

  test('terminal survives frontend shutdown, attaches by exact key, persists binding, and never recreates an ended Live target', {
    skip: process.platform === 'win32',
  }, async (t) => {
    const dir = temporaryDirectory('agentdeck-terminal-test-')
    // Extensionless fake CLIs must keep their original CommonJS environment,
    // even though tmp/ now inherits the repository's ESM package boundary.
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }))
    const fixture = fileURLToPath(new URL('../../../scripts/test/fake-terminal.ts', import.meta.url))
    const oldPath = process.env.PATH
    const oldPool = process.env.AGENTDECK_TEST_POOL
    process.env.AGENTDECK_TEST_POOL = dir
    process.env.PATH = dir + path.delimiter + oldPath
    for (const name of ['tmux', 'ttyd', 'fixture-cli']) {
      fs.writeFileSync(
        path.join(dir, name),
        ts.transpileModule(fs.readFileSync(fixture, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
        }).outputText
      )
      fs.chmodSync(path.join(dir, name), 0o755)
    }
    const pool = await import('../../../server/shared/terminal.ts')
    t.after(() => {
      pool.stopAllTerminals()
      process.env.PATH = oldPath
      if (oldPool == null) delete process.env.AGENTDECK_TEST_POOL
      else process.env.AGENTDECK_TEST_POOL = oldPool
      fs.rmSync(dir, { recursive: true, force: true })
    })
    let observed: { id: string; slug: string; cwd: string } | null = null
    let observedLaunch: string | null = null
    let discoveryCalls = 0
    const config: import('../../../server/shared/terminalTypes.ts').TerminalConfig = {
      id: 'fixture',
      title: 'fixture',
      envKey: 'FIXTURE_CONFIG_DIR',
      findBin: () => path.join(dir, 'fixture-cli'),
      resumeArgs: (id) => ['--resume', id],
      resolveSession: ({ meta }) => {
        discoveryCalls++
        return meta.id || meta.launchId !== observedLaunch ? null : observed
      },
      resolveSavedSession: ({ id }) =>
        ['saved-id', 'manual-id', 'other-folder', 'unknown-folder'].includes(id)
          ? { id, slug: dir, cwd: id === 'other-folder' ? os.tmpdir() : id === 'unknown-folder' ? null : dir }
          : null,
    }
    pool.registerTerminalProvider(config)
    const identity = terminalIdentity(config.id, 'account')
    const options = { ...identity, cwd: dir, configDir: dir, meta: { root: 'account', launchId: identity.launchId, cwd: dir, isNew: true }, config }
    const [a, duplicate] = await Promise.all([pool.startTerminal(options), pool.startTerminal(options)])
    assert.equal(a.url, duplicate.url)
    const live = pool.listLiveTmux()
    assert.equal(live.length, 1)
    const name = live[0].tmuxName
    assert.equal(live[0].launchId, identity.launchId)
    // Watcher evidence can prompt discovery before the normal 4-second poll,
    // but unrelated roots cannot invalidate this terminal's evidence cache.
    const realNow = Date.now
    const nextTime = realNow() + 600
    const beforeChanges = discoveryCalls
    try {
      Date.now = () => nextTime
      pool.noteTerminalChanges([{ provider: config.id, root: 'unrelated' }])
      pool.listLiveTmux()
      assert.equal(discoveryCalls, beforeChanges)
      pool.noteTerminalChanges([{ provider: config.id, root: 'account' }])
      pool.listLiveTmux()
      assert.equal(discoveryCalls, beforeChanges + 1)
      pool.noteTerminalChanges([{ provider: config.id, root: 'account' }])
      pool.listLiveTmux()
      assert.equal(discoveryCalls, beforeChanges + 1) // bursts remain throttled
    } finally {
      Date.now = realNow
    }
    pool.stopAllTerminals()
    assert.equal(pool.listLiveTmux().length, 1)
    const again = await pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'account', dir, label: 'Account' }, config })
    assert.ok(again)
    assert.equal(again.reused, true)
    assert.equal(pool.listLiveTmux()[0].tmuxName, name)
    assert.equal(pool.listLiveTmux().length, 1)
    await assert.rejects(pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'wrong', dir, label: 'Wrong' }, config }), { status: 410 })
    // A second provider with the same root/path cannot attach this terminal.
    await assert.rejects(
      pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'account', dir, label: 'Account' }, config: { ...config, id: 'other' } }),
      {
        status: 410,
      }
    )
    // New tmux entry triggers provider discovery immediately, without a polling sleep.
    observed = { id: 'saved-id', slug: dir, cwd: dir }
    const second = terminalIdentity(config.id, 'account')
    // Evidence belongs to this process, not the first terminal awaiting manual
    // repair. Background polling must not bind both to the same mock transcript.
    observedLaunch = second.launchId
    await pool.startTerminal({ ...options, ...second, meta: { ...options.meta, launchId: second.launchId } })
    const bound = pool.listLiveTmux().find((e) => e.key === second.key)
    assert.ok(bound)
    assert.equal(bound.id, 'saved-id')
    const stored = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(path.join(dir, bound.tmuxName + '.json'), 'utf8')).meta, 'base64').toString())
    assert.equal(stored.id, 'saved-id')
    const bind = (body: { bindSessionId?: string; terminalKey?: string; cwd?: string }) =>
      pool.reattachTerminal({ body, root: { id: 'account', dir, label: 'Account' }, config })
    await assert.rejects(bind({ bindSessionId: 'manual-id' }), { status: 400 })
    await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'unknown-id' }), { status: 404 })
    await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'saved-id' }), { status: 409 })
    await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'other-folder', cwd: os.tmpdir() }), { status: 409 })
    await assert.rejects(bind({ terminalKey: a.key, bindSessionId: 'unknown-folder' }), { status: 409 })
    await assert.rejects(bind({ terminalKey: second.key, bindSessionId: 'manual-id' }), { status: 409 })
    const manual = await bind({ terminalKey: a.key, bindSessionId: 'manual-id' })
    assert.ok(manual)
    assert.equal(manual.id, 'manual-id')
    assert.equal(manual.key, a.key)
    assert.equal(manual.launchId, a.launchId)
    assert.equal(pool.listLiveTmux().find((e) => e.key === a.key)?.id, 'manual-id')
    assert.equal(pool.listLiveTmux().length, 2)
    assert.throws(() => pool.stopTerminal(second.key, 'other'), { status: 403 })
    assert.equal(pool.listLiveTmux().length, 2)
    pool.stopTerminal(second.key, config.id)
    assert.equal(pool.listLiveTmux().length, 1)
    await assert.rejects(bind({ terminalKey: second.key }), { status: 410 })
    pool.stopAllTerminals()
    fs.rmSync(path.join(dir, name + '.json'))
    await assert.rejects(pool.reattachTerminal({ body: { terminalKey: a.key }, root: { id: 'account', dir, label: 'Account' }, config }), { status: 410 })
    assert.equal(fs.existsSync(path.join(dir, name + '.json')), false)
  })
})

describe('windows/find-on-path', async () => {
  // findOnPath: PATH discovery with Windows extension handling and the
  // node_modules/.bin exclusion (the embedded terminal must never run a
  // project-bundled CLI like the codex SDK's old `codex`).

  const IS_WIN = process.platform === 'win32'

  function makeExe(dir: string, name: string) {
    const file = path.join(dir, IS_WIN ? `${name}.cmd` : name)
    fs.writeFileSync(file, IS_WIN ? '@echo off\r\n' : '#!/bin/sh\n')
    if (!IS_WIN) fs.chmodSync(file, 0o755)
    return file
  }

  function withPath<T>(dirs: string[], fn: () => T) {
    const saved = process.env.PATH
    process.env.PATH = dirs.join(path.delimiter)
    try {
      return fn()
    } finally {
      process.env.PATH = saved
    }
  }

  test('finds an executable on PATH (with the platform extension)', () => {
    const dir = temporaryDirectory('adk-path-')
    const exe = makeExe(dir, 'fakecli')
    try {
      const found = withPath([dir], () => findOnPath(['fakecli']))
      assert.equal(found, exe)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('skips node_modules/.bin entries on PATH', () => {
    const root = temporaryDirectory('adk-path-')
    const binDir = path.join(root, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    makeExe(binDir, 'fakecli')
    try {
      const found = withPath([binDir], () => findOnPath(['fakecli']))
      assert.equal(found, null)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('falls back to explicit extra candidates', () => {
    const dir = temporaryDirectory('adk-path-')
    const exe = makeExe(dir, 'fakecli')
    try {
      const found = withPath([], () => findOnPath(['fakecli'], [path.join(dir, 'fakecli')]))
      assert.equal(found, exe)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns null when nothing matches', () => {
    const found = withPath([], () => findOnPath(['definitely-not-a-real-cli-name']))
    assert.equal(found, null)
  })
})

describe('windows/resolve-vendored-exe', async () => {
  // resolveVendoredExe: swap an npm .cmd/.ps1 shim for the real vendored .exe
  // inside the package (Node's spawn refuses .cmd/.bat without shell:true since
  // CVE-2024-27980, so SDKs given a shim path throw EINVAL). On POSIX the
  // function must be a strict passthrough.

  const IS_WIN = process.platform === 'win32'

  // dir/codex.cmd + the nested platform-package layout npm actually installs
  function makeShimLayout(root: string) {
    const shim = path.join(root, 'codex.cmd')
    fs.writeFileSync(shim, '@echo off\r\n')
    const vendorBin = path.join(
      root,
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin'
    )
    fs.mkdirSync(vendorBin, { recursive: true })
    const exe = path.join(vendorBin, 'codex.exe')
    fs.writeFileSync(exe, 'MZ')
    return { shim, exe }
  }

  test('passes non-shim paths through unchanged', () => {
    assert.equal(resolveVendoredExe('/usr/local/bin/codex', '@openai/codex', 'codex.exe'), '/usr/local/bin/codex')
    assert.equal(resolveVendoredExe(null, '@openai/codex', 'codex.exe'), null)
  })

  test('on POSIX, even a .cmd path passes through', { skip: IS_WIN }, () => {
    assert.equal(resolveVendoredExe('C:\\npm\\codex.cmd', '@openai/codex', 'codex.exe'), 'C:\\npm\\codex.cmd')
  })

  test('resolves an npm .cmd shim to the vendored exe', { skip: !IS_WIN }, () => {
    const root = temporaryDirectory('adk-shim-')
    try {
      const { shim, exe } = makeShimLayout(root)
      assert.equal(resolveVendoredExe(shim, '@openai/codex', 'codex.exe'), exe)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('returns the shim when no vendored exe exists', { skip: !IS_WIN }, () => {
    const root = temporaryDirectory('adk-shim-')
    try {
      const shim = path.join(root, 'codex.cmd')
      fs.writeFileSync(shim, '@echo off\r\n')
      assert.equal(resolveVendoredExe(shim, '@openai/codex', 'codex.exe'), shim)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
