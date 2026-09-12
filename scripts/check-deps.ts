#!/usr/bin/env node
interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
interface DepsProbe {
  manifest: Manifest
  treePresent: boolean
  installed: (name: string) => string | null
  lockMtime: number | null
  installedLockMtime: number | null
}
interface DepsAudit {
  treePresent: boolean
  missing: { name: string; range: string }[]
  mismatched: { name: string; range: string; version: string }[]
  stale: boolean
  ok: boolean
}
// check-deps.ts — assert node_modules matches package.json before a server starts.
//
// `make all` used to test only that node_modules EXISTS. That passes after any
// pull which adds a dependency: the tree is there, the new packages are not.
// Vite then starts and reports itself ready, because an unresolvable import only
// fails per request — so the dev server looks healthy while every page is broken
// ("Failed to resolve import @tanstack/react-query"). This checks what is
// actually installed instead, before anything starts.
//
// Two independent signals:
//   missing / mismatched — a package.json dependency is absent from
//             node_modules, or the installed version cannot satisfy the range
//   stale   — package-lock.json is newer than node_modules/.package-lock.json,
//             so a pull or merge changed the lockfile and nothing installed it
//
// Exit 1 when either fires, naming the fix. --install repairs a tree that merely
// drifted by running `npm install` and re-checking; a tree that is absent
// entirely is still sent to `make init`, which also sets up ttyd and checks the
// provider CLIs.
//
// Runs before every start, from the npm pre-hooks (predev / preserver / preweb /
// prebuild) so `npm run dev` is guarded as well as `make all`. Silent on a
// healthy tree; it only speaks when it repairs something or has to stop.
//
// Usage: node scripts/check-deps.ts [--install] [--verbose] [--json]
//   --install  run `npm install` to repair a drifted tree instead of only reporting
//   --verbose  confirm a healthy tree too (what `make deps` / `npm run check:deps` do)
//   --json     machine-readable audit instead of the report

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// npm writes package-lock.json and the hidden node_modules/.package-lock.json in
// the same install, so only a gap wider than this counts as a real lockfile edit.
const STALE_TOLERANCE_MS = 1000

export function parseVersion(value: string) {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(value)
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null
}

type Version = NonNullable<ReturnType<typeof parseVersion>>
const compareVersion = (a: Version, b: Version) => a.major - b.major || a.minor - b.minor || a.patch - b.patch

// Conservative: only ranges we fully understand may report a mismatch. A tag,
// url, git ref, alias or union is left to npm, so a deliberate override never
// blocks a start. Prerelease labels are ignored and the numeric release decides,
// which keeps `^1.2.0-beta.12` satisfied by the beta npm actually installed.
export function satisfiesRange(range: string, version: string): boolean {
  const installed = parseVersion(version)
  if (!installed) return true
  const match = /^(\^|~|>=|=)?(\d+\.\d+\.\d+)(?:[-+]\S*)?$/.exec(range.trim())
  const wanted = match && parseVersion(match[2])
  if (!wanted) return true
  const order = compareVersion(installed, wanted)
  switch (match?.[1]) {
    // ^ floats inside the leftmost non-zero component: major for 1.x and above,
    // minor while major is 0 (npm treats 0.x releases as breaking).
    case '^':
      return order >= 0 && (wanted.major > 0 ? installed.major === wanted.major : installed.major === 0 && installed.minor === wanted.minor)
    case '~':
      return order >= 0 && installed.major === wanted.major && installed.minor === wanted.minor
    case '>=':
      return order >= 0
    default:
      return order === 0
  }
}

export function auditDependencies(probe: DepsProbe): DepsAudit {
  const wanted = { ...probe.manifest.dependencies, ...probe.manifest.devDependencies }
  const missing: DepsAudit['missing'] = []
  const mismatched: DepsAudit['mismatched'] = []
  if (probe.treePresent)
    for (const name of Object.keys(wanted).sort((a, b) => a.localeCompare(b, 'en'))) {
      const range = wanted[name]
      const version = probe.installed(name)
      if (version === null) missing.push({ name, range })
      else if (!satisfiesRange(range, version)) mismatched.push({ name, range, version })
    }
  // An absent hidden lockfile says nothing about drift (a hand-built tree, or an
  // npm too old to write one) — the inventory above is the signal there.
  const stale =
    probe.treePresent && probe.lockMtime !== null && probe.installedLockMtime !== null && probe.lockMtime - probe.installedLockMtime > STALE_TOLERANCE_MS
  return { treePresent: probe.treePresent, missing, mismatched, stale, ok: probe.treePresent && !missing.length && !mismatched.length && !stale }
}

