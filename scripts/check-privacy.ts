#!/usr/bin/env node
interface PrivacyRules {
  paths: RegExp[]
  allow: (string | RegExp)[]
}
// check-privacy.mjs — open-source hygiene gate.
//
// Scans every text file git would ship — tracked files plus untracked files
// that are not ignored (i.e. what `git add .` would pick up) — for personal
// data that must not leave the machine:
//   home-path   absolute home dirs: C:\Users\<name>, /Users/<name>, /home/<name>
//   home-slug   the same paths in Claude Code's project-slug form (C--Users-<name>-…)
//   email       e-mail addresses
//   api-key     key-looking strings: sk-…, sk-ant-…, ghp_/gho_/github_pat_…, AIza…,
//               AKIA…, xox…-…, PEM private-key headers
// and checks that a LICENSE file exists. Exit 1 on any finding.
//
// Allow-list: an optional `.privacyignore` at the repo root, one rule per line:
//   # comment
//   path:<glob>       skip matching files entirely (e.g. path:demo/**)
//   allow:<text>      ignore any match that contains this text (e.g. allow:@example.com)
//   allow:/<regex>/i  same, as a JS regular expression
// A bare line is treated as allow:<text>. Placeholder user names (<name>, <you>,
// you, username, $USER, %USERNAME%, …) are ignored by default; real ones never are.
//
// Usage: node scripts/check-privacy.ts [--tracked-only] [--quiet]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = new Set(process.argv.slice(2))
const TRACKED_ONLY = argv.has('--tracked-only')
const QUIET = argv.has('--quiet')

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mp4',
  '.webm',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.7z',
  '.jar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.node',
])

// user-name placeholders that documentation legitimately uses in example paths
const PLACEHOLDERS = new Set([
  '<name>',
  '<you>',
  '<user>',
  '<username>',
  '<your-name>',
  '<yourname>',
  '<USER>',
  '<USERNAME>',
  'you',
  'yourname',
  'your-name',
  'username',
  'USERNAME',
  '%USERNAME%',
  '$USER',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: This is a literal documented shell placeholder, not interpolation.
  '${USER}',
  '$env:USERNAME',
  'me',
  '...',
  '…',
])
const NAME = String.raw`([^\\\/\s"'\x60|*?:,;()[\]{}]+)` // one path segment; keeps <angle> placeholders intact
// `#` in the lookbehind: `#/home/<view>` is the app's own hash route, not a home dir
const PATTERNS = [
  { id: 'home-path', re: new RegExp(String.raw`\b[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+` + NAME, 'g'), name: 1 },
  { id: 'home-path', re: new RegExp(String.raw`(?<![\w.\-\\#])\/Users\/` + NAME, 'g'), name: 1 },
  { id: 'home-path', re: new RegExp(String.raw`(?<![\w.\-\\#])\/home\/` + NAME, 'g'), name: 1 },
  { id: 'home-slug', re: /\b[A-Za-z]--Users-([A-Za-z0-9._]+)/g, name: 1 },
  { id: 'home-slug', re: /(?<![\w-])-(?:Users|home)-([A-Za-z0-9._]+)/g, name: 1 },
  { id: 'email', re: /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g },
  { id: 'api-key', re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'api-key', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { id: 'api-key', re: /\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { id: 'api-key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: 'api-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'api-key', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'api-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
]
// `/home/linuxbrew` is Homebrew-on-Linux's fixed prefix, not a person's home
const DEFAULT_ALLOW = ['@example.com', '@example.org', '@example.net', 'noreply@', 'no-reply@', '@localhost', '/home/linuxbrew']

// --- .privacyignore ----------------------------------------------------------

function globToRe(glob: string) {
  let g = glob.replace(/\\/g, '/').replace(/^\.\//, '')
  if (g.endsWith('/')) g += '**'
  const s = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: These control characters are internal glob-parser sentinels, replaced before constructing the final regex.
    .replace(/\u0001/g, '(?:.*/)?')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: These control characters are internal glob-parser sentinels, replaced before constructing the final regex.
    .replace(/\u0002/g, '.*')
  return new RegExp(`^${s}$`)
}

function loadRules() {
  const rules: PrivacyRules = { paths: [], allow: [] }
  const file = path.join(ROOT, '.privacyignore')
  if (!fs.existsSync(file)) return rules
  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('path:')) {
      rules.paths.push(globToRe(line.slice(5).trim()))
      continue
    }
    const v = line.replace(/^allow:/, '').trim()
    const re = v.match(/^\/(.+)\/([a-z]*)$/)
    rules.allow.push(re ? new RegExp(re[1], re[2].replace('g', '')) : v)
  }
  return rules
}

// --- scan --------------------------------------------------------------------

function listFiles() {
  const args = ['ls-files', '-z', '--cached']
  if (!TRACKED_ONLY) args.push('--others', '--exclude-standard')
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .sort()
}

const isBinary = (file: string, buf: NonSharedBuffer) => BINARY_EXT.has(path.extname(file).toLowerCase()) || buf.subarray(0, 8000).includes(0)

function allowed(match: string, name: string | null | undefined, rules: PrivacyRules) {
  if (name != null && PLACEHOLDERS.has(name)) return true
  for (const a of [...DEFAULT_ALLOW, ...rules.allow]) if (a instanceof RegExp ? a.test(match) : match.includes(a)) return true
  return false
}

function scanFile(file: string, text: string, rules: PrivacyRules) {
  const findings = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const p of PATTERNS) {
      for (const m of lines[i].matchAll(p.re)) {
        if (allowed(m[0], p.name ? m[p.name] : null, rules)) continue
        findings.push({ file, line: i + 1, col: m.index + 1, kind: p.id, match: m[0] })
      }
    }
  }
  return findings
}

