import path from 'node:path'
import { resolveRoot, sessionFileById, idFromFilename, isSessionId, NO_CWD } from './paths.js'
import { uniqueSession } from '../../shared/terminalDiscovery.js'

export function resolveSavedCodexSession({ root, id }) {
  if (!isSessionId(id)) return null
  const entry = sessionFileById(root.dir, id)
  return entry && !entry.isSubagent ? { id, slug: entry.cwd || NO_CWD, cwd: entry.cwd } : null
}

export function resolveCodexSession({ meta, files }) {
  if (meta.id) return null
  const dir = resolveRoot(meta.root).dir
  return uniqueSession(files().flatMap((file) => {
    const relative = path.relative(path.join(dir, 'sessions'), file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return []
    const id = idFromFilename(path.basename(file))
    if (!isSessionId(id)) return []
    const entry = sessionFileById(dir, id)
    if (!entry || entry.isSubagent) return []
    return [{ id, slug: entry.cwd || meta.cwd, cwd: entry.cwd || meta.cwd }]
  }))
}
