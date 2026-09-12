#!/usr/bin/env node
// Update every provider CLI AgentDeck tracks. `make update` runs it outright;
// `make all` passes --ask so the dev servers can start without waiting for
// three updaters: the question defaults to no, AGENTDECK_UPDATE=1 answers yes
// without asking, AGENTDECK_SKIP_UPDATE=1 skips everything, and a shell with no
// interactive terminal never blocks on a prompt. Best-effort by default: a
// missing binary or a failed update prints a warning and the servers still
// start. `--strict` turns warnings into a non-zero exit (for release checks).
//
// Each provider's own updater is used (they handle their install channel —
// native installer, npm, brew…), so AgentDeck never guesses a package name.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const PROVIDERS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', version: ['--version'], update: ['update'] },
  { id: 'codex', label: 'Codex', bin: 'codex', version: ['--version'], update: ['update'] },
  { id: 'antigravity', label: 'Antigravity', bin: 'agy', version: ['--version'], update: ['update'] },
]

const TIMEOUT_MS = Number(process.env.AGENTDECK_UPDATE_TIMEOUT || 180_000)

export interface UpdateDecision {
  run: boolean
  reason: string
}

// The environment answers first, then the person, then the safe default (no),
// so startup is never held by a question nobody is there to answer.
export async function decideUpdate({
  ask,
  env,
  interactive,
  prompt,
}: {
  ask: boolean
  env: NodeJS.ProcessEnv
  interactive: boolean
  prompt: (question: string) => Promise<string>
}): Promise<UpdateDecision> {
  if (env.AGENTDECK_SKIP_UPDATE === '1') return { run: false, reason: 'skipped (AGENTDECK_SKIP_UPDATE=1)' }
  if (!ask) return { run: true, reason: 'requested' }
  if (env.AGENTDECK_UPDATE === '1') return { run: true, reason: 'AGENTDECK_UPDATE=1' }
  if (!interactive) return { run: false, reason: 'skipped: no interactive terminal to ask (AGENTDECK_UPDATE=1 forces the update)' }
  const answer = (await prompt('Update provider CLIs (claude / codex / agy) before starting? [y/N] ')).trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
    ? { run: true, reason: 'answered yes' }
    : { run: false, reason: 'skipped: answered no (`make update` runs them any time)' }
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

// Runs every (or only the named) provider updater; returns the warning count.
export function updateProviders(only: string[] = []) {
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
  return warnings
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const decision = await decideUpdate({
    ask: args.includes('--ask'),
    env: process.env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: async (question) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await rl.question(question)
      } finally {
        rl.close()
      }
    },
  })
  if (!decision.run) {
    console.log(`update-providers: ${decision.reason}`)
    process.exit(0)
  }
  const warnings = updateProviders(args.filter((a) => !a.startsWith('--')))
  if (warnings && args.includes('--strict')) {
    console.error(`update-providers: ${warnings} warning(s) (strict mode)`)
    process.exit(1)
  }
}
