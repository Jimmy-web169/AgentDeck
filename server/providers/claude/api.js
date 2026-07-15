import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  rootsWithMeta,
  addRoot,
  removeRoot,
  resolveRoot,
  sessionFiles,
  sessionHasSubagents,
  listProjectSlugs,
  assertInside,
  expandHome,
} from './paths.js'
import { readRecords, buildTimeline, summarize } from './parser.js'
import { cachedRecords, cachedDerived } from '../../shared/parseCache.js'

// All transcript reads below go through the fingerprint cache: a stat per
// request revalidates, so results are exactly as fresh as parsing every time.
const sessionRecords = (file) => cachedRecords(file, readRecords)
const sessionSummary = (file, id) => cachedDerived(file, 'summary', () => summarize(sessionRecords(file), id))
const sessionTimeline = (file) => cachedDerived(file, 'timeline', () => buildTimeline(sessionRecords(file)))

// `_etag` on a GET response body lets the server answer If-None-Match with a
// 304 (see server/index.js). It's derived from the same fingerprints the parse
// cache validates against, so it changes exactly when the payload would.
function fileEtag(file, extra = '') {
  const st = fs.statSync(file)
  return `"${st.mtimeMs}:${st.size}${extra ? `:${extra}` : ''}"`
}
import { discoverRuns, discoverPlainAgents } from './runs.js'
import { inventory, readResource, writeResource, deleteResource } from './resources.js'
import { safeTrash } from '../../shared/trash.js'
import { parseSkillsAdd, runSkillsAdd } from '../../shared/skills.js'
import { SKILL_CONFIG } from './skills.js'
import { openTool, pickFolderNative } from '../../shared/launch.js'
import { makeDispatch } from '../../shared/dispatch.js'
import { startTerminal, stopTerminal, listTerminals, listLiveTmux, findOnPath } from '../../shared/terminal.js'

const TERMINAL_CONFIG = {
  findBin: () => findOnPath(['claude'], [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']),
  title: 'claude',
  envKey: 'CLAUDE_CONFIG_DIR',
  resumeArgs: (id) => ['--resume', id],
  checkOrigin: false,
}


function httpErr(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// --- helpers -----------------------------------------------------------------

function readCwd(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(65536)
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    const chunk = buf.toString('utf8', 0, bytes)
    const lines = chunk.split('\n')
    if (!chunk.endsWith('\n')) lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line)
        if (rec && typeof rec.cwd === 'string') return rec.cwd
      } catch {}
    }
  } catch {}
  return null
}

function projectInfo(rootDir, slug) {
  const files = sessionFiles(rootDir, slug)
  if (!files.length) return null
  let newest = files[0]
  let newestM = 0
  for (const f of files) {
    try {
      const m = fs.statSync(f.file).mtimeMs
      if (m >= newestM) {
        newestM = m
        newest = f
      }
    } catch {}
  }
  return { slug, cwd: readCwd(newest.file), sessionCount: files.length, lastActivity: newestM }
}

// --- read handlers -----------------------------------------------------------

function getRoots() {
  return { roots: rootsWithMeta(), default: rootsWithMeta()[0]?.id || null }
}

function postRoots(_q, body) {
  if (!body?.path) throw httpErr(400, 'missing path')
  return addRoot(body.path, body.label)
}

function deleteRoots(q) {
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  return removeRoot(id)
}

function getProjects(q) {
  const root = resolveRoot(q.get('root'))
  const projects = listProjectSlugs(root.dir)
    .map((slug) => projectInfo(root.dir, slug))
    .filter(Boolean)
    .sort((a, b) => b.lastActivity - a.lastActivity)
  return { root: root.id, rootDir: root.dir, projects }
}

