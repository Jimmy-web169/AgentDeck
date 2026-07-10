// statusline-bridge.mjs: writes <config_dir>/rate-limits.json from the status
// line payload and chains the user's original command unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BRIDGE = fileURLToPath(new URL('../scripts/statusline-bridge.mjs', import.meta.url))

function runBridge(input, args = []) {
  return spawnSync(process.execPath, [BRIDGE, ...args], { input, encoding: 'utf8' })
}

function makeCfg() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-bridge-'))
  fs.mkdirSync(path.join(cfg, 'projects', 'x'), { recursive: true })
  return cfg
}

function payload(cfg) {
  return JSON.stringify({
    transcript_path: path.join(cfg, 'projects', 'x', 'y.jsonl'),
    session_id: 'test',
    context_window: { used_percentage: 42 },
    rate_limits: { five_hour: { used_percentage: 10 } },
  })
}

test('writes rate-limits.json next to the projects dir', () => {
  const cfg = makeCfg()
  try {
    const r = runBridge(payload(cfg))
    assert.equal(r.status, 0)
    const snap = JSON.parse(fs.readFileSync(path.join(cfg, 'rate-limits.json'), 'utf8'))
    assert.equal(snap.session_id, 'test')
    assert.equal(snap.context_window.used_percentage, 42)
    assert.equal(snap.rate_limits.five_hour.used_percentage, 10)
    assert.ok(Number.isInteger(snap.updated_at))
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true })
  }
})

test('tolerates a UTF-8 BOM (PowerShell pipes prepend one)', () => {
  const cfg = makeCfg()
  try {
    runBridge('﻿' + payload(cfg))
    assert.ok(fs.existsSync(path.join(cfg, 'rate-limits.json')))
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true })
  }
})

test('chains the original command and forwards its output', () => {
  const cfg = makeCfg()
  try {
    const orig = 'echo original-statusline-output'
    const b64 = Buffer.from(orig, 'utf8').toString('base64')
    const r = runBridge(payload(cfg), [b64])
    assert.match(r.stdout, /original-statusline-output/)
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true })
  }
})

test('malformed payload neither crashes nor writes', () => {
  const cfg = makeCfg()
  try {
    const r = runBridge('this is not json')
    assert.equal(r.status, 0)
    assert.ok(!fs.existsSync(path.join(cfg, 'rate-limits.json')))
  } finally {
    fs.rmSync(cfg, { recursive: true, force: true })
  }
})
