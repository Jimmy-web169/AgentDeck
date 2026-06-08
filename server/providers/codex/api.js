import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  rootsWithMeta,
  addRoot,
  removeRoot,
  resolveRoot,
  listProjects,
  sessionFiles,
  sessionFileById,
  childrenOf,
  cwdForId,
  expandHome,
  isSessionId,
  latestRateLimits,
  latestCliVersion,
} from './paths.js'
import { readRecords, buildTimeline, summarize } from './parser.js'
import { inventory, createResource, deleteResource } from './resources.js'
import { parseSkillsAdd, runSkillsAdd } from '../../shared/skills.js'
import { SKILL_CONFIG } from './skills.js'
import { readMemories, readPlugins } from './codex-data.js'
import { makeDispatch } from '../../shared/dispatch.js'
import { openTool, pickFolderNative } from '../../shared/launch.js'
import { startTerminal, stopTerminal, listTerminals, listLiveTmux, findOnPath } from '../../shared/terminal.js'

const TERMINAL_CONFIG = {
  findBin: () => findOnPath(['codex'], [path.join(os.homedir(), '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex']),
  title: 'codex',
  envKey: 'CODEX_HOME',
  resumeArgs: (id) => ['resume', id],
  checkOrigin: true,
}


function httpErr(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// --- roots -------------------------------------------------------------------

function getRoots() {
  const roots = rootsWithMeta()
  return { roots, default: roots[0]?.id || null }
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

// --- projects / sessions -----------------------------------------------------

function getProjects(q) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, rootDir: root.dir, projects: listProjects(root.dir) }
}

function getSessions(q) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  if (!slug) throw httpErr(400, 'missing slug')
  const sessions = sessionFiles(root.dir, slug)
    // subagent threads are hidden here — they're viewed from the parent's Sub-agents tab
    .filter((f) => !f.isSubagent)
    .map((f) => {
      const s = summarize(readRecords(f.file), f.id)
      s.mtime = f.mtimeMs
      s.isSubagent = f.isSubagent
      s.parentId = f.parentId
      s.agentRole = f.agentRole
      s.agentNickname = f.agentNickname
      s.childCount = childrenOf(root.dir, f.id).length
      return s
    })
    .sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || ''))
  return { root: root.id, slug, sessions }
}

function findFile(rootDir, id) {
  const entry = sessionFileById(rootDir, id)
  if (!entry) throw httpErr(404, 'session not found')
  return entry
}

function getSession(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findFile(root.dir, id)
  const recs = readRecords(entry.file)
  const summary = summarize(recs, id)
  summary.isSubagent = entry.isSubagent
  summary.parentId = entry.parentId
  summary.agentRole = entry.agentRole
  summary.agentNickname = entry.agentNickname
  return { root: root.id, slug: summary.cwd || entry.cwd || '(unknown working dir)', id, summary, children: childrenOf(root.dir, id), timeline: buildTimeline(recs) }
}

// subagent threads spawned by a session (separate rollouts linked via parent id)
function getSubagents(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  // Each subagent is its own rollout; summarize it so the UI can show context%,
  // turns and tokens without loading the full transcript up front.
  const children = childrenOf(root.dir, id).map((c) => {
    const entry = sessionFileById(root.dir, c.id)
    let s = null
    try {
      if (entry) s = summarize(readRecords(entry.file), c.id)
    } catch {}
    return {
      ...c,
      title: s?.title || null,
      firstPrompt: s?.firstPrompt || '',
      userTurns: s?.userTurns || 0,
      assistantTurns: s?.assistantTurns || 0,
      toolCalls: s?.toolCalls || 0,
      models: s?.models || [],
      tokens: s?.tokens || null,
      contextWindow: s?.contextWindow || 0,
      lastTokenUsage: s?.lastTokenUsage || null,
      firstTs: s?.firstTs || null,
      lastTs: s?.lastTs || null,
    }
  })
  return { root: root.id, id, children }
}

function getRaw(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  return { root: root.id, id, records: readRecords(findFile(root.dir, id).file) }
}

// --- stats -------------------------------------------------------------------

const zeroTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0, reasoning: 0, total: 0 })
function addTokens(into, t) {
  into.input += t.input || 0
  into.output += t.output || 0
  into.cacheRead += t.cacheRead || 0
  into.cacheCreate += t.cacheCreate || 0
  into.reasoning += t.reasoning || 0
  into.total += t.total || 0
}

