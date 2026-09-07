import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  rootsWithMeta,
  renameRoot,
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
  invalidateIndex,
  readTitle,
  dbFile,
  annotationFile,
  brainDir,
  isLive,
  NO_CWD,
} from './paths.js'
import { readRecords, buildTimeline, summarize } from './parser.js'
import { inventory, readPlugins } from './resources.js'
import { sqliteAvailable } from './sqlite.js'
import { addTokens, tokenFields, withTotal, zeroTokens as zeroTokensShared } from '../../shared/tokens.js'
import { child } from '../../shared/children.js'
import { cachedRecords, cachedDerived, fingerprintOf, etagOf } from '../../shared/parseCache.js'
import { withOversizeFallback } from '../../shared/transcriptGuard.js'
import { safeTrash } from '../../shared/trash.js'
import { makeDispatch } from '../../shared/dispatch.js'
import { bucketActivity } from '../../shared/activity.js'
import { openTool, pickFolderNative } from '../../shared/launch.js'
import { startTerminal, stopTerminal, listTerminals, listLiveTmux, findOnPath } from '../../shared/terminal.js'

// Google Antigravity CLI (`agy`) — id-addressed like Codex: a session is a
// conversation id, its project (workspace) is derived. The transcript gives
// turns and tool calls; the per-conversation SQLite (sqlite.js) gives the
// workspace, the model and the tokens. See spec/providers/antigravity.yaml.