function getSessions(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  if (!slug) throw httpErr(400, 'missing slug')
  const parts = []
  const sessions = sessionFiles(root.dir, slug)
    .map((f) => {
      let mtime = 0
      let size = 0
      try {
        const st = fs.statSync(f.file)
        mtime = st.mtimeMs
        size = st.size
      } catch {}
      const s = { ...sessionSummary(f.file, f.id) }
      s.mtime = mtime
      s.hasSubagents = s.hasSidechain || sessionHasSubagents(root.dir, slug, f.id)
      parts.push(`${f.id}:${mtime}:${size}:${s.hasSubagents ? 1 : 0}`)
      return s
    })
    .sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || ''))
  const _etag = `"${crypto.createHash('sha1').update(parts.join('|')).digest('hex')}"`
  return { root: root.id, slug, sessions, _etag }
}

function findSessionFile(rootDir, slug, id) {
  const found = sessionFiles(rootDir, slug).find((f) => f.id === id)
  if (!found) throw httpErr(404, 'session not found')
  return found.file
}

function getSession(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  const file = findSessionFile(root.dir, slug, id)
  const summary = { ...sessionSummary(file, id) }
  summary.hasSubagents = summary.hasSidechain || sessionHasSubagents(root.dir, slug, id)
  return {
    root: root.id,
    slug,
    id,
    summary,
    timeline: sessionTimeline(file),
    _etag: fileEtag(file, summary.hasSubagents ? 'S' : ''),
  }
}

function getRaw(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  return { root: root.id, slug, id, records: sessionRecords(findSessionFile(root.dir, slug, id)) }
}

// Move a session to the OS trash (recoverable): its .jsonl transcript plus its
// sidecar dir (subagents / workflow runs), which lives next to the .jsonl under
// the same id. The id is matched against the real directory listing (via
// findSessionFile), so it can't address anything but an existing session.
// Sidecar first: if that fails the session stays listed and a retry covers both.
async function deleteSession(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  const file = findSessionFile(root.dir, slug, id)
  const sideDir = path.join(root.dir, 'projects', slug, id)
  assertInside(root.dir, sideDir)
  if (fs.existsSync(sideDir)) await safeTrash(sideDir)
  await safeTrash(file)
  return { root: root.id, slug, id, trashed: true }
}

function getSubagents(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  return {
    root: root.id,
    slug,
    id,
    runs: discoverRuns(root.dir, slug, id),
    agents: discoverPlainAgents(root.dir, slug, id),
  }
}

// Full transcript of a single sub-agent: its prompt, tool calls, and process.
// Workflow agent: pass run=wf_... ; plain Task/Agent: omit run.
function getSubagent(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const session = q.get('session')
  const run = q.get('run')
  const agent = q.get('agent')
  if (!slug || !session || !agent) throw httpErr(400, 'missing slug/session/agent')
  if (/[\\/]/.test(agent) || agent.includes('..')) throw httpErr(400, 'bad agent')
  const subagentsDir = path.join(root.dir, 'projects', slug, session, 'subagents')
  let file
  if (run) {
    if (!/^wf_[\w.-]+$/.test(run)) throw httpErr(400, 'bad run')
    file = path.join(subagentsDir, 'workflows', run, `agent-${agent}.jsonl`)
  } else {
    file = path.join(subagentsDir, `agent-${agent}.jsonl`)
  }
  assertInside(root.dir, file)
  if (!fs.existsSync(file)) throw httpErr(404, 'agent transcript not found')
  return { root: root.id, run, agent, summary: sessionSummary(file, agent), timeline: sessionTimeline(file), _etag: fileEtag(file) }
}

const zeroTokens = () => ({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 })
function addTokens(into, t) {
  into.input += t.input
  into.output += t.output
  into.cacheCreate += t.cacheCreate
  into.cacheRead += t.cacheRead
}

