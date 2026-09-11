#!/usr/bin/env node
interface CheckRow {
  kind: string
  name: string
  binary: string | null
  version: string | null
  checks: { what: string; ok: boolean; detail: string; info?: string }[]
  fatal: boolean
  note: string
}
// check-providers.mjs — pre-release gate for the CLIs AgentDeck drives.
//
// For every provider under server/providers/<id>/ this reads the TERMINAL_CONFIG
// literal in data.js — the binary names handed to findOnPath() and the resumeArgs
// argv — locates the binary exactly the way the server does, then runs ONLY
//   <bin> --version, <bin> --help, <bin> <subcommand> --help
// (never anything that starts a session) and asserts every flag / subcommand
// AgentDeck passes still appears in the help text.
//
// It also checks the terminal plumbing the resume path runs through: tmux (psmux
// on Windows — its `list-commands` prints no flag signatures, so only the command
// names are verifiable there), ttyd on macOS/Linux and the node-pty module behind
// webterm.js on Windows. Plumbing that is absent is reported, not fatal (AgentDeck
// monitors read-only without it); plumbing that is present but lost a flag IS fatal.
//
// Exit 1 when a provider binary is missing or a flag/subcommand disappeared.
//
// Usage: node scripts/check-providers.ts [--skills] [--json]
//   --skills  also probe the `skills` CLI the skill installer runs
//             (`npx -y skills add --help`) — that downloads the package on first
//             use, so it is opt-in.
//   --json    machine-readable rows instead of the table.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { findOnPath, findTmux, findTtyd } from '../server/shared/terminal.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'
const argv = new Set(process.argv.slice(2))
const WANT_JSON = argv.has('--json')
const WANT_SKILLS = argv.has('--skills')

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const strings = (s: string | undefined) => [...(s || '').matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2])

// --- what the server drives: parsed from each provider's TERMINAL_CONFIG -----

function providerIds() {
  const dir = path.join(ROOT, 'server', 'providers')
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'api.ts')))
    .map((d) => d.name)
    .sort()
}

