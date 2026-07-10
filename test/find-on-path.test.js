// findOnPath: PATH discovery with Windows extension handling and the
// node_modules/.bin exclusion (the embedded terminal must never run a
// project-bundled CLI like the codex SDK's old `codex`).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findOnPath } from '../server/shared/terminal.js'

const IS_WIN = process.platform === 'win32'

function makeExe(dir, name) {
  const file = path.join(dir, IS_WIN ? `${name}.cmd` : name)
  fs.writeFileSync(file, IS_WIN ? '@echo off\r\n' : '#!/bin/sh\n')
  if (!IS_WIN) fs.chmodSync(file, 0o755)
  return file
}

function withPath(dirs, fn) {
  const saved = process.env.PATH
  process.env.PATH = dirs.join(path.delimiter)
  try {
    return fn()
  } finally {
    process.env.PATH = saved
  }
}

test('finds an executable on PATH (with the platform extension)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-path-'))
  const exe = makeExe(dir, 'fakecli')
  try {
    const found = withPath([dir], () => findOnPath(['fakecli']))
    assert.equal(found, exe)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('skips node_modules/.bin entries on PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-path-'))
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-path-'))
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
