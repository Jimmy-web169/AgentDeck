import fs from 'node:fs'
import type { Root } from '../../../shared/types.d.ts'
import type { ConversationMeta } from './sqlite.ts'
import { stateFile } from '../../shared/state.ts'
import { jsonRecord, jsonArray, optionalTimestamp } from '../../shared/json.ts'
import path from 'node:path'
import { makeRoots, HOME, expandHome, dirExists, idFor, assertInside } from '../../shared/roots.ts'
import { readMeta, uriToPath } from './sqlite.ts'

// Antigravity CLI keeps one directory per conversation under
// ~/.gemini/antigravity-cli/brain/<uuid>/ (the transcript), a matching SQLite
// file under conversations/<uuid>.db (workspace, model, tokens), a title in
// annotations/<uuid>.pbtxt, and — for interactive prompts — history.jsonl with
// a `workspace`. The hub (~/.gemini/antigravity) and the IDE share the layout,
// so they can be tracked as further folders.
//
// There is no project tree: like Codex, sessions are grouped by the workspace
// each conversation records (slug = the cwd string); conversations that never
// mounted a workspace (untrusted print-mode runs) land in a "(no workspace)"
// bucket. Sub-agents are ordinary conversations: the parent's result step
// after `invoke_subagent` names the child id, the child's `send_message`
// names the parent.

const CONFIG_PATH = () => stateFile('roots', 'antigravity')

export const brainDir = (rootDir: string) => path.join(rootDir, 'brain')
function hasBrain(dir: string) {
  try {
    return fs.statSync(brainDir(dir)).isDirectory()
  } catch {
    return false
  }
}
function defaultRoots(): Root[] {
  const out: Root[] = []
  for (const p of [process.env.ANTIGRAVITY_CLI_HOME, path.join(HOME, '.gemini', 'antigravity-cli')].filter(
    (value): value is string => typeof value === 'string' && !!value
  )) {
    const d = path.resolve(expandHome(p))
    if (dirExists(d) && !out.some((r) => r.dir === d)) out.push({ id: idFor(d), label: d.replace(HOME, '~'), dir: d })
  }
  return out
}
const _roots = makeRoots({
  configPath: CONFIG_PATH,
  autodetectSeed: defaultRoots,
  defaultRoots,
  dataProbe: (dir) => ({ hasSessions: hasBrain(dir) }),
  onRootsChanged: (dir) => invalidateIndex(dir),
})
export const { loadRoots, rootsWithMeta, addRoot, renameRoot, removeRoot, resolveRoot } = _roots
export { assertInside, HOME, expandHome, dirExists }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s)

export function transcriptFile(rootDir: string, id: string) {
  const logs = path.join(brainDir(rootDir), id, '.system_generated', 'logs')
  for (const name of ['transcript_full.jsonl', 'transcript.jsonl']) {
    const f = path.join(logs, name)
    if (fs.existsSync(f)) return f
  }
  return null
}
export const dbFile = (rootDir: string, id: string) => path.join(rootDir, 'conversations', `${id}.db`)
export const annotationFile = (rootDir: string, id: string) => path.join(rootDir, 'annotations', `${id}.pbtxt`)

// annotations/<id>.pbtxt is a text-proto with `title:"…"`
export function readTitle(rootDir: string, id: string) {
  try {
    const m = fs.readFileSync(annotationFile(rootDir, id), 'utf8').match(/title:\s*"((?:[^"\\]|\\.)*)"/)
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim() : null
  } catch {
    return null
  }
}

// ---- sub-agent links, read from the transcripts themselves -------------------------
// parent → children: a GENERIC result right after `invoke_subagent` carries
//   { "conversationId": "<child>", "logAbsoluteUri": …, "workspaceUris": [...] }
// child → parent:  a `send_message` tool call with args.Recipient = <parent>
interface Links {
  mtimeMs: number
  children: string[]
  parentId: string | null
  workspaces: string[]
}
interface IndexEntry {
  id: string
  file: string
  mtimeMs: number
  cwd: string | null
  startTs: string | number | null
  model: string | null
  tokens: ConversationMeta['tokens'] | null
  gitRepo: string | null
  branch: string | null
  children: string[]
  parentId: string | null
  spawnWorkspaces: string[]
  isSubagent?: boolean
}
interface SessionIndex {
  at: number
  byId: Map<string, IndexEntry>
  byCwd: Map<string, IndexEntry[]>
}
const linkCache = new Map<string, Links>() // file -> { mtimeMs, children, parentId, workspaces }
function readLinks(file: string, mtimeMs: number): Links {
  const hit = linkCache.get(file)
  if (hit && hit.mtimeMs === mtimeMs) return hit
  const out: Links = { mtimeMs, children: [], parentId: null, workspaces: [] }
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('conversationId') && !line.includes('send_message') && !line.includes('workspaceUris')) continue
      let rec: Record<string, unknown>
      try {
        rec = jsonRecord(JSON.parse(line))
      } catch {
        continue
      }
      if (typeof rec.content === 'string' && rec.content.includes('conversationId')) {
        for (const m of rec.content.matchAll(/"conversationId"\s*:\s*"([0-9a-f-]{36})"/gi)) if (!out.children.includes(m[1])) out.children.push(m[1])
        for (const m of rec.content.matchAll(/"workspaceUris"\s*:\s*\[([^\]]*)\]/g)) for (const u of m[1].matchAll(/"([^"]+)"/g)) out.workspaces.push(u[1])
      }
      for (const raw of jsonArray(rec.tool_calls)) {
        const tc = jsonRecord(raw),
          args = jsonRecord(tc.args)
        if (tc.name === 'send_message' && isSessionId(args.Recipient)) out.parentId = out.parentId || args.Recipient
      }
    }
  } catch {}
  linkCache.set(file, out)
  return out
}