// TERMINAL_CONFIG is a module-private literal in data.js (importing the module
// would drag in the whole provider data layer), so read the two fields we need
// off the source. Fails loudly if the shape changes, which is itself a signal.
function readTerminalConfig(id: string) {
  const file = path.join(ROOT, 'server', 'providers', id, 'data.ts')
  const src = fs.readFileSync(file, 'utf8')
  const block = src.match(/TERMINAL_CONFIG\s*=\s*\{([\s\S]*?)\n\}/)
  if (!block) throw new Error(`${rel(file)}: no TERMINAL_CONFIG literal — update readTerminalConfig() in ${rel(fileURLToPath(import.meta.url))}`)
  const body = block[1]

  const fb = body.match(/findOnPath\(\s*\[([^\]]*)\]\s*(?:,\s*\[([\s\S]*?)\]\s*)?\)/)
  if (!fb) throw new Error(`${rel(file)}: TERMINAL_CONFIG.findBin does not call findOnPath([...])`)
  const names = strings(fb[1])
  // fallback candidates: path.join(os.homedir(), '<x>') → ~/<x>; plain literals as-is
  const extra = []
  const restOfExtra = (fb[2] || '').replace(/path\.join\(\s*os\.homedir\(\)\s*,\s*(['"])([^'"]+)\1\s*\)/g, (_m, _q, p) => {
    extra.push(path.join(os.homedir(), p))
    return ''
  })
  extra.push(...strings(restOfExtra))

  const ra = body.match(/resumeArgs\s*:\s*\(\s*(\w+)\s*(?::\s*string)?\s*\)\s*=>\s*\[([^\]]*)\]/)
  if (!ra) throw new Error(`${rel(file)}: TERMINAL_CONFIG.resumeArgs is not of the form (id) => [...]`)
  const param = ra[1]
  const resumeArgs = ra[2]
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t === param ? '<id>' : (strings(t)[0] ?? t)))

  const title = strings(body.match(/\btitle\s*:\s*((['"`]).*?\2)/)?.[1])[0] || id
  const envKey = strings(body.match(/\benvKey\s*:\s*((['"`]).*?\2)/)?.[1])[0] || null
  // promptArgs (AI hand-off): (p) => [...]; only its flag tokens can be checked against --help
  const pa = body.match(/promptArgs\s*:\s*\(\s*(\w+)\s*(?::\s*string)?\s*\)\s*=>\s*\[([^\]]*)\]/)
  const promptFlags = pa
    ? pa[2]
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && t !== pa[1])
        .map((t) => strings(t)[0] ?? t)
        .filter((t) => t.startsWith('-'))
    : []
  return { id, file: rel(file), names, extra, resumeArgs, promptFlags, title, envKey }
}

// --- running the CLIs (help/version only) ----------------------------------

function run(bin: string, args: string[], { timeout = 20_000 } = {}) {
  // npm globals on Windows are .cmd shims — Node spawns those only through a shell (CVE-2024-27980)
  const shell = IS_WIN && /\.(cmd|bat)$/i.test(bin)
  const r = spawnSync(shell ? `"${bin}"` : bin, args, {
    encoding: 'utf8',
    shell,
    timeout,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' },
  })
  const out = stripVTControlCharacters(`${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`)
  return { code: r.status, out, error: r.error ? r.error.message : null }
}

const versionOf = (out: string) => (out.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/) || [null])[0]

// `--resume` / `-p` must appear as an option token in the help text
const hasFlag = (help: string, flag: string) => new RegExp(`(^|[\\s,\\[(|])${esc(flag)}(?=$|[\\s,=\\]\\[<>|).])`, 'm').test(help)
// `resume` must be listed as a subcommand: a line that starts with the bare word
const hasSubcommand = (help: string, sub: string) => new RegExp(`^\\s{1,8}${esc(sub)}(?:\\s{2,}|,|\\s*$|\\s+[\\[<(])`, 'm').test(help)

function checkProvider(cfg: ReturnType<typeof readTerminalConfig>) {
  const row: CheckRow = { kind: 'provider', name: cfg.id, binary: null, version: null, checks: [], fatal: false, note: cfg.envKey ? `env ${cfg.envKey}` : '' }
  const bin = findOnPath(cfg.names, cfg.extra)
  if (!bin) {
    row.fatal = true
    row.note = `not found — looked for ${cfg.names.join(' / ')} on PATH${cfg.extra.length ? ` and ${cfg.extra.join(', ')}` : ''}`
    return row
  }
  row.binary = bin

  const v = run(bin, ['--version'])
  row.version = v.error ? null : versionOf(v.out)
  row.checks.push({ what: '--version', ok: !!row.version, detail: v.error || (row.version ? '' : `no version in: ${v.out.trim().slice(0, 80)}`) })

  const h = run(bin, ['--help'])
  const helpOk = !h.error && /\S/.test(h.out)
  row.checks.push({ what: '--help', ok: helpOk, detail: h.error || (helpOk ? '' : 'no output') })

  // the hand-off seed flag (`agy -i`), when the CLI has one
  for (const tok of cfg.promptFlags || [])
    row.checks.push({ what: `${tok} (hand-off)`, ok: helpOk && hasFlag(h.out, tok), detail: helpOk ? 'flag not in --help' : 'no help text' })
  for (const tok of cfg.resumeArgs) {
    if (tok === '<id>') continue
    if (tok.startsWith('-')) {
      row.checks.push({ what: tok, ok: helpOk && hasFlag(h.out, tok), detail: helpOk ? 'flag not in --help' : 'no help text' })
      continue
    }
    // a bare word is a subcommand (`codex resume <id>`): listed in --help, and its
    // own --help must show a positional for the session id
    const listed = helpOk && hasSubcommand(h.out, tok)
    row.checks.push({ what: tok, ok: listed, detail: 'subcommand not listed in --help' })
    if (!listed) continue
    const sh = run(bin, [tok, '--help'])
    const subOk = !sh.error && sh.code === 0 && /usage/i.test(sh.out)
    row.checks.push({ what: `${tok} --help`, ok: subOk, detail: sh.error || `exit ${sh.code}` })
    const usage = (sh.out.match(/^\s*usage:.*$/gim) || []).join(' ').replace(/\[options\]/gi, '')
    const positional = /[[<][^\]>]+[\]>]/.test(usage)
    row.checks.push({ what: `${tok} <id>`, ok: subOk && positional, detail: `no positional in: ${usage.trim().slice(0, 80)}` })
  }
  row.fatal = row.checks.some((c) => !c.ok)
  return row
}

// --- terminal plumbing -------------------------------------------------------

// tmux argv terminal.js builds (new-session -A -s -e -c … / kill-session -t /
// list-sessions -F / show-environment -t)
const TMUX_USED: [string, string[]][] = [
  ['new-session', ['-A', '-s', '-e', '-c']],
  ['kill-session', ['-t']],
  ['list-sessions', ['-F']],
  ['show-environment', ['-t']],
]

function checkTmux() {
  const row: CheckRow = { kind: 'plumbing', name: IS_WIN ? 'tmux (psmux)' : 'tmux', binary: findTmux(), version: null, checks: [], fatal: false, note: '' }
  if (!row.binary) {
    row.note = 'not found — optional: terminals run, but without persistence / attach'
    return row
  }
  const v = run(row.binary, ['-V'])
  row.version = versionOf(v.out)
  row.checks.push({ what: '-V', ok: !!row.version, detail: v.error || v.out.trim().slice(0, 80) })
  const lines = run(row.binary, ['list-commands']).out.split(/\r?\n/)
  for (const [cmd, used] of TMUX_USED) {
    const line = lines.find((l) => new RegExp(`^\\s*${esc(cmd)}(?:\\s|\\()`).test(l))
    row.checks.push({ what: cmd, ok: !!line, detail: 'not in list-commands' })
    if (!line) continue
    // real tmux prints signatures: `new-session (new) [-AdDEPX] [-c start-directory] …`
    const letters = [...line.matchAll(/(?<=[\s[])-([A-Za-z]+)\b/g)].flatMap((m) => m[1].split(''))
    if (!letters.length) {
      row.checks.push({ what: `${cmd} ${used.join(' ')}`, ok: true, detail: '', info: 'flags not printed by list-commands (psmux) — not verifiable' })
      continue
    }
    for (const f of used) row.checks.push({ what: `${cmd} ${f}`, ok: letters.includes(f.slice(1)), detail: `flag not in: ${line.trim()}` })
  }
  row.fatal = row.checks.some((c) => !c.ok)
  return row
}

function checkTtyd() {
  const bin = IS_WIN ? findOnPath(['ttyd']) : findTtyd()
  const row: CheckRow = {
    kind: 'plumbing',
    name: 'ttyd',
    binary: bin,
    version: null,
    checks: [],
    fatal: false,
    note: IS_WIN ? 'not used on win32 (webterm.js serves the terminal)' : '',
  }
  if (!bin) {
    if (!IS_WIN) row.note = 'not found — terminal mode needs it on macOS/Linux (brew install ttyd / apt install ttyd)'
    return row
  }
  const v = run(bin, ['--version'])
  row.version = versionOf(v.out)
  row.checks.push({ what: '--version', ok: !!row.version, detail: v.error || v.out.trim().slice(0, 80) })
  const h = run(bin, ['--help'])
  // ttyd -p <port> -i 127.0.0.1 -W [-O] -t titleFixed=… <command>
  for (const f of ['-p', '-i', '-W', '-O', '-t']) row.checks.push({ what: f, ok: hasFlag(h.out, f), detail: 'flag not in --help' })
  row.fatal = !IS_WIN && row.checks.some((c) => !c.ok)
  return row
}

async function checkNodePty() {
  const pkg = '@lydell/node-pty'
  const row: CheckRow = {
    kind: 'plumbing',
    name: 'webterm (node-pty)',
    binary: `${pkg}-${process.platform}-${process.arch}`,
    version: null,
    checks: [],
    fatal: false,
    note: IS_WIN ? '' : 'not used off win32 (ttyd serves the terminal)',
  }
  try {
    row.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8')).version
  } catch {}
  try {
    const m = await import(pkg)
    row.checks.push({ what: 'import', ok: typeof m.spawn === 'function', detail: 'module loaded but has no spawn()' })
  } catch (e) {
    row.checks.push({ what: 'import', ok: false, detail: String(e instanceof Error ? e.message : e).split('\n')[0] })
  }
  row.fatal = IS_WIN && row.checks.some((c) => !c.ok)
  return row
}

// `npx -y skills add <ref> -a <agent> [-g] -y` (server/shared/skills.ts)
function checkSkills() {
  const row: CheckRow = { kind: 'plumbing', name: 'skills (npx)', binary: 'npx skills', version: null, checks: [], fatal: false, note: '' }
  const npx = IS_WIN ? 'npx.cmd' : 'npx'
  const v = run(npx, ['-y', 'skills', '--version'], { timeout: 120_000 })
  row.version = versionOf(v.out)
  row.checks.push({ what: '--version', ok: !!row.version, detail: v.error || v.out.trim().slice(0, 80) })
  const h = run(npx, ['-y', 'skills', 'add', '--help'], { timeout: 120_000 })
  row.checks.push({ what: 'add', ok: hasSubcommand(h.out, 'add'), detail: 'subcommand not in help' })
  for (const f of ['-a', '-g', '-y']) row.checks.push({ what: `add ${f}`, ok: hasFlag(h.out, f), detail: 'flag not in help' })
  row.fatal = row.checks.some((c) => !c.ok)
  return row
}

// --- report ------------------------------------------------------------------

function statusOf(r: CheckRow) {
  if (r.fatal) return 'FAIL'
  if (!r.checks.length) return 'skip'
  return r.checks.some((c) => !c.ok) ? 'WARN' : 'ok'
}

function flagsCell(r: CheckRow) {
  if (!r.checks.length) return '-'
  const bad = r.checks.filter((c) => !c.ok)
  if (bad.length) return `MISSING: ${bad.map((c) => c.what).join(', ')}`
  return `ok: ${r.checks.map((c) => c.what).join(' ')}`
}

function printTable(rows: CheckRow[]) {
  const head = ['provider / tool', 'binary', 'version', 'flags', 'status']
  const cells = rows.map((r) => [r.name, r.binary || '-', r.version || '-', flagsCell(r), statusOf(r)])
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (c: string[]) =>
    c
      .map((x: string, i: number) => x.padEnd(w[i]))
      .join('  ')
      .trimEnd()
  console.log(line(head))
  console.log(w.map((n) => '-'.repeat(n)).join('  '))
  for (const c of cells) console.log(line(c))
  const notes = []
  for (const r of rows) {
    if (r.note) notes.push(`${r.name}: ${r.note}`)
    for (const c of r.checks) {
      if (!c.ok) notes.push(`${r.name}: ${c.what} — ${c.detail || 'failed'}`)
      else if (c.info) notes.push(`${r.name}: ${c.what} — ${c.info}`)
    }
  }
  if (notes.length) {
    console.log('')
    for (const n of notes) console.log(`  ${n}`)
  }
}

const rows = []
for (const id of providerIds()) rows.push(checkProvider(readTerminalConfig(id)))
rows.push(checkTmux(), checkTtyd(), await checkNodePty())
if (WANT_SKILLS) rows.push(checkSkills())

if (WANT_JSON) console.log(JSON.stringify(rows, null, 2))
else printTable(rows)

const failed = rows.filter((r) => r.fatal)
if (!WANT_JSON) {
  console.log('')
  console.log(
    failed.length
      ? `check-providers: FAIL (${failed.map((r) => r.name).join(', ')})`
      : `check-providers: ok (${process.platform}-${process.arch}, node ${process.version})`
  )
}
process.exit(failed.length ? 1 : 0)
