// resolveVendoredExe: swap an npm .cmd/.ps1 shim for the real vendored .exe
// inside the package (Node's spawn refuses .cmd/.bat without shell:true since
// CVE-2024-27980, so SDKs given a shim path throw EINVAL). On POSIX the
// function must be a strict passthrough.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveVendoredExe } from '../../server/shared/terminal.js'

const IS_WIN = process.platform === 'win32'

// dir/codex.cmd + the nested platform-package layout npm actually installs
function makeShimLayout(root) {
  const shim = path.join(root, 'codex.cmd')
  fs.writeFileSync(shim, '@echo off\r\n')
  const vendorBin = path.join(
    root,
    'node_modules', '@openai', 'codex',
    'node_modules', '@openai', 'codex-win32-x64',
    'vendor', 'x86_64-pc-windows-msvc', 'bin'
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-shim-'))
  try {
    const { shim, exe } = makeShimLayout(root)
    assert.equal(resolveVendoredExe(shim, '@openai/codex', 'codex.exe'), exe)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('returns the shim when no vendored exe exists', { skip: !IS_WIN }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-shim-'))
  try {
    const shim = path.join(root, 'codex.cmd')
    fs.writeFileSync(shim, '@echo off\r\n')
    assert.equal(resolveVendoredExe(shim, '@openai/codex', 'codex.exe'), shim)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
