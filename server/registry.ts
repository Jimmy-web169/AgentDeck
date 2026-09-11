import { DATA as claudeData } from './providers/claude/data.ts'
import { DATA as codexData } from './providers/codex/data.ts'
import { DATA as antigravityData } from './providers/antigravity/data.ts'
import path from 'node:path'
import type { HttpProvider } from './http.ts'
import type { Root } from '../shared/types.d.ts'
import type { TerminalConfig } from './shared/terminalTypes.ts'
import { historyReader } from './deck/history.ts'
import { createHomeAdapter } from './deck/homeAdapter.ts'
// codex provider
import { dispatch as codexDispatch } from './providers/codex/api.ts'
import {
  loadRoots as codexLoadRoots,
  sessionsDir as codexSessionsDir,
  idFromFilename as codexIdFromFilename,
  cwdForId as codexCwdForId,
  sessionFileById as codexSessionFileById,
  invalidateIndex as codexInvalidateIndex,
} from './providers/codex/paths.ts'
// claude provider
import { dispatch as claudeDispatch } from './providers/claude/api.ts'
import { loadRoots as claudeLoadRoots, projectsDir as claudeProjectsDir } from './providers/claude/paths.ts'
// antigravity provider
import { dispatch as agyDispatch } from './providers/antigravity/api.ts'
import { prepareAntigravityLaunch } from './providers/antigravity/terminal.ts'
import {
  loadRoots as agyLoadRoots,
  invalidateIndex as agyInvalidateIndex,
  cwdForId as agyCwdForId,
  isSessionId as agyIsSessionId,
} from './providers/antigravity/paths.ts'

// Provider registry. Each provider supplies:
//   dispatch(method, '/api/<rest>', query, body) -> { status, body }
//   loadRoots()    — its tracked roots (per-provider roots.<id>.json)
//   watch: { watchDir(rootDir), toEvent(rootId, rootDir, absPath) -> change|null }
//
// Cross-provider helpers (roots, dispatch, terminal pool, skills runner, origin
// guard, launch) live in server/shared/; a provider's server/providers/<id>/
// module holds only its data-layout-specific code (paths, parser, resources, …).
// Adding a provider = add server/providers/<id>/ + one entry here.
export interface ServerProvider extends HttpProvider {
  terminal?: TerminalConfig
  capabilities?: { readTimeline?: boolean; interactiveContext?: boolean }
  home?: ReturnType<typeof createHomeAdapter>
  history?: ReturnType<typeof historyReader>
  validateContextTarget?(root: Root): unknown
}
export const PROVIDERS: Record<string, ServerProvider> = {
  claude: {
    id: 'claude',
    terminal: claudeData.terminal,
    capabilities: { readTimeline: true, interactiveContext: true },
    dispatch: claudeDispatch,
    home: createHomeAdapter(claudeDispatch, { resourceStyle: 'slug', statsNote: 'Usage from main transcripts; separate subagent sidecars are not included.' }),
    history: historyReader(claudeDispatch, { nested: true }),
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
    terminal: codexData.terminal,
    capabilities: { readTimeline: true, interactiveContext: true },
    dispatch: codexDispatch,
    home: createHomeAdapter(codexDispatch, { statsNote: 'Usage includes main and independent subagent transcripts; session counts keep them separate.' }),
    history: historyReader(codexDispatch),
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
    terminal: antigravityData.terminal,
    capabilities: { readTimeline: true, interactiveContext: true },
    validateContextTarget: (root) => prepareAntigravityLaunch({ configDir: root.dir }),
    dispatch: agyDispatch,
    home: createHomeAdapter(agyDispatch, { statsNote: 'Usage includes main and independent subagent transcripts; session counts keep them separate.' }),
    history: historyReader(agyDispatch),
    loadRoots: agyLoadRoots,
    watch: {
      // the transcript lives under brain/<id>/, but the facts that place a
      // conversation in a project — its workspace URI in conversations/<id>.db and
      // cache/last_conversations.json — are written beside it. Watching only brain/
      // meant a fresh conversation's first events carried no cwd and it sat in
      // "(no workspace)" until something else touched the index.
      watchDir: (rootDir) => rootDir,
      ignored: (rootDir, absPath) => AGY_UNWATCHED.has(path.relative(rootDir, absPath).split(path.sep)[0]),
      toEvent: (rootId, rootDir, absPath) => {
        const rel = path.relative(rootDir, absPath)
        if (!rel || rel.startsWith('..')) return null
        const [top, second = ''] = rel.split(path.sep)
        let id = null
        if (top === 'brain') id = second
        else if (top === 'conversations') id = second.replace(/\.db(-wal|-shm|-journal)?$/, '')
        else if (top === 'annotations') id = second.replace(/\.pbtxt$/, '')
        else if (top === 'cache' && second === 'last_conversations.json') id = null
        else return null
        if (id !== null && !agyIsSessionId(id)) return null
        agyInvalidateIndex(rootDir)
        let slug = null
        if (id) {
          try {
            slug = agyCwdForId(rootDir, id)
          } catch {}
        }
        return { provider: 'antigravity', root: rootId, id, slug }
      },
    },
  },
}

// top-level dirs of an Antigravity home that never describe a conversation
const AGY_UNWATCHED = new Set(['bin', 'builtin', 'crashes', 'implicit', 'knowledge', 'log', 'mcp', 'presence', 'updater', 'skills'])

export const providerIds = () => Object.keys(PROVIDERS)
