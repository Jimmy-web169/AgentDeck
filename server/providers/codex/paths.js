import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRoots, HOME, expandHome, dirExists, idFor, assertInside } from '../../shared/roots.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'roots.codex.json')

function hasSessions(dir) {
  try {
    return fs.statSync(path.join(dir, 'sessions')).isDirectory()
  } catch {
    return false
  }
}
function defaultRoots() {
  const out = []
  for (const p of [process.env.CODEX_HOME, path.join(HOME, '.codex')].filter(Boolean)) {
    const d = path.resolve(expandHome(p))
    if (dirExists(d) && !out.some((r) => r.dir === d)) out.push({ id: idFor(d), label: d.replace(HOME, '~'), dir: d })
  }
  return out
}
function autodetectSeed() {
  const out = defaultRoots()
  if (process.env.CODEX_ROOT && dirExists(process.env.CODEX_ROOT)) {
    const d = path.resolve(process.env.CODEX_ROOT)
    if (!out.some((r) => r.dir === d)) out.push({ id: idFor(d), label: d.replace(HOME, '~'), dir: d })
  }
  return out
}
const _roots = makeRoots({ configPath: CONFIG_PATH, autodetectSeed, defaultRoots, dataProbe: (dir) => ({ hasSessions: hasSessions(dir) }), onRootsChanged: (dir) => invalidateIndex(dir) })
export const { loadRoots, rootsWithMeta, addRoot, removeRoot, resolveRoot } = _roots
export { assertInside, HOME, expandHome, dirExists }

export function sessionsDir(rootDir) {
  return path.join(rootDir, 'sessions')
}

// Codex rollout filename → session id (the trailing UUID). Filenames look like
//   rollout-2026-05-31T16-34-52-019e7d2b-f17b-7083-bb8f-d37a75cb4cb0.jsonl
// so we extract the canonical UUID at the end rather than split on '-'.
const ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
export function idFromFilename(name) {
  const m = ID_RE.exec(name)
  return m ? m[1] : name.replace(/\.jsonl$/, '')
}

// A Codex session id is a UUID. Validate before passing one to `codex resume`
// (as an argv positional) so a value like `--help` can't act as a CLI flag.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isSessionId(s) {
  return typeof s === 'string' && UUID_RE.test(s)
}

// Recursively list every rollout file under sessions/. Returns lightweight stat
// entries; the head (cwd/title) is read lazily by the index.
function walkSessionFiles(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walkSessionFiles(full, out)
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      let mtimeMs = 0
      try {
        mtimeMs = fs.statSync(full).mtimeMs
      } catch {}
      out.push({ id: idFromFilename(e.name), file: full, mtimeMs })
    }
  }
  return out
}

const EMPTY_HEAD = { cwd: null, startTs: null, branch: null, isSubagent: false, parentId: null, agentRole: null, agentNickname: null, depth: 0 }

// Read just the head of a rollout to learn its cwd / git branch / start time and
// — for Codex subagents — its parent thread + role, without parsing the whole
// file. The session_meta record is the first line; for a subagent it carries
// `thread_source: 'subagent'` and `source.subagent.thread_spawn` linking it to
// the parent thread (see DATA-MODEL.md).
function readHead(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(65536)
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    const chunk = buf.toString('utf8', 0, bytes)
    const lines = chunk.split('\n')
    if (!chunk.endsWith('\n')) lines.pop()
    const head = { ...EMPTY_HEAD }
    for (const line of lines) {
      const s = line.trim()
      if (!s) continue
      let rec
      try {
        rec = JSON.parse(s)
      } catch {
        continue
      }
      const p = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec
      if (!head.startTs && (rec.timestamp || p.timestamp)) head.startTs = rec.timestamp || p.timestamp
      if (head.cwd == null && typeof p.cwd === 'string') head.cwd = p.cwd
      if (head.branch == null && p.git && typeof p.git.branch === 'string') head.branch = p.git.branch
      // subagent linkage lives on the session_meta record (same line as cwd)
      const spawn = p.source && typeof p.source === 'object' && p.source.subagent?.thread_spawn
      if (spawn) {
        head.isSubagent = true
        head.parentId = spawn.parent_thread_id || head.parentId
        head.agentRole = spawn.agent_role || p.agent_role || head.agentRole
        head.agentNickname = spawn.agent_nickname || p.agent_nickname || head.agentNickname
        head.depth = spawn.depth || head.depth
      } else if (p.thread_source === 'subagent') {
        head.isSubagent = true
        head.agentRole = head.agentRole || p.agent_role || null
        head.agentNickname = head.agentNickname || p.agent_nickname || null
      }
      // cwd appears in session_meta and the first turn_context; stop once found
      if (head.cwd != null) break
    }
    return head
  } catch {
    return { ...EMPTY_HEAD }
  }
}

// ---- session index (cwd grouping) ------------------------------------------
// Codex has no projects/<slug> tree — sessions are filed by date. We synthesise
// "projects" by grouping rollouts on their cwd. The slug IS the cwd string, so
// lookups never reconstruct a path from the slug (no traversal surface): files
// are always located by their unique id via this index.

const NO_CWD = '(unknown working dir)'
const cache = new Map() // rootDir -> { at, byId, byCwd }
const TTL = 1500

export function invalidateIndex(rootDir) {
  if (rootDir) cache.delete(rootDir)
  else cache.clear()
}