const TERMINAL_CONFIG = {
  findBin: () => findOnPath(['agy'], [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'), path.join(os.homedir(), '.local/bin/agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy']),
  title: 'agy',
  envKey: 'AGENTDECK_PROVIDER_HOME', // agy has no documented home-dir variable; the tracked folder is still recorded on the tmux session
  resumeArgs: (id) => ['--conversation', id],
  checkOrigin: false,
}
const TOKEN_SPECIFIC = ['reasoning']
const zeroTokens = () => zeroTokensShared(TOKEN_SPECIFIC)

const sessionRecords = (file, fp) => cachedRecords(file, readRecords, fp)
const sessionTimeline = (file, fp) => cachedDerived(file, 'timeline', () => buildTimeline(sessionRecords(file, fp)), fp)
const parsedSummary = (file, id, fp) => cachedDerived(file, 'summary', () => summarize(sessionRecords(file, fp), id), fp)
const oversizeStub = (id, e) => ({ ...summarize([], id), title: `(transcript too large — ${Math.round((e.bytes || 0) / 1e6)} MB)`, oversized: true })
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

function httpErr(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// the parsed summary plus everything the transcript does not carry: workspace,
// model and tokens (SQLite), the annotation title, sub-agent links
function sessionSummary(rootDir, entry, fp) {
  const base = withOversizeFallback(
    () => parsedSummary(entry.file, entry.id, fp),
    (e) => oversizeStub(entry.id, e)
  )
  const s = { ...base }
  s.cwd = entry.cwd || null
  s.title = readTitle(rootDir, entry.id) || base.title
  if (entry.model) s.models = [entry.model]
  if (entry.tokens) s.tokens = withTotal({ ...entry.tokens })
  s.gitRepo = entry.gitRepo || null
  s.branch = entry.branch || null
  s.isSubagent = !!entry.isSubagent
  s.parentId = entry.parentId || null
  s.childCount = entry.children?.length || 0
  s.live = isLive(rootDir, entry.id)
  s.mtime = entry.mtimeMs
  return s
}
const fpOf = (file) => {
  try {
    return fingerprintOf(file)
  } catch {
    return undefined
  }
}

// --- roots -------------------------------------------------------------------

function getRoots() {
  const roots = rootsWithMeta()
  return { roots, default: roots[0]?.id || null, sqlite: sqliteAvailable() }
}
function postRoots(_q, body) {
  if (!body?.path) throw httpErr(400, 'missing path')
  return addRoot(body.path, body.label)
}
function postRootLabel(_q, body) {
  if (!body?.id) throw httpErr(400, 'missing id')
  return renameRoot(body.id, body.label)
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
  const parts = []
  const sessions = sessionFiles(root.dir, slug)
    .filter((e) => !e.isSubagent)
    .map((e) => {
      const fp = fpOf(e.file)
      const s = sessionSummary(root.dir, e, fp)
      parts.push(`${e.id}:${fp ? fp.key : '?'}:${s.tokens.total}:${s.childCount}`)
      return s
    })
    .sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || ''))
  return { root: root.id, slug, sessions, _etag: `"${sha1(parts.join('|'))}"` }
}

function findEntry(rootDir, id) {
  if (!isSessionId(id)) throw httpErr(400, 'invalid session id')
  const entry = sessionFileById(rootDir, id)
  if (!entry) throw httpErr(404, 'session not found')
  return entry
}

const toChild = (rootDir, c) => {
  const fp = fpOf(c.file)
  const s = sessionSummary(rootDir, c, fp)
  return child({
    id: c.id,
    parentId: c.parentId,
    kind: 'session',
    label: s.title || c.id,
    type: 'conversation',
    status: s.live || Date.now() - c.mtimeMs < 60000 ? 'running' : 'done',
    firstTs: s.firstTs,
    lastTs: s.lastTs,
    toolCalls: s.toolCalls,
    tokens: s.tokens,
    model: s.models?.[0] || null,
    extra: { mtimeMs: c.mtimeMs, title: s.title, firstPrompt: s.firstPrompt, userTurns: s.userTurns, assistantTurns: s.assistantTurns, models: s.models },
  })
}

function getSession(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findEntry(root.dir, id)
  const fp = fingerprintOf(entry.file)
  const summary = sessionSummary(root.dir, entry, fp)
  const children = childrenOf(root.dir, id).map((c) => toChild(root.dir, c))
  const childSig = children.length ? sha1(children.map((c) => `${c.id}:${c.mtimeMs}`).join(',')).slice(0, 16) : ''
  return { root: root.id, slug: summary.cwd || NO_CWD, id, summary, children, timeline: sessionTimeline(entry.file, fp), _etag: etagOf(fp, `${childSig}:${summary.tokens.total}`) }
}

// Move a conversation to the OS trash: its brain/<id> directory, its SQLite
// (with -wal / -shm), its annotation and presence lock — then its children.
async function deleteSession(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  findEntry(root.dir, id)
  const ids = [id]
  const seen = new Set(ids)
  for (let i = 0; i < ids.length; i++) for (const c of childrenOf(root.dir, ids[i])) if (!seen.has(c.id)) seen.add(c.id) && ids.push(c.id)
  for (const cid of ids.reverse()) {
    for (const p of [path.join(brainDir(root.dir), cid), dbFile(root.dir, cid), `${dbFile(root.dir, cid)}-wal`, `${dbFile(root.dir, cid)}-shm`, annotationFile(root.dir, cid), path.join(root.dir, 'presence', `${cid}.lock`)]) {
      if (fs.existsSync(p)) await safeTrash(p)
    }
  }
  invalidateIndex(root.dir)
  return { root: root.id, id, trashed: true, alsoTrashed: ids.filter((x) => x !== id) }
}

function getSubagents(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const children = childrenOf(root.dir, id).map((c) => toChild(root.dir, c))
  return { root: root.id, id, children, groups: [], _etag: `"${sha1(children.map((c) => `${c.id}:${c.mtimeMs}`).join('|'))}"` }
}

function getRaw(q) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findEntry(root.dir, id)
  const fp = fingerprintOf(entry.file)
  return { root: root.id, id, records: sessionRecords(entry.file, fp), _etag: etagOf(fp) }
}

// --- stats / activity / history -------------------------------------------------

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
    for (const e of sessionFiles(root.dir, proj.slug)) {
      const s = sessionSummary(root.dir, e, fpOf(e.file))
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
  return { root: root.id, projectCount: projects.length, sessions, userTurns, toolCalls, toolCounts, modelCounts, tokens, projects, fields: tokenFields(TOKEN_SPECIFIC) }
}

function getActivity(q) {
  const root = resolveRoot(q.get('root'))
  const days = Number(q.get('days')) || 84
  const list = []
  for (const proj of listProjects(root.dir)) {
    for (const e of sessionFiles(root.dir, proj.slug)) {
      const s = sessionSummary(root.dir, e, fpOf(e.file))
      list.push({ id: e.id, slug: proj.slug, cwd: proj.cwd, title: s.title, firstTs: s.firstTs, lastTs: s.lastTs, userTurns: s.userTurns, toolCalls: s.toolCalls, tokens: s.tokens, models: s.models })
    }
  }
  return { root: root.id, ...bucketActivity(list, { days }) }
}