// ---- session index (workspace grouping) -------------------------------------------

export const NO_CWD = '(no workspace)'
const cache = new Map<string, SessionIndex>() // rootDir -> { at, byId, byCwd }
const TTL = 1500
export function invalidateIndex(rootDir?: string) {
  if (rootDir) cache.delete(rootDir)
  else cache.clear()
}

// cwd for conversations the SQLite does not name: cache/last_conversations.json
// maps an absolute cwd to its latest conversation id (interactive runs only)
function lastConversations(rootDir: string): Map<string, string> {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(rootDir, 'cache', 'last_conversations.json'), 'utf8'))
    const out = new Map<string, string>()
    for (const [cwd, id] of Object.entries(m || {})) if (typeof id === 'string') out.set(id, cwd)
    return out
  } catch {
    return new Map()
  }
}

function readHead(file: string): { startTs: string | number | null } {
  // first USER_INPUT: start time + a title fallback; a 64 KB window is plenty
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const rec = jsonRecord(JSON.parse(s))
        const startTs = optionalTimestamp(rec.created_at)
        if (startTs) return { startTs }
      } catch {
        break
      }
    }
  } catch {}
  return { startTs: null }
}

export function buildIndex(rootDir: string): SessionIndex {
  const cached = cache.get(rootDir)
  if (cached && Date.now() - cached.at < TTL) return cached
  const byId = new Map<string, IndexEntry>()
  const byCwd = new Map<string, IndexEntry[]>()
  let ids: string[] = []
  try {
    ids = fs
      .readdirSync(brainDir(rootDir), { withFileTypes: true })
      .filter((e) => e.isDirectory() && isSessionId(e.name))
      .map((e) => e.name)
  } catch {}
  const lastConv = lastConversations(rootDir)
  const entries: IndexEntry[] = []
  for (const id of ids) {
    const file = transcriptFile(rootDir, id)
    if (!file) continue
    let mtimeMs = 0
    try {
      mtimeMs = fs.statSync(file).mtimeMs
    } catch {}
    const meta = readMeta(dbFile(rootDir, id)) // cached by db signature; null without node:sqlite
    const links = readLinks(file, mtimeMs)
    const cwd = meta?.workspace || lastConv.get(id) || null
    entries.push({
      id,
      file,
      mtimeMs,
      cwd,
      startTs: readHead(file).startTs,
      model: meta?.model || null,
      tokens: meta?.tokens || null,
      gitRepo: meta?.gitRepo || null,
      branch: meta?.branch || null,
      children: links.children,
      parentId: links.parentId,
      spawnWorkspaces: links.workspaces,
    })
  }
  // a child that never sent a message back still has a parent: the one that spawned it
  for (const e of entries)
    for (const c of e.children) {
      const ch = entries.find((x) => x.id === c)
      if (ch && !ch.parentId) ch.parentId = e.id
    }
  // a child without a workspace inherits the one it was spawned into
  for (const e of entries) {
    if (!e.cwd && e.parentId) {
      const p = entries.find((x) => x.id === e.parentId)
      const ws = p?.spawnWorkspaces?.[0]
      e.cwd = p?.cwd || (ws ? uriToPath(ws) : null)
    }
    e.isSubagent = !!e.parentId
    byId.set(e.id, e)
  }
  for (const e of byId.values()) {
    const slug = e.cwd || NO_CWD
    const group = byCwd.get(slug) || []
    if (!byCwd.has(slug)) byCwd.set(slug, group)
    group.push(e)
  }
  const built = { at: Date.now(), byId, byCwd }
  cache.set(rootDir, built)
  return built
}

export function listProjects(rootDir: string) {
  const { byCwd } = buildIndex(rootDir)
  const projects = []
  for (const [slug, entries] of byCwd) {
    let lastActivity = 0
    for (const e of entries) if (e.mtimeMs > lastActivity) lastActivity = e.mtimeMs
    projects.push({ slug, cwd: slug === NO_CWD ? null : slug, sessionCount: entries.filter((e) => !e.isSubagent).length, lastActivity })
  }
  return projects.sort((a, b) => b.lastActivity - a.lastActivity)
}
export function sessionFiles(rootDir: string, slug: string) {
  const { byCwd } = buildIndex(rootDir)
  return byCwd.get(slug) || []
}
export function sessionFileById(rootDir: string, id: string) {
  const { byId } = buildIndex(rootDir)
  return byId.get(id) || null
}
export function childrenOf(rootDir: string, parentId: string | null | undefined) {
  if (!parentId) return []
  const { byId } = buildIndex(rootDir)
  return [...byId.values()].filter((e) => e.parentId === parentId).sort((a, b) => a.mtimeMs - b.mtimeMs)
}
export function cwdForId(rootDir: string, id: string) {
  return sessionFileById(rootDir, id)?.cwd || null
}
// a presence lock exists while (and, alas, after) a conversation runs; mtime is the better signal
export function isLive(rootDir: string, id: string) {
  try {
    return Date.now() - fs.statSync(path.join(rootDir, 'presence', `${id}.lock`)).mtimeMs < 60000
  } catch {
    return false
  }
}
