#!/usr/bin/env node
// AgentDeck status line bridge (wrapper) — cross-platform Node version.
// Windows has no bash/jq for the .sh variant, and Node is guaranteed for
// AgentDeck users, so this is the wrapper the onboard-usage-bar skill installs
// on native Windows (it works on macOS/Linux too).
//
// Writes rate_limits/context_window to <config_dir>/rate-limits.json (what
// AgentDeck reads), then runs the user's ORIGINAL status line command unchanged
// — passed base64-encoded as the first argument so quotes/spaces survive.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

let input = ''
try {
  input = fs.readFileSync(0, 'utf8')
} catch {}
if (input.charCodeAt(0) === 0xfeff) input = input.slice(1) // PowerShell pipes prepend a BOM

try {
  const data = JSON.parse(input)
  const tp = String(data.transcript_path || '')
  // <config_dir>/projects/<slug>/<session>.jsonl -> <config_dir>
  const cut = tp.search(/[\\/]projects[\\/]/)
  if (cut > 0) {
    const cfg = tp.slice(0, cut)
    if (fs.existsSync(cfg)) {
      const snap = {
        rate_limits: data.rate_limits ?? null,
        context_window: data.context_window ?? null,
        session_id: data.session_id ?? null,
        updated_at: Math.floor(Date.now() / 1000),
      }
      fs.writeFileSync(path.join(cfg, 'rate-limits.json'), JSON.stringify(snap))
    }
  }
} catch {} // never let the bridge break the user's status line

const b64 = process.argv[2]
if (b64) {
  try {
    const orig = Buffer.from(b64, 'base64').toString('utf8').trim()
    if (orig) {
      let r
      if (process.platform === 'win32') {
        // Status line commands are usually POSIX-style (e.g. ~/.claude/statusline.sh);
        // Claude Code on Windows ships with Git Bash, so prefer it, cmd.exe as fallback.
        r = spawnSync('bash', ['-c', orig], { input, encoding: 'utf8' })
        if (r.error) r = spawnSync('cmd.exe', ['/d', '/s', '/c', orig], { input, encoding: 'utf8', windowsVerbatimArguments: true })
      } else {
        r = spawnSync('/bin/sh', ['-c', orig], { input, encoding: 'utf8' })
      }
      if (r.stdout) process.stdout.write(r.stdout)
    }
  } catch {}
}
