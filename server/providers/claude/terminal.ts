import type { TerminalConfig, SavedSession } from '../../shared/terminalTypes.ts'
import { jsonRecord, optionalString } from '../../shared/json.ts'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveRoot, listProjectSlugs, projectsDir, assertInside } from './paths.ts'
import { uniqueSession } from '../../shared/terminalDiscovery.ts'
import { cachedRecords, cachedDerived, fingerprintOf } from '../../shared/parseCache.ts'
import { readRecords, summarize, UNTITLED } from './parser.ts'

// The listed title of one transcript, through the same cache the sessions
// list fills (one stat, then a cache hit). Unknown — no prompt yet, oversize,
// unreadable — is null, never a label.
export function sessionTitle(file: string, id: string): string | null {
  try {
    const fp = fingerprintOf(file)
    const title = summarizeCached(file, id, fp).title
    return title && title !== UNTITLED ? title : null
  } catch {
    return null
  }
}
const summarizeCached = (file: string, id: string, fp: ReturnType<typeof fingerprintOf>) =>
  cachedDerived(file, 'summary', () => summarize(cachedRecords(file, readRecords, fp), id), fp)

const supported = new Map<string, boolean>()
export function resolveSavedClaudeSession({ root, id, slug }: Parameters<NonNullable<TerminalConfig['resolveSavedSession']>>[0]): SavedSession | null {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !slug) return null
  const file = path.join(projectsDir(root.dir), slug, `${id}.jsonl`)
  assertInside(root.dir, file)
  if (!fs.existsSync(file)) return null
  const cwd =
    optionalString(
      readRecords(file)
        .map(jsonRecord)
        .find((r) => typeof r.cwd === 'string' && r.cwd)?.cwd
    ) || null
  return { id, slug, cwd, title: sessionTitle(file, id) }
}
export function prepareClaudeLaunch({ bin, resumeId }: Pick<Parameters<NonNullable<TerminalConfig['prepareLaunch']>>[0], 'bin' | 'resumeId'>) {
  if (resumeId || !bin) return {}
  if (!supported.has(bin)) {
    try {
      supported.set(bin, execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 5000 }).includes('--session-id'))
    } catch {
      supported.set(bin, false)
    }
  }
  if (!supported.get(bin)) return {}
  const expectedSessionId = crypto.randomUUID()
  return { args: ['--session-id', expectedSessionId], meta: { expectedSessionId } }
}

export function resolveClaudeSession({ meta, files }: Parameters<NonNullable<TerminalConfig['resolveSession']>>[0]): SavedSession | null {
  const dir = resolveRoot(meta.root).dir
  const base = projectsDir(dir)
  const saved = (id: string, slug: string): SavedSession => ({ id, slug, cwd: meta.cwd, title: sessionTitle(path.join(base, slug, `${id}.jsonl`), id) })
  // Bound: only the listed title can still change (first prompt, later renames).
  if (meta.id && typeof meta.slug === 'string' && meta.slug) return saved(meta.id, meta.slug)
  if (meta.id) return null
  const candidates: SavedSession[] = []
  // Preallocation identifies the new transcript without relying on timing.
  if (typeof meta.expectedSessionId === 'string' && meta.expectedSessionId) {
    for (const slug of listProjectSlugs(dir)) {
      if (fs.existsSync(path.join(base, slug, `${meta.expectedSessionId}.jsonl`))) candidates.push(saved(meta.expectedSessionId, slug))
    }
  }
  if (candidates.length) return uniqueSession(candidates)
  for (const file of files()) {
    const rel = path.relative(base, file).split(path.sep)
    if (rel.length === 2 && /^[0-9a-f-]{36}\.jsonl$/i.test(rel[1])) candidates.push(saved(rel[1].slice(0, -6), rel[0]))
  }
  return uniqueSession(candidates)
}