// root-level totals + a per-project (cwd) rollup. Drill into a project's
// per-session breakdown via GET /api/sessions?root=&slug= .
function getStats(q) {
  const root = resolveRoot(q.get('root'))
  let sessions = 0
  let userTurns = 0
  let toolCalls = 0
  const toolCounts = {}
  const modelCounts = {}
  const tokens = zeroTokens()
  const projects = []
  for (const proj of listProjects(root.dir)) {
    const acc = { slug: proj.slug, cwd: proj.cwd, sessions: proj.sessionCount, userTurns: 0, toolCalls: 0, tokens: zeroTokens(), toolCounts: {}, models: new Set(), lastActivity: proj.lastActivity }
    for (const f of sessionFiles(root.dir, proj.slug)) {
      const s = summarize(readRecords(f.file), f.id)
      sessions++
      userTurns += s.userTurns
      toolCalls += s.toolCalls
      acc.userTurns += s.userTurns
      acc.toolCalls += s.toolCalls
      addTokens(tokens, s.tokens)
      addTokens(acc.tokens, s.tokens)
      for (const [k, v] of Object.entries(s.toolCounts)) {
        toolCounts[k] = (toolCounts[k] || 0) + v
        acc.toolCounts[k] = (acc.toolCounts[k] || 0) + v
      }
      for (const m of s.models) {
        modelCounts[m] = (modelCounts[m] || 0) + 1
        acc.models.add(m)
      }
    }
    projects.push({ ...acc, models: [...acc.models] })
  }
  projects.sort((a, b) => b.lastActivity - a.lastActivity)
  return { root: root.id, projectCount: projects.length, sessions, userTurns, toolCalls, toolCounts, modelCounts, tokens, projects }
}

// --- history -----------------------------------------------------------------

function getHistory(q) {
  const root = resolveRoot(q.get('root'))
  const out = []
  try {
    for (const line of fs.readFileSync(path.join(root.dir, 'history.jsonl'), 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        // ts is unix seconds → ms for the UI's time formatter
        out.push({ display: o.text || '', sessionId: o.session_id || null, ts: o.ts ? o.ts * 1000 : null })
      } catch {}
    }
  } catch {}
  return { root: root.id, history: out.reverse().slice(0, 500) }
}

// --- configurable resources (user scope + project scope) ---------------------
// User scope = the tracked Codex home. Project scope = a project's working dir
// (slug is the cwd), whose config/agents/hooks/rules live under <cwd>/.codex/.

function getResources(q) {
  const root = resolveRoot(q.get('root'))
  const scope = q.get('scope') === 'project' ? 'project' : 'user'
  let base
  if (scope === 'project') {
    const slug = q.get('slug')
    if (!slug || !path.isAbsolute(slug)) throw httpErr(400, 'project scope needs a project (cwd) slug')
    if (!fs.existsSync(slug)) throw httpErr(404, `project directory no longer exists: ${slug}`)
    base = slug
  } else {
    base = root.dir
  }
  return { root: root.id, ...inventory(scope, base) }
}

// Create a resource (agent / skill / hook / mcp server / AGENTS.md) at the
// chosen scope. Writes to the user's own Codex home or project .codex/ dir.
function scopeBase(root, scope, slug) {
  if (scope !== 'project') return root.dir
  if (!slug || !path.isAbsolute(slug)) throw httpErr(400, 'project scope needs a project (cwd) slug')
  if (!fs.existsSync(slug)) throw httpErr(404, `project directory no longer exists: ${slug}`)
  return slug
}

function postResource(_q, body) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  const scope = body.scope === 'project' ? 'project' : 'user'
  const base = scopeBase(root, scope, body.slug)
  const file = createResource(scope, base, body)
  return { ok: true, path: file }
}

// Delete a resource at the chosen scope. file/dir resources go to the OS trash;
// embedded ones (mcp/hook) are stripped from their host file. See deleteResource.
function deleteResourceHandler(q) {
  const root = resolveRoot(q.get('root'))
  const scope = q.get('scope') === 'project' ? 'project' : 'user'
  const base = scopeBase(root, scope, q.get('slug'))
  const kind = q.get('kind')
  const name = q.get('name')
  if (!kind || !name) throw httpErr(400, 'missing kind or name')
  return deleteResource(scope, base, kind, name)
}

