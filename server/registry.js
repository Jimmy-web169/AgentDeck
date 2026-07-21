import path from 'node:path'
// codex provider
import { dispatch as codexDispatch } from './providers/codex/api.js'
import { makeChatWss as codexMakeChatWss } from './providers/codex/chat.js'
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
import { makeChatWss as claudeMakeChatWss } from './providers/claude/chat.js'
import { loadRoots as claudeLoadRoots, projectsDir as claudeProjectsDir } from './providers/claude/paths.js'

// Provider registry. Each provider supplies:
//   dispatch(method, '/api/<rest>', query, body) -> { status, body }
//   chatWss        — a noServer WebSocketServer; index.js routes /chat/<id> upgrades to it
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
    chatWss: claudeMakeChatWss(),
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
    chatWss: codexMakeChatWss(),
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
}

export const providerIds = () => Object.keys(PROVIDERS)