// history.jsonl holds interactive prompts: { display, timestamp (ms), workspace }
function getHistory(q) {
  const root = resolveRoot(q.get('root'))
  const out = []
  try {
    for (const line of fs.readFileSync(path.join(root.dir, 'history.jsonl'), 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        out.push({ display: o.display || '', project: o.workspace || null, ts: o.timestamp || null })
      } catch {}
    }
  } catch {}
  return { root: root.id, history: out.reverse().slice(0, 500) }
}

// --- the CLI itself: version and usage limits ----------------------------------------
// `agy -p /usage --output-format json` answers with the account's 5-hour /
// weekly buckets without creating a conversation (verified), but it starts a
// language server for a few seconds — so the answer is cached.

function runAgy(args, timeout = 25000) {
  const bin = TERMINAL_CONFIG.findBin()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }, (err, stdout) => resolve(err && !stdout ? null : String(stdout || '')))
  })
}
const memo = new Map() // key -> { at, value, inflight }
async function memoized(key, ttlMs, fn) {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  if (hit?.inflight) return hit.inflight
  const inflight = fn().then((value) => {
    memo.set(key, { at: Date.now(), value })
    return value
  })
  memo.set(key, { at: 0, value: hit?.value ?? null, inflight })
  return inflight
}

async function getVersion() {
  const version = await memoized('version', 10 * 60 * 1000, async () => {
    const out = await runAgy(['--version'], 15000)
    return out ? (out.match(/\d+\.\d+\.\d+/) || [null])[0] : null
  })
  return { version }
}

// normalised to the shape RateLimitsBar already reads: { primary (5h), secondary (weekly) }
async function getUsage() {
  const snap = await memoized('usage', 5 * 60 * 1000, async () => {
    const out = await runAgy(['-p', '/usage', '--output-format', 'json'])
    if (!out) return null
    let j
    try {
      j = JSON.parse(out.trim().split('\n').pop())
    } catch {
      return null
    }
    const groups = j?.command?.data?.groups || []
    const pick = (g, win) => (g?.buckets || []).find((b) => b.window === win)
    const toWin = (b, minutes) => (b ? { used_percent: Math.round((1 - (b.remaining_fraction ?? 1)) * 100), window_minutes: minutes, resets_at: b.reset_time ? Math.floor(Date.parse(b.reset_time) / 1000) : null } : null)
    const byGroup = groups.map((g) => ({ name: g.name, primary: toWin(pick(g, '5h'), 300), secondary: toWin(pick(g, 'weekly'), 10080) }))
    const main = byGroup.find((g) => /gemini/i.test(g.name)) || byGroup[0] || null
    return { rateLimits: main ? { primary: main.primary, secondary: main.secondary } : null, groups: byGroup, ts: new Date().toISOString() }
  })
  return { rateLimits: snap?.rateLimits || null, ts: snap?.ts || null, sessionId: null, groups: snap?.groups || [] }
}

// --- memory (artifacts), plugins, resources ---------------------------------------------

// agy's closest thing to memory: the Markdown artifacts a conversation writes
// under brain/<id>/ (task / implementation plan / walkthrough), read-only
function getMemory(q) {
  const root = resolveRoot(q.get('root'))
  const memories = []
  try {
    for (const id of fs.readdirSync(brainDir(root.dir))) {
      const dir = path.join(brainDir(root.dir), id)
      let files = []
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
      } catch {}
      for (const f of files) {
        const p = path.join(dir, f)
        let meta = null
        try {
          meta = JSON.parse(fs.readFileSync(`${p}.metadata.json`, 'utf8'))
        } catch {}
        let body = ''
        try {
          body = fs.readFileSync(p, 'utf8')
        } catch {}
        memories.push({ id: `${id}/${f}`, sessionId: id, title: f.replace(/\.md$/, ''), kind: meta?.artifactType || null, summary: meta?.summary || '', updatedAt: meta?.updatedAt || null, body })
      }
    }
  } catch {}
  memories.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { root: root.id, source: memories.length ? 'artifacts' : 'empty', memories, readOnly: true }
}

