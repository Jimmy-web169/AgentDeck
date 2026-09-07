import path from 'node:path'
// codex provider
import { dispatch as codexDispatch } from './providers/codex/api.js'
import {
  loadRoots as codexLoadRoots,
  sessionsDir as codexSessionsDir,
  idFromFilename as codexIdFromFilename,
  cwdForId as codexCwdForId,
  sessionFileById as codexSessionFileById,
  invalidateIndex as codexInvalidateIndex,
} from './providers/codex/paths.js'
// claude provider
import { dispatch as claudeDispatch } from './providers/claude/api.js'
import { loadRoots as claudeLoadRoots, projectsDir as claudeProjectsDir } from './providers/claude/paths.js'
// antigravity provider
import { dispatch as agyDispatch } from './providers/antigravity/api.js'
import { loadRoots as agyLoadRoots, brainDir as agyBrainDir, invalidateIndex as agyInvalidateIndex, cwdForId as agyCwdForId, isSessionId as agyIsSessionId } from './providers/antigravity/paths.js'

// Provider registry. Each provider supplies:
//   dispatch(method, '/api/<rest>', query, body) -> { status, body }
//   loadRoots()    — its tracked roots (per-provider roots.<id>.json)
//   watch: { watchDir(rootDir), toEvent(rootId, rootDir, absPath) -> change|null }
//
// Cross-provider helpers (roots, dispatch, terminal pool, skills runner, origin
// guard, launch) live in server/shared/; a provider's server/providers/<id>/
// module holds only its data-layout-specific code (paths, parser, resources, …).
// Adding a provider = add server/providers/<id>/ + one entry here.
export const PROVIDERS = {
  claude: {
    id: 'claude',
    dispatch: claudeDispatch,
    loadRoots: claudeLoadRoots,
    watch: {
      watchDir: (rootDir) => claudeProjectsDir(rootDir),
      toEvent: (rootId, rootDir, absPath) => {
        const dir = claudeProjectsDir(rootDir)
        const rel = path.relative(dir, absPath)
        if (!rel || rel.startsWith('..')) return null
        const parts = rel.split(path.sep)
        const slug = parts[0]
        if (!slug) return null
        let id = null
        if (parts.length === 2 && parts[1].endsWith('.jsonl')) id = parts[1].replace(/\.jsonl$/, '')
        else if (parts.length >= 2 && /\.jsonl$/.test(parts[parts.length - 1])) id = parts[1] // subagent write → session
        return { provider: 'claude', root: rootId, slug, id }
      },
    },
  },
  codex: {
    id: 'codex',
    dispatch: codexDispatch,
    loadRoots: codexLoadRoots,
    watch: {
      watchDir: (rootDir) => codexSessionsDir(rootDir),
      toEvent: (rootId, rootDir, absPath) => {
        if (!absPath.endsWith('.jsonl')) return null
        codexInvalidateIndex(rootDir) // a rollout changed → rebuild the cwd index next read
        const id = codexIdFromFilename(path.basename(absPath))
        let slug = null
        let parentId = null
        try {
          const entry = codexSessionFileById(rootDir, id)
          slug = entry?.cwd || codexCwdForId(rootDir, id)
          parentId = entry?.parentId || null
        } catch {}
        return { provider: 'codex', root: rootId, id, slug, parentId }
      },
    },
  },
  antigravity: {
    id: 'antigravity',
    dispatch: agyDispatch,
    loadRoots: agyLoadRoots,
    watch: {
      watchDir: (rootDir) => agyBrainDir(rootDir),
      toEvent: (rootId, rootDir, absPath) => {
        // brain/<id>/.system_generated/logs/transcript*.jsonl (and steps/, messages/) → that conversation
        const rel = path.relative(agyBrainDir(rootDir), absPath)
        if (!rel || rel.startsWith('..')) return null
        const id = rel.split(path.sep)[0]
        if (!agyIsSessionId(id)) return null
        agyInvalidateIndex(rootDir)
        let slug = null
        try {
          slug = agyCwdForId(rootDir, id)
        } catch {}
        return { provider: 'antigravity', root: rootId, id, slug }
      },
    },
  },
}

export const providerIds = () => Object.keys(PROVIDERS)