// root-level totals + a per-project rollup. Drill into a project's per-session
// breakdown via GET /api/sessions?root=&slug= (already per-session summaries).
function getStats(q) {
  const root = resolveRoot(q.get('root'))
  let sessions = 0
  let userTurns = 0
  let toolCalls = 0
  const toolCounts = {}
  const modelCounts = {}
  const tokens = zeroTokens()
  const projects = []
  for (const slug of listProjectSlugs(root.dir)) {
    const files = sessionFiles(root.dir, slug)
    if (!files.length) continue
    const proj = { slug, cwd: null, sessions: files.length, userTurns: 0, toolCalls: 0, tokens: zeroTokens(), toolCounts: {}, models: new Set(), lastActivity: 0 }
    for (const f of files) {
      const s = sessionSummary(f.file, f.id)
      let mtime = 0
      try {
        mtime = fs.statSync(f.file).mtimeMs
      } catch {}
      if (mtime > proj.lastActivity) {
        proj.lastActivity = mtime
        proj.cwd = readCwd(f.file) || proj.cwd
      }
      sessions++
      userTurns += s.userTurns
      toolCalls += s.toolCalls
      proj.userTurns += s.userTurns
      proj.toolCalls += s.toolCalls
      addTokens(tokens, s.tokens)
      addTokens(proj.tokens, s.tokens)
      for (const [k, v] of Object.entries(s.toolCounts)) {
        toolCounts[k] = (toolCounts[k] || 0) + v
        proj.toolCounts[k] = (proj.toolCounts[k] || 0) + v
      }
      for (const m of s.models) {
        modelCounts[m] = (modelCounts[m] || 0) + 1
        proj.models.add(m)
      }
    }
    projects.push({ ...proj, models: [...proj.models] })
  }
  projects.sort((a, b) => b.lastActivity - a.lastActivity)
  return { root: root.id, projectCount: projects.length, sessions, userTurns, toolCalls, toolCounts, modelCounts, tokens, projects }
}

function getHistory(q) {
  const root = resolveRoot(q.get('root'))
  const out = []
  try {
    for (const line of fs.readFileSync(path.join(root.dir, 'history.jsonl'), 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        out.push({ display: o.display, project: o.project, ts: o.timestamp || o.ts || null })
      } catch {}
    }
  } catch {}
  return { root: root.id, history: out.reverse().slice(0, 500) }
}

function getMemory(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  if (!slug) throw httpErr(400, 'missing slug')
  const dir = path.join(root.dir, 'projects', slug, 'memory')
  const files = []
  let index = null
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const content = fs.readFileSync(path.join(dir, name), 'utf8')
      if (name === 'MEMORY.md') index = content
      else files.push({ name, content })
    }
  } catch {}
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { root: root.id, slug, index, files }
}

// Memory files are flat .md files under projects/<slug>/memory (getMemory reads
// them non-recursively), so names allow no separators at all — stricter than
// resources' safeName, which permits '/' for nested rules.
function checkMemoryName(name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    throw httpErr(400, `Invalid name: ${name}`)
  }
  if (!name.endsWith('.md')) throw httpErr(400, 'Name must end with .md')
  return name
}

function memoryFile(root, slug, name) {
  const file = path.join(root.dir, 'projects', slug, 'memory', name)
  assertInside(root.dir, file) // also guards slug traversal — the joined path must stay inside the root
  return file
}

function postMemory(_q, body) {
  if (!body?.root || !body?.slug || !body?.name) throw httpErr(400, 'missing root/slug/name')
  // JSON bodies can carry non-strings — reject early instead of 500ing deeper down
  if (typeof body.slug !== 'string' || typeof body.name !== 'string') throw httpErr(400, 'slug/name must be strings')
  if (body.content != null && typeof body.content !== 'string') throw httpErr(400, 'content must be a string')
  const root = resolveRoot(body.root)
  checkMemoryName(body.name)
  const file = memoryFile(root, body.slug, body.name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body.content ?? '')
  return { root: root.id, slug: body.slug, name: body.name, bytes: (body.content ?? '').length }
}

async function deleteMemory(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const name = q.get('name')
  if (!slug || !name) throw httpErr(400, 'missing slug/name')
  checkMemoryName(name)
  const file = memoryFile(root, slug, name)
  if (!fs.existsSync(file)) throw httpErr(404, 'memory file not found')
  await safeTrash(file)
  return { root: root.id, slug, name, trashed: true }
}

