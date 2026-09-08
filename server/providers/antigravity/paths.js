import fs from 'node:fs'
import path from 'node:path'
import { makeRoots, HOME, expandHome, dirExists, idFor, assertInside, configDir } from '../../shared/roots.js'
import { readMeta, uriToPath } from './sqlite.js'

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

const CONFIG_PATH = () => path.join(configDir(), 'roots.antigravity.json')

export const brainDir = (rootDir) => path.join(rootDir, 'brain')
function hasBrain(dir) {
  try {
    return fs.statSync(brainDir(dir)).isDirectory()
  } catch {
    return false
  }
}
function defaultRoots() {
  const out = []
  for (const p of [process.env.ANTIGRAVITY_CLI_HOME, path.join(HOME, '.gemini', 'antigravity-cli')].filter(Boolean)) {
    const d = path.resolve(expandHome(p))
    if (dirExists(d) && !out.some((r) => r.dir === d)) out.push({ id: idFor(d), label: d.replace(HOME, '~'), dir: d })
  }
  return out
}
const _roots = makeRoots({ configPath: CONFIG_PATH, autodetectSeed: defaultRoots, defaultRoots, dataProbe: (dir) => ({ hasSessions: hasBrain(dir) }), onRootsChanged: (dir) => invalidateIndex(dir) })
export const { loadRoots, rootsWithMeta, addRoot, renameRoot, removeRoot, resolveRoot } = _roots
export { assertInside, HOME, expandHome, dirExists }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isSessionId = (s) => typeof s === 'string' && UUID_RE.test(s)

export function transcriptFile(rootDir, id) {
  const logs = path.join(brainDir(rootDir), id, '.system_generated', 'logs')
  for (const name of ['transcript_full.jsonl', 'transcript.jsonl']) {
    const f = path.join(logs, name)
    if (fs.existsSync(f)) return f
  }
  return null
}
export const dbFile = (rootDir, id) => path.join(rootDir, 'conversations', `${id}.db`)
export const annotationFile = (rootDir, id) => path.join(rootDir, 'annotations', `${id}.pbtxt`)

// annotations/<id>.pbtxt is a text-proto with `title:"…"`
export function readTitle(rootDir, id) {
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
const linkCache = new Map() // file -> { mtimeMs, children, parentId, workspaces }
function readLinks(file, mtimeMs) {
  const hit = linkCache.get(file)
  if (hit && hit.mtimeMs === mtimeMs) return hit
  const out = { mtimeMs, children: [], parentId: null, workspaces: [] }
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('conversationId') && !line.includes('send_message') && !line.includes('workspaceUris')) continue
      let rec
      try {
        rec = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof rec.content === 'string' && rec.content.includes('conversationId')) {
        for (const m of rec.content.matchAll(/"conversationId"\s*:\s*"([0-9a-f-]{36})"/gi)) if (!out.children.includes(m[1])) out.children.push(m[1])
        for (const m of rec.content.matchAll(/"workspaceUris"\s*:\s*\[([^\]]*)\]/g)) for (const u of m[1].matchAll(/"([^"]+)"/g)) out.workspaces.push(u[1])
      }
      for (const tc of Array.isArray(rec.tool_calls) ? rec.tool_calls : []) {
        if (tc.name === 'send_message' && isSessionId(tc.args?.Recipient)) out.parentId = out.parentId || tc.args.Recipient
      }
    }
  } catch {}
  linkCache.set(file, out)
  return out
}

// ---- session index (workspace grouping) -------------------------------------------

export const NO_CWD = '(no workspace)'
const cache = new Map() // rootDir -> { at, byId, byCwd }
const TTL = 1500
export function invalidateIndex(rootDir) {
  if (rootDir) cache.delete(rootDir)
  else cache.clear()
}

// cwd for conversations the SQLite does not name: cache/last_conversations.json
// maps an absolute cwd to its latest conversation id (interactive runs only)
function lastConversations(rootDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(rootDir, 'cache', 'last_conversations.json'), 'utf8'))
    const out = new Map()
    for (const [cwd, id] of Object.entries(m || {})) if (typeof id === 'string') out.set(id, cwd)
    return out
  } catch {
    return new Map()
  }
}

function readHead(file) {
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
        const rec = JSON.parse(s)
        if (rec.created_at) return { startTs: rec.created_at }
      } catch {
        break
      }
    }
  } catch {}
  return { startTs: null }
}

export function buildIndex(rootDir) {
  const cached = cache.get(rootDir)
  if (cached && Date.now() - cached.at < TTL) return cached
  const byId = new Map()
  const byCwd = new Map()
  let ids = []
  try {
    ids = fs.readdirSync(brainDir(rootDir), { withFileTypes: true }).filter((e) => e.isDirectory() && isSessionId(e.name)).map((e) => e.name)
  } catch {}
  const lastConv = lastConversations(rootDir)
  const entries = []
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
    entries.push({ id, file, mtimeMs, cwd, startTs: readHead(file).startTs, model: meta?.model || null, tokens: meta?.tokens || null, gitRepo: meta?.gitRepo || null, branch: meta?.branch || null, children: links.children, parentId: links.parentId, spawnWorkspaces: links.workspaces })
  }
  // a child that never sent a message back still has a parent: the one that spawned it
  for (const e of entries) for (const c of e.children) {
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
    if (!byCwd.has(slug)) byCwd.set(slug, [])
    byCwd.get(slug).push(e)
  }
  const built = { at: Date.now(), byId, byCwd }
  cache.set(rootDir, built)
  return built
}

export function listProjects(rootDir) {
  const { byCwd } = buildIndex(rootDir)
  const projects = []
  for (const [slug, entries] of byCwd) {
    let lastActivity = 0
    for (const e of entries) if (e.mtimeMs > lastActivity) lastActivity = e.mtimeMs
    projects.push({ slug, cwd: slug === NO_CWD ? null : slug, sessionCount: entries.filter((e) => !e.isSubagent).length, lastActivity })
  }
  return projects.sort((a, b) => b.lastActivity - a.lastActivity)
}
export function sessionFiles(rootDir, slug) {
  const { byCwd } = buildIndex(rootDir)
  return byCwd.get(slug) || []
}
export function sessionFileById(rootDir, id) {
  const { byId } = buildIndex(rootDir)
  return byId.get(id) || null
}
export function childrenOf(rootDir, parentId) {
  if (!parentId) return []
  const { byId } = buildIndex(rootDir)
  return [...byId.values()].filter((e) => e.parentId === parentId).sort((a, b) => a.mtimeMs - b.mtimeMs)
}
export function cwdForId(rootDir, id) {
  return sessionFileById(rootDir, id)?.cwd || null
}
// a presence lock exists while (and, alas, after) a conversation runs; mtime is the better signal
export function isLive(rootDir, id) {
  try {
    return Date.now() - fs.statSync(path.join(rootDir, 'presence', `${id}.lock`)).mtimeMs < 60000
  } catch {
    return false
  }
}
