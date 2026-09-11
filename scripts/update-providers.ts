#!/usr/bin/env node
// Update every provider CLI AgentDeck tracks, before `make all` starts the
// servers. Best-effort by default: a missing binary or a failed update prints a
// warning and the dev servers still start. `--strict` turns warnings into a
// non-zero exit (for release checks); AGENTDECK_SKIP_UPDATE=1 skips everything.
//
// Each provider's own updater is used (they handle their install channel —
// native installer, npm, brew…), so AgentDeck never guesses a package name.
import { spawnSync } from 'node:child_process'

const PROVIDERS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', version: ['--version'], update: ['update'] },
  { id: 'codex', label: 'Codex', bin: 'codex', version: ['--version'], update: ['update'] },
  { id: 'antigravity', label: 'Antigravity', bin: 'agy', version: ['--version'], update: ['update'] },
]

const strict = process.argv.includes('--strict')
const only = process.argv.filter((a) => !a.startsWith('--')).slice(2)
const TIMEOUT_MS = Number(process.env.AGENTDECK_UPDATE_TIMEOUT || 180_000)

if (process.env.AGENTDECK_SKIP_UPDATE === '1') {
  console.log('update-providers: skipped (AGENTDECK_SKIP_UPDATE=1)')
  process.exit(0)
}

const run = (bin: string, args: readonly string[], timeout = 15_000) => {
  // shell:true resolves .cmd / .exe shims on Windows the same way a terminal does
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: true, timeout, windowsHide: true })
  return {
    ok: r.status === 0,
    out: `${r.stdout || ''}${r.stderr || ''}`.trim(),
    missing:
      (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' || (/not recognized|not found|No such file/i.test(r.stderr || '') && r.status !== 0),
  }
}
const firstLine = (s: string) => (s || '').split(/\r?\n/).find((l: string) => l.trim()) || ''

let warnings = 0
for (const p of PROVIDERS) {
  if (only.length && !only.includes(p.id)) continue
  const before = run(p.bin, p.version)
  if (!before.ok) {
    console.log(`  ${p.label.padEnd(12)} not installed (skipped) — ${firstLine(before.out) || 'binary not found'}`)
    warnings++
    continue
  }
  process.stdout.write(`  ${p.label.padEnd(12)} ${firstLine(before.out)}  → updating… `)
  const up = run(p.bin, p.update, TIMEOUT_MS)
  const after = run(p.bin, p.version)
  if (!up.ok) {
    warnings++
    console.log(`failed\n    ${firstLine(up.out) || 'no output'}`)
    continue
  }
  const a = firstLine(after.out)
  console.log(a === firstLine(before.out) ? 'already latest' : `now ${a}`)
}

if (warnings && strict) {
  console.error(`update-providers: ${warnings} warning(s) (strict mode)`)
  process.exit(1)
}