// Account-level usage snapshot for the top status bar: the newest 5-hour
// (primary) / weekly (secondary) rate-limit percentages across this root.
function getUsage(q) {
  const root = resolveRoot(q.get('root'))
  const snap = latestRateLimits(root.dir) // { rateLimits, ts, sessionId } | null
  return { rateLimits: snap?.rateLimits || null, ts: snap?.ts || null, sessionId: snap?.sessionId || null }
}

// The Codex CLI version observed in the most recent tracked session.
function getVersion(q) {
  const root = resolveRoot(q.get('root'))
  return { version: latestCliVersion(root.dir) }
}

// Codex per-conversation memories (read-only, from memories_1.sqlite).
function getMemory(q) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, ...readMemories(root.dir) }
}

// Installed Codex plugins (from plugins/cache + config.toml enabled-state).
function getPlugins(q) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, ...readPlugins(root.dir) }
}

// --- skill install: delegate to the `skills` CLI (npx skills add -a codex) ----
// Runs an external program on the user's machine after the UI confirms.
async function postSkillRun(_q, body) {
  if (!body?.root) throw httpErr(400, 'missing root')
  if (!body?.ref) throw httpErr(400, 'missing ref')
  const root = resolveRoot(body.root)
  const args = parseSkillsAdd(body.ref, SKILL_CONFIG)
  if (body.slug && path.isAbsolute(body.slug)) {
    // project scope: install cwd-relative into <cwd>/.codex (or .agents) skills
    if (!fs.existsSync(body.slug)) throw httpErr(404, `project directory no longer exists: ${body.slug}`)
    return await runSkillsAdd({ cwd: body.slug, args, global: false, configDir: null, config: SKILL_CONFIG })
  }
  // user scope: -g + CODEX_HOME=<root> installs into <root>/skills
  return await runSkillsAdd({ cwd: root.dir, args, global: true, configDir: root.dir, config: SKILL_CONFIG })
}

// --- open local app (editor / terminal) at a session's working dir -----------

async function postOpen(_q, body) {
  if (!body?.root || !body?.what) throw httpErr(400, 'missing root/what')
  const root = resolveRoot(body.root)
  let cwd = null
  if (body.cwd && path.isAbsolute(body.cwd) && fs.existsSync(body.cwd)) cwd = body.cwd
  else if (body.id) cwd = cwdForId(root.dir, body.id)
  else if (body.slug && path.isAbsolute(body.slug)) cwd = body.slug // slug is the cwd
  if (!cwd || !path.isAbsolute(cwd)) throw httpErr(404, 'cannot resolve a working directory')
  await openTool(body.what, cwd)
  return { ok: true, what: body.what, cwd }
}

// --- terminal mode: embedded ttyd running the real codex TUI -----------------

async function postTerminal(_q, body) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  let cwd
  let key
  let resumeId = null
  if (body.id) {
    if (!isSessionId(body.id)) throw httpErr(400, 'invalid session id') // goes to `codex resume <id>` as argv
    cwd = cwdForId(root.dir, body.id) // continue an existing session
    resumeId = body.id
    key = `${root.id}|${body.id}`
  } else if (body.cwd) {
    cwd = body.cwd // new conversation at an explicit path
    key = `${root.id}|new|${body.cwd}`
  } else if (body.slug && path.isAbsolute(body.slug)) {
    cwd = body.slug // new conversation under an existing project (slug is the cwd)
    key = `${root.id}|new|${body.slug}`
  } else {
    throw httpErr(400, 'missing id or cwd')
  }
  if (!cwd || !fs.existsSync(cwd)) cwd = root.dir
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
// localhost-only; lists directory NAMES only (no file contents).

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

async function getPickFolder() {
  return await pickFolderNative()
}

// --- dispatcher --------------------------------------------------------------

const ROUTES = {
  'GET /api/roots': getRoots,
  'POST /api/roots': postRoots,
  'DELETE /api/roots': deleteRoots,
  'GET /api/projects': getProjects,
  'GET /api/sessions': getSessions,
  'GET /api/session': getSession,
  'GET /api/subagents': getSubagents,
  'GET /api/raw': getRaw,
  'GET /api/stats': getStats,
  'GET /api/history': getHistory,
  'GET /api/usage': getUsage,
  'GET /api/version': getVersion,
  'GET /api/memory': getMemory,
  'GET /api/plugins': getPlugins,
  'GET /api/resources': getResources,
  'POST /api/resource': postResource,
  'DELETE /api/resource': deleteResourceHandler,
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