function getPlugins(q) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, ...readPlugins(root.dir) }
}

function getResources(q) {
  const root = resolveRoot(q.get('root'))
  const scope = q.get('scope') === 'project' ? 'project' : 'user'
  if (scope === 'project') {
    const slug = q.get('slug')
    if (!slug || !path.isAbsolute(slug)) throw httpErr(400, 'project scope needs a project (cwd) slug')
    if (!fs.existsSync(slug)) throw httpErr(404, `project directory no longer exists: ${slug}`)
    return { root: root.id, ...inventory('project', slug, root.dir) }
  }
  return { root: root.id, ...inventory('user', root.dir, root.dir) }
}
const notWritable = () => {
  throw httpErr(501, 'Antigravity config is managed by agy itself (agy plugin …, agy mcp …); AgentDeck shows it read-only')
}

// --- open / terminal / browse ---------------------------------------------------------

async function postOpen(_q, body) {
  if (!body?.root || !body?.what) throw httpErr(400, 'missing root/what')
  const root = resolveRoot(body.root)
  let cwd = null
  if (body.cwd && path.isAbsolute(body.cwd) && fs.existsSync(body.cwd)) cwd = body.cwd
  else if (body.id) cwd = cwdForId(root.dir, body.id)
  else if (body.slug && path.isAbsolute(body.slug)) cwd = body.slug
  if (!cwd || !path.isAbsolute(cwd)) throw httpErr(404, 'cannot resolve a working directory')
  await openTool(body.what, cwd)
  return { ok: true, what: body.what, cwd }
}

async function postTerminal(_q, body) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  let cwd
  let key
  let resumeId = null
  if (body.id) {
    if (!isSessionId(body.id)) throw httpErr(400, 'invalid session id')
    cwd = cwdForId(root.dir, body.id)
    resumeId = body.id
    key = `${root.id}|${body.id}`
  } else if (body.cwd) {
    cwd = body.cwd
    key = `${root.id}|new|${body.cwd}`
  } else if (body.slug && path.isAbsolute(body.slug)) {
    cwd = body.slug
    key = `${root.id}|new|${body.slug}`
  } else throw httpErr(400, 'missing id or cwd')
  if (!cwd || !fs.existsSync(cwd)) cwd = os.homedir()
  const meta = { root: root.id, slug: body.slug || null, id: resumeId, cwd, isNew: !resumeId, title: body.title || null }
  const res = await startTerminal({ key, cwd, configDir: root.dir, resumeId, meta, config: TERMINAL_CONFIG })
  return { ok: true, key, ...res }
}
const getTerminals = () => ({ terminals: listTerminals() })
const deleteTerminal = async (q) => stopTerminal(q.get('key'))
const getLiveTerminals = () => ({ terminals: listLiveTmux() })
const getActiveSessions = () => ({ tmux: listLiveTmux(), sdk: [] })

function getBrowse(q) {
  const home = os.homedir()
  const dir = expandHome((q.get('path') || '').trim()) || home
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
  } catch {}
  const parent = path.dirname(resolved)
  return { path: resolved, parent: parent !== resolved ? parent : null, home, dirs }
}
const getPickFolder = async () => pickFolderNative()

// --- dispatcher --------------------------------------------------------------

const ROUTES = {
  'GET /api/roots': getRoots,
  'POST /api/roots': postRoots,
  'POST /api/roots/label': postRootLabel,
  'DELETE /api/roots': deleteRoots,
  'GET /api/activity': getActivity,
  'GET /api/projects': getProjects,
  'GET /api/sessions': getSessions,
  'GET /api/session': getSession,
  'DELETE /api/session': deleteSession,
  'GET /api/subagents': getSubagents,
  'GET /api/raw': getRaw,
  'GET /api/stats': getStats,
  'GET /api/history': getHistory,
  'GET /api/usage': getUsage,
  'GET /api/version': getVersion,
  'GET /api/memory': getMemory,
  'GET /api/plugins': getPlugins,
  'GET /api/resources': getResources,
  'POST /api/resource': notWritable,
  'DELETE /api/resource': notWritable,
  'POST /api/skill-run': notWritable,
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