// installed_plugins.json (v2) is { version, plugins: { "<name>@<marketplace>":
// [ { scope, version, installedAt, lastUpdated, installPath, gitCommitSha } ] } }.
// Normalize to a flat list. Tolerate the legacy array / keyed-object shapes too.
function normalizeInstalledPlugins(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === 'string' ? { name: x } : x))
  // v2 nests the real map under `plugins`; legacy keyed objects don't.
  const map = raw.plugins && typeof raw.plugins === 'object' ? raw.plugins : raw
  const out = []
  for (const [key, val] of Object.entries(map)) {
    const at = key.lastIndexOf('@')
    const rec = Array.isArray(val) ? val[0] || {} : val && typeof val === 'object' ? val : {}
    out.push({
      name: at > 0 ? key.slice(0, at) : key,
      marketplace: at > 0 ? key.slice(at + 1) : rec.marketplace ?? null,
      version: rec.version ?? null,
      scope: rec.scope ?? null,
      installedAt: rec.installedAt ?? null,
      lastUpdated: rec.lastUpdated ?? null,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function getPlugins(q) {
  const root = resolveRoot(q.get('root'))
  const pdir = path.join(root.dir, 'plugins')
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8'))
    } catch {
      return null
    }
  }
  const installedRaw = readJson('installed_plugins.json')
  const known = readJson('known_marketplaces.json') || {}
  // marketplaces actually present on disk, annotated with their source repo
  let marketplaces = []
  try {
    marketplaces = fs
      .readdirSync(path.join(pdir, 'marketplaces'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, repo: known[e.name]?.source?.repo || null }))
  } catch {}
  return {
    root: root.id,
    installed: normalizeInstalledPlugins(installedRaw),
    marketplaces,
  }
}

// --- resources ---------------------------------------------------------------

function projectCwd(rootDir, slug) {
  const files = sessionFiles(rootDir, slug)
  if (!files.length) throw httpErr(404, 'project not found')
  let newest = files[0]
  let m0 = 0
  for (const f of files) {
    try {
      const m = fs.statSync(f.file).mtimeMs
      if (m >= m0) {
        m0 = m
        newest = f
      }
    } catch {}
  }
  const cwd = readCwd(newest.file)
  if (!cwd || !path.isAbsolute(cwd)) throw httpErr(404, 'cannot resolve project cwd')
  return cwd
}

// Resolve the base .claude dir: user scope = the tracked root itself; project
// scope (slug given) = <project-cwd>/.claude (the repo's committed config).
function resolveScope(rootId, slug) {
  const root = resolveRoot(rootId)
  if (slug) {
    const cwd = projectCwd(root.dir, slug)
    return { root, base: path.join(cwd, '.claude'), claudeRoot: cwd, scope: 'project', label: cwd }
  }
  return { root, base: root.dir, claudeRoot: root.dir, scope: 'root', label: root.label }
}

function getResources(q) {
  const s = resolveScope(q.get('root'), q.get('slug'))
  return { root: s.root.id, scope: s.scope, base: s.base, label: s.label, ...inventory(s.base, { claudeRoot: s.claudeRoot }) }
}

const PROJECT_ONLY = {
  mcpJson: '.mcp.json is project-scope only (user MCP lives in ~/.claude.json)',
  settingsLocalJson: 'settings.local.json is project-scope only',
}
function guardScope(kind, scope) {
  if (PROJECT_ONLY[kind] && scope !== 'project') throw httpErr(400, PROJECT_ONLY[kind])
}

function getResource(q) {
  const s = resolveScope(q.get('root'), q.get('slug'))
  guardScope(q.get('kind'), s.scope)
  return { root: s.root.id, scope: s.scope, ...readResource(s.base, q.get('kind'), q.get('name'), { claudeRoot: s.claudeRoot }) }
}

function postResource(_q, body) {
  if (!body?.root || !body?.kind || !body?.name) throw httpErr(400, 'missing root/kind/name')
  const s = resolveScope(body.root, body.slug)
  guardScope(body.kind, s.scope)
  return writeResource(s.base, body.kind, body.name, body.content || '', { claudeRoot: s.claudeRoot })
}

