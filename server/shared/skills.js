import { spawn } from 'node:child_process'

// Skill import is delegated to the official `skills` CLI (vercel-labs/skills) —
// the same tool you'd run as `npx skills add <ref>`. We don't reimplement GitHub
// fetching; the CLI resolves and installs the skill. This DOES execute an
// external program on the user's machine — it only runs after the UI confirms.
// Provider behavior is supplied via `config`:
//   { agent, envKey, forceAgent?, beforeRun?(ctx), afterRun?(ctx, pre) -> string }
// beforeRun/afterRun let a provider snapshot+relocate post-install (see codex).

function err(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

const RUN_TIMEOUT_MS = 180_000
const MAX_OUTPUT = 200_000

// Minimal quote-aware tokenizer (handles "..." and '...'). No shell is involved —
// the result is passed to spawn() as an argv array, so there is no shell injection.
function tokenize(s) {
  const out = []
  let cur = ''
  let quote = null
  let started = false
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started || cur) {
        out.push(cur)
        cur = ''
        started = false
      }
    } else {
      cur += ch
      started = true
    }
  }
  if (started || cur) out.push(cur)
  return out
}

// Turn what the user typed (a bare ref, or a full `npx skills add ...` command)
// into the argv after `skills add`. `forceAgent` strips any user-supplied
// -a/--agent so the provider's own agent flag always wins.
export function parseSkillsAdd(input, { forceAgent = false } = {}) {
  let s = (input || '').trim()
  if (!s) throw err(400, 'empty reference')
  if (/[\n\r\t]/.test(s)) throw err(400, 'invalid characters in reference')
  s = s
    .replace(/^npx\s+(?:-y\s+|--yes\s+)?/i, '')
    .replace(/^(?:skills|add-skill)\s+/i, '')
    .replace(/^add\s+/i, '')
    .trim()
  const args = tokenize(s)
  const ref = args.find((a) => a && !a.startsWith('-'))
  if (!ref) throw err(400, 'no skill source given (e.g. owner/repo)')
  const looksOk =
    /^[\w.-]+\/[\w.-]+(\/.+)?$/.test(ref) || /^(https?:\/\/|git@)/.test(ref) || ref.startsWith('./') || ref.startsWith('../')
  if (!looksOk) throw err(400, `does not look like a skill source: ${ref}`)
  if (!forceAgent) return args
  const cleaned = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-a' || args[i] === '--agent') {
      i++ // skip its value too
      continue
    }
    if (/^--agent=/.test(args[i])) continue
    cleaned.push(args[i])
  }
  return cleaned
}

// `-a <agent>` targets the CLI, `-y` skips prompts, `-g` installs to the user dir.
export function buildSkillsArgv(args, { global, agent } = {}) {
  const argv = ['-y', 'skills', 'add', ...args, '-a', agent]
  if (global) argv.push('-g')
  argv.push('-y')
  return argv
}

// Strip ANSI escapes / collapse spinner frames so captured output reads cleanly.
function cleanOutput(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, (m) => (/\?/.test(m) ? '' : /[0-9GDJKHf]$/.test(m) ? '\n' : ''))
    .replace(/[\r\x1b]/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, a) => !(l.trim() && l === a[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Run `npx skills add ...` in cwd. Buffers stdout+stderr, resolves on exit.
// stdin closed (a stray prompt fails fast), hard-timeout backstop.
export function runSkillsAdd({ cwd, args, global, configDir, config }) {
  const argv = buildSkillsArgv(args, { global, agent: config.agent })
  const command = `npx ${argv.join(' ')}`
  // The skills CLI resolves the install dir from the provider's env key. User
  // scope: pin it to the tracked root so `-g` lands in <root>/skills. Project
  // scope: drop it so the install stays cwd-relative and never follows a stray value.
  const env = { ...process.env, npm_config_yes: 'true', NO_COLOR: '1' }
  if (configDir) env[config.envKey] = configDir
  else delete env[config.envKey]
  const pre = config.beforeRun ? config.beforeRun({ global, configDir }) : null
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn('npx', argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return resolve({ ok: false, command, code: null, output: `failed to start npx: ${e.message}` })
    }
    let out = ''
    const onData = (b) => {
      if (out.length < MAX_OUTPUT) out += b.toString()
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {}
      out += '\n\n[timed out after 180s — for a multi-skill repo, add --skill <name> or --all]'
    }, RUN_TIMEOUT_MS)
    proc.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, command, code: null, output: cleanOutput(`${out}\n${e.message}`) })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      let output = cleanOutput(out).slice(0, MAX_OUTPUT) || '(no output)'
      if (code === 0 && config.afterRun) {
        const extra = config.afterRun({ global, configDir }, pre)
        if (extra) output += extra
      }
      resolve({ ok: code === 0, command, code, output })
    })
  })
}
