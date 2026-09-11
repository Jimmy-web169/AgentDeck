import fs from 'node:fs'
import type { Root } from '../../../shared/types.d.ts'
import { stateFile } from '../../shared/state.ts'
import path from 'node:path'
import { makeRoots, HOME, expandHome, dirExists, idFor, assertInside } from '../../shared/roots.ts'

// roots.claude.json lives in the config dir (repo root, or AGENTDECK_CONFIG_DIR)
const CONFIG_PATH = () => stateFile('roots', 'claude')

function hasProjects(dir: string) {
  try {
    return fs.statSync(path.join(dir, 'projects')).isDirectory()
  } catch {
    return false
  }
}
function defaultRoots(): Root[] {
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
const _roots = makeRoots({ configPath: CONFIG_PATH, autodetectSeed, defaultRoots, dataProbe: (dir) => ({ hasSessions: hasProjects(dir) }) })
export const { loadRoots, rootsWithMeta, addRoot, renameRoot, removeRoot, resolveRoot } = _roots
export { assertInside, HOME, expandHome, dirExists }

export function projectsDir(rootDir: string) {
  return path.join(rootDir, 'projects')
}

export function sessionFiles(rootDir: string, slug: string) {
  const dir = path.join(projectsDir(rootDir), slug)
  assertInside(rootDir, dir)
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => ({ id: e.name.replace(/\.jsonl$/, ''), file: path.join(dir, e.name) }))
}

/** Does this session have a subagents/ dir (workflow runs / sub-agents)? */
export function sessionHasSubagents(rootDir: string, slug: string, sessionId: string) {
  return dirExists(path.join(projectsDir(rootDir), slug, sessionId, 'subagents'))
}

export function listProjectSlugs(rootDir: string) {
  try {
    return fs
      .readdirSync(projectsDir(rootDir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}