async function deleteResource_(q) {
  const s = resolveScope(q.get('root'), q.get('slug'))
  return deleteResource(s.base, q.get('kind'), q.get('name'), q.get('stamp'), { claudeRoot: s.claudeRoot })
}

// --- skill import: delegate to the `skills` CLI (npx skills add) -------------
// Runs an external program on the user's machine; the UI confirms before calling.

async function postSkillRun(_q, body) {
  if (!body?.root) throw httpErr(400, 'missing root')
  if (!body?.ref) throw httpErr(400, 'missing ref')
  const s = resolveScope(body.root, body.slug)
  const args = parseSkillsAdd(body.ref, SKILL_CONFIG)
  // project scope -> cwd-relative install into <project-cwd>/.claude/skills;
  // user scope -> -g + CLAUDE_CONFIG_DIR=<root> installs into <root>/skills.
  const global = s.scope !== 'project'
  const cwd = s.scope === 'project' ? s.claudeRoot : s.root.dir
  const configDir = global ? s.root.dir : null
  return await runSkillsAdd({ cwd, args, global, configDir, config: SKILL_CONFIG })
}

// --- open local app (editor / terminal) at a session's working dir -----------

async function postOpen(_q, body) {
  if (!body?.root || !body?.what) throw httpErr(400, 'missing root/what')
  const root = resolveRoot(body.root)
  let cwd = null
  if (body.cwd && path.isAbsolute(body.cwd) && fs.existsSync(body.cwd)) cwd = body.cwd // explicit (new-project draft)
  else if (body.slug && body.id) cwd = readCwd(findSessionFile(root.dir, body.slug, body.id))
  else if (body.slug) cwd = projectCwd(root.dir, body.slug) // draft / no specific session
  if (!cwd || !path.isAbsolute(cwd)) throw httpErr(404, 'cannot resolve this project’s working directory')
  await openTool(body.what, cwd)
  return { ok: true, what: body.what, cwd }
}

// --- terminal mode: embedded ttyd running the real claude TUI ----------------

async function postTerminal(_q, body) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  let cwd
  let key
  let resumeId = null
  if (body.id && body.slug) {
    cwd = readCwd(findSessionFile(root.dir, body.slug, body.id)) // continue existing
    resumeId = body.id
    key = `${root.id}|${body.slug}|${body.id}`
  } else if (body.cwd) {
    cwd = body.cwd // new conversation at an explicit path
    key = `${root.id}|new|${body.cwd}`
  } else if (body.slug) {
    cwd = projectCwd(root.dir, body.slug) // new conversation under an existing project
    key = `${root.id}|new|${body.slug}`
  } else {
    throw httpErr(400, 'missing slug/id or cwd')
  }
  if (!cwd || !fs.existsSync(cwd)) cwd = root.dir
  // CLAUDE_CONFIG_DIR = the session's tracked root → uses that account's login (the credential fix)
  const meta = { root: root.id, slug: body.slug || null, id: resumeId, cwd, isNew: !resumeId, title: body.title || null }
  const res = await startTerminal({ key, cwd, configDir: root.dir, resumeId, meta, config: TERMINAL_CONFIG })
  return { ok: true, key, ...res }
}

function getTerminals() {
  return { terminals: listTerminals() }
}

async function deleteTerminal(q) {
  return stopTerminal(q.get('key'))
}

// All live AgentDeck tmux sessions on the box (cross-provider; the pool is shared).
function getLiveTerminals() {
  return { terminals: listLiveTmux() }
}

// Unified live view: the running tmux terminals (the only persistent live kind).
function getActiveSessions() {
  return { tmux: listLiveTmux(), sdk: [] }
}

// --- filesystem folder browser (for "new project at a path" picker) ----------
// localhost-only; lists directory NAMES only (no file contents). OS-friendly via
// Node fs/path. Hidden dot-dirs are skipped in the listing (type a path to reach them).