const rules = loadRules()
const findings = []
let scanned = 0
let skipped = 0
for (const file of listFiles()) {
  if (rules.paths.some((re) => re.test(file))) {
    skipped++
    continue
  }
  const abs = path.join(ROOT, file)
  let buf: Buffer<ArrayBuffer>
  try {
    if (!fs.statSync(abs).isFile()) continue // deleted in the worktree but still indexed, submodule, …
    buf = fs.readFileSync(abs)
  } catch {
    continue
  }
  if (isBinary(file, buf)) {
    skipped++
    continue
  }
  scanned++
  findings.push(...scanFile(file, buf.toString('utf8'), rules))
}

// --- license -----------------------------------------------------------------

const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'].find((f) => fs.existsSync(path.join(ROOT, f)))
const licenseLine = licenseFile
  ? (
      fs
        .readFileSync(path.join(ROOT, licenseFile), 'utf8')
        .split(/\r?\n/)
        .find((l) => l.trim()) || ''
    ).trim()
  : null

// --- report ------------------------------------------------------------------

if (!QUIET) {
  for (const f of findings) console.log(`${f.file}:${f.line}:${f.col}  [${f.kind}]  ${f.match}`)
  if (findings.length) console.log('')
}
const byKind = findings.reduce<Record<string, number>>((acc, f) => {
  acc[f.kind] = (acc[f.kind] || 0) + 1
  return acc
}, {})
const files = new Set(findings.map((f) => f.file)).size
console.log(`scanned ${scanned} text file(s), skipped ${skipped} (binary / path: rules)${TRACKED_ONLY ? ', tracked only' : ', tracked + untracked-unignored'}`)
console.log(licenseFile ? `LICENSE: ok (${licenseFile}: ${licenseLine})` : 'LICENSE: MISSING — add one before publishing')
if (findings.length) {
  const parts = Object.entries(byKind)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
  console.log(`check-privacy: FAIL — ${findings.length} finding(s) in ${files} file(s): ${parts}`)
  console.log('  fix the content, or for placeholders add an allow:/path: rule to .privacyignore')
} else {
  console.log('check-privacy: ok — no home paths, e-mails or key-looking strings')
}
process.exit(findings.length || !licenseFile ? 1 : 0)
