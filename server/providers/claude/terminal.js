import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveRoot, listProjectSlugs, projectsDir, assertInside } from './paths.js'
import { uniqueSession } from '../../shared/terminalDiscovery.js'
import { readRecords } from './parser.js'

const supported = new Map()
export function resolveSavedClaudeSession({ root, id, slug }) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !slug) return null
  const file = path.join(projectsDir(root.dir), slug, `${id}.jsonl`)
  assertInside(root.dir, file)
  if (!fs.existsSync(file)) return null
  const cwd = readRecords(file).find((r) => typeof r.cwd === 'string' && r.cwd)?.cwd || null
  return { id, slug, cwd }
}
export function prepareClaudeLaunch({ bin, resumeId }) {
  if (resumeId) return {}
  if (!supported.has(bin)) {
    try { supported.set(bin, execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 5000 }).includes('--session-id')) }
    catch { supported.set(bin, false) }
  }
  if (!supported.get(bin)) return {}
  const expectedSessionId = crypto.randomUUID()
  return { args: ['--session-id', expectedSessionId], meta: { expectedSessionId } }
}

export function resolveClaudeSession({ meta, files }) {
  const dir = resolveRoot(meta.root).dir
  const base = projectsDir(dir)
  const candidates = []
  // Preallocation identifies the new transcript without relying on timing.
  if (!meta.id && meta.expectedSessionId) {
    for (const slug of listProjectSlugs(dir)) {
      if (fs.existsSync(path.join(base, slug, `${meta.expectedSessionId}.jsonl`))) candidates.push({ id: meta.expectedSessionId, slug, cwd: meta.cwd })
    }
  }
  if (candidates.length) return uniqueSession(candidates)
  if (meta.id) return null
  for (const file of files()) {
    const rel = path.relative(base, file).split(path.sep)
    if (rel.length === 2 && /^[0-9a-f-]{36}\.jsonl$/i.test(rel[1])) candidates.push({ id: rel[1].slice(0, -6), slug: rel[0], cwd: meta.cwd })
  }
  return uniqueSession(candidates)
}