function getBrowse(q) {
  const home = os.homedir()
  let dir = expandHome((q.get('path') || '').trim()) || home
  let resolved
  try {
    resolved = fs.realpathSync(dir)
  } catch {
    resolved = path.resolve(dir)
  }
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {}
  if (!stat || !stat.isDirectory()) throw httpErr(404, `Not a directory: ${dir}`)
  let dirs = []
  try {
    dirs = fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((e) => {
        try {
          return (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')
        } catch {
          return false
        }
      })
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    // permission denied etc. — return an empty listing rather than failing
  }
  const parent = path.dirname(resolved)
  return { path: resolved, parent: parent !== resolved ? parent : null, home, dirs }
}

// open the OS-native folder chooser (blocks until the user picks/cancels)
async function getPickFolder() {
  return await pickFolderNative()
}

// --- dispatcher --------------------------------------------------------------

// Usage limits (5-hour / weekly) bridged from the status line. Claude Code only
// exposes rate_limits to a status line command (never to disk), so an optional
// status line snippet writes <config_dir>/rate-limits.json, which we read here.
// See README "Usage limits bar". Absent file → null (bar simply hides).
function getUsage(q) {
  const root = resolveRoot(q.get('root'))
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root.dir, 'rate-limits.json'), 'utf8'))
    return { root: root.id, rateLimits: d.rate_limits || null, contextWindow: d.context_window || null, sessionId: d.session_id || null, updatedAt: d.updated_at || null }
  } catch {
    return { root: root.id, rateLimits: null, contextWindow: null, sessionId: null, updatedAt: null }
  }
}

// The Claude Code version observed in the most recent tracked session — read
// from the `version` field carried on transcript records. This is the version
// AgentDeck has *observed* tracking, not necessarily what's installed right now.
function latestClaudeVersion(rootDir) {
  const projectsDir = path.join(rootDir, 'projects')
  let newest = null
  try {
    for (const slug of fs.readdirSync(projectsDir)) {
      let entries
      try {
        entries = fs.readdirSync(path.join(projectsDir, slug))
      } catch {
        continue
      }
      for (const f of entries) {
        if (!f.endsWith('.jsonl')) continue
        const fp = path.join(projectsDir, slug, f)
        let m
        try {
          m = fs.statSync(fp).mtimeMs
        } catch {
          continue
        }
        if (!newest || m > newest.m) newest = { m, fp }
      }
    }
  } catch {}
  if (!newest) return null
  try {
    const fd = fs.openSync(newest.fp, 'r')
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      if (!line.includes('"version"')) continue
      try {
        const r = JSON.parse(line)
        if (typeof r.version === 'string') return r.version
      } catch {}
    }
  } catch {}
  return null
}

function getVersion(q) {
  const root = resolveRoot(q.get('root'))
  return { version: latestClaudeVersion(root.dir) }
}

const ROUTES = {
  'GET /api/roots': getRoots,
  'POST /api/roots': postRoots,
  'DELETE /api/roots': deleteRoots,
  'GET /api/projects': getProjects,
  'GET /api/sessions': getSessions,
  'GET /api/session': getSession,
  'DELETE /api/session': deleteSession,
  'GET /api/raw': getRaw,
  'GET /api/subagents': getSubagents,
  'GET /api/subagent': getSubagent,
  'GET /api/stats': getStats,
  'GET /api/history': getHistory,
  'GET /api/memory': getMemory,
  'POST /api/memory': postMemory,
  'DELETE /api/memory': deleteMemory,
  'GET /api/plugins': getPlugins,
  'GET /api/usage': getUsage,
  'GET /api/version': getVersion,
  'GET /api/resources': getResources,
  'GET /api/resource': getResource,
  'POST /api/resource': postResource,
  'DELETE /api/resource': deleteResource_,
  'POST /api/skill-run': postSkillRun,
  'POST /api/open': postOpen,
  'GET /api/browse': getBrowse,
  'GET /api/pick-folder': getPickFolder,
  'POST /api/terminal': postTerminal,
  'GET /api/terminals': getTerminals,
  'GET /api/live-terminals': getLiveTerminals,
  'GET /api/active-sessions': getActiveSessions,
  'DELETE /api/terminal': deleteTerminal,
}

export const dispatch = makeDispatch(ROUTES)
