import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { Root } from '../../shared/types.d.ts'
export { configDir } from './state.ts'

// Shared tracked-roots manager. A "root" is a tracked config home (e.g. a
// Claude/Codex home dir). Root management is identical across providers; the
// provider only supplies where its config file lives, how to auto-detect roots,
// and how to probe a root for "has data". Each provider's paths module wraps
// makeRoots() and re-exports the result, so callers import roots fns from there.

export const HOME = os.homedir()

// Where the per-provider `roots.<id>.json` files live. Default: the repo root
// (next to package.json). `AGENTDECK_CONFIG_DIR=<dir>` points every provider
// at another directory — the demo fixture (scripts/demo/make-fixture.ts)
// relies on it to serve a synthetic data root instead of the real homes.
// Read lazily (not at import) so tests can flip the variable per case.
// An explicit config dir is authoritative: no autodetected seed, and the
// built-in default roots (~/.claude, ~/.codex) are NOT re-added — otherwise a
// demo run would quietly list the user's real homes next to the fixture.
export const isolatedConfig = () => !!process.env.AGENTDECK_CONFIG_DIR?.trim()

export function expandHome(p: string) {
  if (!p) return p
  if (p === '~') return HOME
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2))
  return p
}

export function idFor(dir: string) {
  return crypto.createHash('sha256').update(dir).digest('hex').slice(0, 10)
}

export function dirExists(dir: string) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

export function httpish(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

export function assertInside(rootDir: string, target: string) {
  const rel = path.relative(rootDir, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw httpish(403, 'Path escapes root')
  return target
}

// config:
//   configPath          — JSON file persisting the user's tracked roots; a string,
//                         or a function returning one (evaluated per call, so an
//                         AGENTDECK_CONFIG_DIR override is honoured live)
//   autodetectSeed()    — Root[] to seed on first run (env vars + default home)
//   defaultRoots?()     — built-in roots always kept present (e.g. ~/.claude, ~/.codex)
//   dataProbe(dir)      — extra UI flags merged into rootsWithMeta (e.g. { hasProjects })
//   onRootsChanged?(dir)— called after add/remove (e.g. to invalidate an index)
interface RootsConfig<Meta extends Record<string, unknown>> {
  configPath: string | (() => string)
  autodetectSeed(): Root[]
  defaultRoots?(): Root[]
  dataProbe(dir: string): Meta
  onRootsChanged?(dir: string): void
}
export function makeRoots<Meta extends Record<string, unknown>>({ configPath, autodetectSeed, defaultRoots, dataProbe, onRootsChanged }: RootsConfig<Meta>) {
  const cfgPath = () => (typeof configPath === 'function' ? configPath() : configPath)
  const readConfig = (): Root[] | null => {
    try {
      const arr: unknown = JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))
      // Application-owned configuration is written only by this module.
      // Preserve the legacy read/fallback behavior; native parser inputs are
      // narrowed separately at their provider boundary.
      if (Array.isArray(arr) && arr.length) return arr as Root[]
    } catch {}
    return null
  }
  const writeConfig = (arr: Root[]) => {
    const file = cfgPath()
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, JSON.stringify(arr, null, 2))
  }

  function loadRoots() {
    let cfg = readConfig()
    if (!cfg) {
      if (isolatedConfig()) return [] // explicit config dir, no file → nothing tracked; never seed
      cfg = autodetectSeed()
      try {
        writeConfig(cfg)
      } catch {}
    } else if (defaultRoots && !isolatedConfig()) {
      // always keep the built-in default roots present (e.g. ~/.claude, ~/.codex),
      // so they're there out of the box even if the config file omits them
      const have = new Set(cfg.map((r) => r.dir))
      let changed = false
      for (const d of defaultRoots()) {
        if (!have.has(d.dir)) {
          cfg.push(d)
          changed = true
        }
      }
      if (changed)
        try {
          writeConfig(cfg)
        } catch {}
    }
    return cfg
  }
  // Display label: a custom label is kept verbatim; a label that is just the
  // directory (the default roots) is shown home-relative ("~/.claude",
  // "~\.claude" on Windows) so the UI never has to fit a full absolute path.
  const displayLabel = (r: Root) => {
    const label = (r.label || '').trim()
    if (label && label !== r.dir) return label
    return r.dir.startsWith(HOME) ? `~${r.dir.slice(HOME.length)}` : r.dir
  }
  function rootsWithMeta() {
    return loadRoots().map((r) => ({ id: r.id, label: displayLabel(r), dir: r.dir, exists: dirExists(r.dir), ...dataProbe(r.dir) }))
  }
  function addRoot(inputPath: string, label?: string | null) {
    const dir = path.resolve(expandHome((inputPath || '').trim()))
    if (!dirExists(dir)) throw httpish(400, `Not a directory: ${dir}`)
    const roots = loadRoots()
    const id = idFor(dir)
    if (roots.some((r) => r.id === id)) throw httpish(409, 'Folder already tracked')
    roots.push({ id, label: (label || '').trim() || dir.replace(HOME, '~'), dir })
    writeConfig(roots)
    onRootsChanged?.(dir)
    return { id, dir }
  }
  function renameRoot(id: string, label?: string | null) {
    const roots = loadRoots()
    const found = roots.find((r) => r.id === id)
    if (!found) throw httpish(404, 'Root not found')
    const l = String(label || '').trim()
    found.label = l || found.dir // empty label → back to the default (home-relative dir)
    writeConfig(roots)
    return { id, label: l || found.dir.replace(HOME, '~') }
  }
  function removeRoot(id: string) {
    const roots = loadRoots()
    const found = roots.find((r) => r.id === id)
    const next = roots.filter((r) => r.id !== id)
    if (next.length === roots.length) throw httpish(404, 'Root not found')
    writeConfig(next)
    if (found) onRootsChanged?.(found.dir)
    return { removed: id }
  }
  function resolveRoot(rootId?: string | null) {
    const roots = loadRoots()
    if (!roots.length) throw httpish(404, 'No tracked folders. Add one with a path.')
    if (!rootId) return roots[0]
    const found = roots.find((r) => r.id === rootId)
    if (!found) throw httpish(404, `Unknown root: ${rootId}`)
    return found
  }
  return { loadRoots, rootsWithMeta, addRoot, renameRoot, removeRoot, resolveRoot }
}