export function probeRoot(root: string): DepsProbe {
  const modules = path.join(root, 'node_modules')
  const mtime = (file: string) => {
    try {
      return fs.statSync(file).mtimeMs
    } catch {
      return null
    }
  }
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    treePresent: fs.existsSync(modules),
    installed: (name) => {
      try {
        // The package's own manifest, not a bare directory: npm leaves empty
        // directories behind when an install is interrupted.
        const version = JSON.parse(fs.readFileSync(path.join(modules, ...name.split('/'), 'package.json'), 'utf8')).version
        return typeof version === 'string' ? version : ''
      } catch {
        return null
      }
    },
    lockMtime: mtime(path.join(root, 'package-lock.json')),
    installedLockMtime: mtime(path.join(modules, '.package-lock.json')),
  }
}

export function reportAudit(audit: DepsAudit): string[] {
  if (audit.ok) return ['check-deps: dependencies match package.json']
  if (!audit.treePresent) return ["check-deps: node_modules is missing — run 'make init' first (npm deps + ttyd + provider CLI check)."]
  const lines: string[] = []
  const show = (items: { name: string; range: string }[]) => items.map((item) => `${item.name}@${item.range}`)
  if (audit.missing.length)
    lines.push(
      `check-deps: ${audit.missing.length} ${audit.missing.length === 1 ? 'dependency' : 'dependencies'} not installed: ${show(audit.missing).join(', ')}`
    )
  for (const item of audit.mismatched) lines.push(`check-deps: ${item.name} is ${item.version}, package.json wants ${item.range}`)
  if (audit.stale) lines.push('check-deps: package-lock.json changed since the last install (a pull or merge edited it)')
  lines.push("check-deps: node_modules is out of date — run 'npm install' (or 'make install') and start again.")
  return lines
}

// npm is a shell script on Windows, so it needs a shell to be spawnable.
export const npmInstall = (root: string) => spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status

export function run({ root = ROOT, install = false, json = false, verbose = false, log = console.log, probe = probeRoot, npm = npmInstall } = {}) {
  let audit = auditDependencies(probe(root))
  // A tree that only drifted is safe to repair here; an absent one belongs to
  // `make init`, which installs ttyd and checks the provider CLIs as well.
  if (!audit.ok && audit.treePresent && install) {
    // Report the findings, but not the trailing "run npm install" — we run it.
    for (const line of reportAudit(audit).slice(0, -1)) log(line)
    log('check-deps: installing the missing dependencies (npm install)')
    if (npm(root) !== 0) {
      log('check-deps: npm install failed — fix the error above, then start again.')
      return 1
    }
    audit = auditDependencies(probe(root))
    // npm refreshes the hidden lockfile even on a no-op install, so drift
    // normally clears here. If some npm ever stops doing that, the inventory is
    // authoritative — every dependency resolved, so start instead of looping.
    if (!audit.ok && audit.stale && !audit.missing.length && !audit.mismatched.length) {
      log('check-deps: install left the lockfile timestamps unchanged; every dependency resolves, continuing')
      audit = { ...audit, stale: false, ok: true }
    }
  }
  // Silent on success: this runs before every start, on both the make and the
  // npm path, so a healthy tree must add no noise. --verbose confirms it anyway.
  if (json) log(JSON.stringify(audit, null, 2))
  else if (!audit.ok || verbose) for (const line of reportAudit(audit)) log(line)
  return audit.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = new Set(process.argv.slice(2))
  process.exitCode = run({ install: argv.has('--install'), json: argv.has('--json'), verbose: argv.has('--verbose') })
}