export function buildIndex(rootDir) {
  const cached = cache.get(rootDir)
  if (cached && Date.now() - cached.at < TTL) return cached
  const files = walkSessionFiles(sessionsDir(rootDir), [])
  const byId = new Map()
  const byCwd = new Map()
  for (const f of files) {
    // de-dupe: if the same id appears twice (shouldn't), keep the newer file
    const prev = byId.get(f.id)
    if (prev && prev.mtimeMs >= f.mtimeMs) continue
    const head = readHead(f.file)
    const entry = {
      id: f.id, file: f.file, mtimeMs: f.mtimeMs, cwd: head.cwd, startTs: head.startTs, branch: head.branch,
      isSubagent: head.isSubagent, parentId: head.parentId, agentRole: head.agentRole, agentNickname: head.agentNickname, depth: head.depth,
    }
    byId.set(f.id, entry)
  }
  for (const entry of byId.values()) {
    const slug = entry.cwd || NO_CWD
    if (!byCwd.has(slug)) byCwd.set(slug, [])
    byCwd.get(slug).push(entry)
  }
  const built = { at: Date.now(), byId, byCwd }
  cache.set(rootDir, built)
  return built
}

/** Project (cwd group) list: one entry per distinct cwd. */
export function listProjects(rootDir) {
  const { byCwd } = buildIndex(rootDir)
  const projects = []
  for (const [slug, entries] of byCwd) {
    let lastActivity = 0
    for (const e of entries) if (e.mtimeMs > lastActivity) lastActivity = e.mtimeMs
    // count only top-level sessions; subagent threads are shown under their parent
    const sessionCount = entries.filter((e) => !e.isSubagent).length
    projects.push({ slug, cwd: slug === NO_CWD ? null : slug, sessionCount, lastActivity })
  }
  return projects.sort((a, b) => b.lastActivity - a.lastActivity)
}

/** All rollout files for a given project (cwd slug), with subagent metadata. */
export function sessionFiles(rootDir, slug) {
  const { byCwd } = buildIndex(rootDir)
  return (byCwd.get(slug) || []).map((e) => ({
    id: e.id, file: e.file, mtimeMs: e.mtimeMs,
    isSubagent: e.isSubagent, parentId: e.parentId, agentRole: e.agentRole, agentNickname: e.agentNickname, depth: e.depth,
  }))
}

/** Subagent threads spawned by a session (children point back via parentId). */
export function childrenOf(rootDir, parentId) {
  if (!parentId) return []
  const { byId } = buildIndex(rootDir)
  return [...byId.values()]
    .filter((e) => e.parentId === parentId)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((e) => ({ id: e.id, mtimeMs: e.mtimeMs, agentRole: e.agentRole, agentNickname: e.agentNickname, depth: e.depth }))
}

/** Locate a single rollout file by its unique session id. */
export function sessionFileById(rootDir, id) {
  const { byId } = buildIndex(rootDir)
  return byId.get(id) || null
}

/** cwd for a session id (from the index head read). */
export function cwdForId(rootDir, id) {
  const e = sessionFileById(rootDir, id)
  if (!e) return null
  // A brand-new rollout may have been indexed before its session_meta cwd was
  // flushed to disk — re-read the head live so live updates group it correctly
  // (and the cached entry is updated in place for next time).
  if (!e.cwd) e.cwd = readHead(e.file).cwd
  return e.cwd || null
}

// Tail-read a rollout for its newest rate_limits snapshot. rate_limits ride on
// token_count event_msg records, so we read the last chunk of the file and scan
// backwards for the most recent line carrying them. The first (possibly partial)
// line in the window simply fails JSON.parse and is skipped.
function tailRateLimits(file) {
  const WINDOW = 128 * 1024
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - WINDOW)
    const len = size - start
    if (len <= 0) return null
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const s = lines[i].trim()
      if (!s || !s.includes('rate_limits')) continue
      let rec
      try {
        rec = JSON.parse(s)
      } catch {
        continue
      }
      const p = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec
      if (p.rate_limits) return { rateLimits: p.rate_limits, ts: rec.timestamp || p.timestamp || null, sessionId: idFromFilename(path.basename(file)) }
    }
  } catch {
    // fall through
  } finally {
    fs.closeSync(fd)
  }
  return null
}

// Account-level newest rate_limits across this root — the 5-hour/weekly quota is
// global. We scan the most recently active sessions and return the snapshot with
// the newest TIMESTAMP, not just the one from the newest file: a file can be the
// most-recently-touched yet carry an older rate_limits reading than another
// session, which would otherwise surface a stale (e.g. end-of-window) percentage.
export function latestRateLimits(rootDir) {
  const { byId } = buildIndex(rootDir)
  const recent = [...byId.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 12)
  let best = null
  let bestTs = -1
  for (const e of recent) {
    const r = tailRateLimits(e.file)
    if (!r) continue
    const t = r.ts ? new Date(r.ts).getTime() : 0
    if (t > bestTs) {
      bestTs = t
      best = r
    }
  }
  return best
}

// The Codex CLI version that produced the most recent session — read from the
// `cli_version` field on the session_meta record. This is the version AgentDeck
// has *observed* tracking, not necessarily what's installed right now.
export function latestCliVersion(rootDir) {
  const { byId } = buildIndex(rootDir)
  const recent = [...byId.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5)
  for (const e of recent) {
    try {
      const fd = fs.openSync(e.file, 'r')
      const buf = Buffer.alloc(65536)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      // session_meta is one long line (it embeds base_instructions), so a 64KB
      // window can truncate it and break JSON.parse. cli_version sits near the
      // start of that line, so match it directly instead of parsing the record.
      const m = buf.toString('utf8', 0, n).match(/"cli_version"\s*:\s*"([^"]+)"/)
      if (m) return m[1]
    } catch {}
  }
  return null
}

export { NO_CWD }
