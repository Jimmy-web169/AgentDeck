import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRoots, HOME, expandHome, dirExists, idFor, assertInside } from '../../shared/roots.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'roots.claude.json')

function hasProjects(dir) {
  try {
    return fs.statSync(path.join(dir, 'projects')).isDirectory()
  } catch {
    return false
  }
}
function defaultRoots() {
  const p = path.join(HOME, '.claude')
  return dirExists(p) ? [{ id: idFor(p), label: p.replace(HOME, '~'), dir: p }] : []
}
function autodetectSeed() {
  const out = defaultRoots()
  if (process.env.CLAUDE_ROOT && dirExists(process.env.CLAUDE_ROOT)) {
    const d = process.env.CLAUDE_ROOT
    if (!out.some((r) => r.dir === d)) out.push({ id: idFor(d), label: d, dir: d })
  }
  return out
}
const _roots = makeRoots({ configPath: CONFIG_PATH, autodetectSeed, defaultRoots, dataProbe: (dir) => ({ hasProjects: hasProjects(dir) }) })
export const { loadRoots, rootsWithMeta, addRoot, removeRoot, resolveRoot } = _roots
export { assertInside, HOME, expandHome, dirExists }

export function projectsDir(rootDir) {
  return path.join(rootDir, 'projects')
}

export function sessionFiles(rootDir, slug) {
  const dir = path.join(projectsDir(rootDir), slug)
  assertInside(rootDir, dir)
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => ({ id: e.name.replace(/\.jsonl$/, ''), file: path.join(dir, e.name) }))
}

/** Does this session have a subagents/ dir (workflow runs / sub-agents)? */
export function sessionHasSubagents(rootDir, slug, sessionId) {
  return dirExists(path.join(projectsDir(rootDir), slug, sessionId, 'subagents'))
}

export function listProjectSlugs(rootDir) {
  try {
    return fs
      .readdirSync(projectsDir(rootDir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}


