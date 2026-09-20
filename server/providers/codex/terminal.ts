import type { TerminalConfig, SavedSession } from '../../shared/terminalTypes.ts'
import path from 'node:path'
import { resolveRoot, sessionFileById, idFromFilename, isSessionId, NO_CWD } from './paths.ts'
import { uniqueSession } from '../../shared/terminalDiscovery.ts'
import { cachedRecords, cachedDerived, fingerprintOf } from '../../shared/parseCache.ts'
import { readRecords, summarize, UNTITLED } from './parser.ts'

// The listed title of one rollout, through the same cache the sessions list
// fills. Unknown — no prompt yet, oversize, unreadable — is null, never a label.
export function sessionTitle(file: string, id: string): string | null {
  try {
    const fp = fingerprintOf(file)
    const title = cachedDerived(file, 'summary', () => summarize(cachedRecords(file, readRecords, fp), id), fp).title
    return title && title !== UNTITLED ? title : null
  } catch {
    return null
  }
}

export function resolveSavedCodexSession({ root, id }: Parameters<NonNullable<TerminalConfig['resolveSavedSession']>>[0]): SavedSession | null {
  if (!isSessionId(id)) return null
  const entry = sessionFileById(root.dir, id)
  return entry && !entry.isSubagent ? { id, slug: entry.cwd || NO_CWD, cwd: entry.cwd, title: sessionTitle(entry.file, id) } : null
}

export function resolveCodexSession({ meta, files }: Parameters<NonNullable<TerminalConfig['resolveSession']>>[0]): SavedSession | null {
  const dir = resolveRoot(meta.root).dir
  if (meta.id) {
    // Bound: only the listed title can still change (first prompt, later renames).
    const entry = isSessionId(meta.id) ? sessionFileById(dir, meta.id) : null
    return entry ? { id: meta.id, slug: meta.slug, cwd: meta.cwd, title: sessionTitle(entry.file, meta.id) } : null
  }
  return uniqueSession(
    files().flatMap((file) => {
      const relative = path.relative(path.join(dir, 'sessions'), file)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return []
      const id = idFromFilename(path.basename(file))
      if (!isSessionId(id)) return []
      const entry = sessionFileById(dir, id)
      if (!entry || entry.isSubagent) return []
      return [{ id, slug: entry.cwd || meta.cwd, cwd: entry.cwd || meta.cwd, title: sessionTitle(entry.file, id) }]
    })
  )
}
