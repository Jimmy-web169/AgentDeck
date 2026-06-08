import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

// Shared tracked-roots manager. A "root" is a tracked config home (e.g. a
// Claude/Codex home dir). Root management is identical across providers; the
// provider only supplies where its config file lives, how to auto-detect roots,
// and how to probe a root for "has data". Each provider's paths module wraps
// makeRoots() and re-exports the result, so callers import roots fns from there.

export const HOME = os.homedir()

export function expandHome(p) {
  if (!p) return p
  if (p === '~') return HOME
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2))
  return p
}

export function idFor(dir) {
  return crypto.createHash('sha256').update(dir).digest('hex').slice(0, 10)
}

export function dirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

export function httpish(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

export function assertInside(rootDir, target) {
  const rel = path.relative(rootDir, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw httpish(403, 'Path escapes root')
  return target
}

// config:
//   configPath          — JSON file persisting the user's tracked roots
//   autodetectSeed()    — Root[] to seed on first run (env vars + default home)
//   defaultRoots?()     — built-in roots always kept present (e.g. ~/.claude, ~/.codex)
//   dataProbe(dir)      — extra UI flags merged into rootsWithMeta (e.g. { hasProjects })
//   onRootsChanged?(dir)— called after add/remove (e.g. to invalidate an index)
export function makeRoots({ configPath, autodetectSeed, defaultRoots, dataProbe, onRootsChanged }) {
  const readConfig = () => {
    try {
      const arr = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (Array.isArray(arr) && arr.length) return arr
    } catch {}
    return null
  }
  const writeConfig = (arr) => fs.writeFileSync(configPath, JSON.stringify(arr, null, 2))

  function loadRoots() {
    let cfg = readConfig()
    if (!cfg) {
      cfg = autodetectSeed()
      try {
        writeConfig(cfg)
      } catch {}
    } else if (defaultRoots) {
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
  function rootsWithMeta() {
    return loadRoots().map((r) => ({ id: r.id, label: r.label, dir: r.dir, exists: dirExists(r.dir), ...dataProbe(r.dir) }))
  }
  function addRoot(inputPath, label) {
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
  function removeRoot(id) {
    const roots = loadRoots()
    const found = roots.find((r) => r.id === id)
    const next = roots.filter((r) => r.id !== id)
    if (next.length === roots.length) throw httpish(404, 'Root not found')
    writeConfig(next)
    if (found) onRootsChanged?.(found.dir)
    return { removed: id }
  }
  function resolveRoot(rootId) {
    const roots = loadRoots()
    if (!roots.length) throw httpish(404, 'No tracked folders. Add one with a path.')
    if (!rootId) return roots[0]
    const found = roots.find((r) => r.id === rootId)
    if (!found) throw httpish(404, `Unknown root: ${rootId}`)
    return found
  }
  return { loadRoots, rootsWithMeta, addRoot, removeRoot, resolveRoot }
}
