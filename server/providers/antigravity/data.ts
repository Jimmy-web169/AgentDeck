import type { NormalizedSummary } from '../../shared/parserTypes.ts'
import type { ProviderRequest } from '../../shared/providerRoutes.ts'
import type { Fingerprint } from '../../shared/parseCache.ts'
import { jsonRecord, jsonArray, optionalString } from '../../shared/json.ts'
import { fingerprintParts, childFingerprintParts } from '../../../shared/identity.ts'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { homeProjects, homeHistory } from '../../shared/homeQuery.ts'
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
  isSessionId,
  invalidateIndex,
  readTitle,
  dbFile,
  annotationFile,
  brainDir,
  isLive,
  NO_CWD,
} from './paths.ts'
import { readRecords, buildTimeline, summarize } from './parser.ts'
import { inventory, readPlugins } from './resources.ts'
import { sqliteAvailable } from './sqlite.ts'
import { addTokens, tokenFields, withTotal, zeroTokens as zeroTokensShared } from '../../shared/tokens.ts'
import { child } from '../../shared/children.ts'
import { cachedRecords, cachedDerived, fingerprintOf, etagOf } from '../../shared/parseCache.ts'
import { withOversizeFallback } from '../../shared/transcriptGuard.ts'
import { safeTrash } from '../../shared/trash.ts'
import { probeStatus, runProbe, acceptProbe } from '../../shared/formatProbe.ts'
import { writeBrief, composeBrief, seedPrompt } from '../../shared/handoff.ts'
import { handoffLaunch } from '../../deck/handoffStore.ts'
import { HOME as USER_HOME } from '../../shared/roots.ts'

import { bucketActivity } from '../../shared/activity.ts'
import { openTool } from '../../shared/launch.ts'
import { getBrowse, getPickFolder } from '../../shared/browse.ts'
import { startTerminal, stopTerminal, listTerminals, listLiveTmux, findOnPath, reattachTerminal } from '../../shared/terminal.ts'
import { terminalIdentity } from '../../shared/terminalIdentity.ts'
import { prepareAntigravityLaunch, resolveAntigravitySession, resolveSavedAntigravitySession } from './terminal.ts'

// Google Antigravity CLI (`agy`) — id-addressed like Codex: a session is a
// conversation id, its project (workspace) is derived. The transcript gives
// turns and tool calls; the per-conversation SQLite (sqlite.js) gives the
// workspace, the model and the tokens. See spec/providers/antigravity.yaml.

const TERMINAL_CONFIG = {
  findBin: () =>
    findOnPath(
      ['agy'],
      [
        path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'),
        path.join(os.homedir(), '.local/bin/agy'),
        '/opt/homebrew/bin/agy',
        '/usr/local/bin/agy',
      ]
    ),
  id: 'antigravity',
  title: 'agy',
  envKey: 'AGENTDECK_PROVIDER_HOME', // agy has no documented home-dir variable; the tracked folder is still recorded on the tmux session
  resumeArgs: (id: string) => ['--conversation', id],
  promptArgs: (p: string) => ['-i', p], // `agy -i "<prompt>"` — seeded interactive (AI hand-off)
  checkOrigin: false,
  prepareLaunch: prepareAntigravityLaunch,
  resolveSession: resolveAntigravitySession,
  resolveSavedSession: resolveSavedAntigravitySession,
}
const TOKEN_SPECIFIC = ['reasoning']
const zeroTokens = () => zeroTokensShared(TOKEN_SPECIFIC)

const sessionRecords = (file: string, fp: Fingerprint | undefined) => cachedRecords(file, readRecords, fp)
const sessionTimeline = (file: string, fp: Fingerprint | undefined) => cachedDerived(file, 'timeline', () => buildTimeline(sessionRecords(file, fp)), fp)
const parsedSummary = (file: string, id: string, fp?: Fingerprint) => cachedDerived(file, 'summary', () => summarize(sessionRecords(file, fp), id), fp)
const oversizeStub = (id: string, e: { bytes?: number }): NormalizedSummary => ({
  ...summarize([], id),
  title: `(transcript too large — ${Math.round((e.bytes || 0) / 1e6)} MB)`,
  oversized: true,
})
const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')

function httpErr(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

// the parsed summary plus everything the transcript does not carry: workspace,
// model and tokens (SQLite), the annotation title, sub-agent links
function sessionSummary(rootDir: string, entry: NonNullable<ReturnType<typeof sessionFileById>>, fp?: Fingerprint): NormalizedSummary {
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
const fpOf = (file: string) => {
  try {
    return fingerprintOf(file)
  } catch {
    return undefined
  }
}

// --- roots -------------------------------------------------------------------

function getRoots() {
  const roots = rootsWithMeta().map((r) => ({ ...r, probe: probeStatus('antigravity', r.id) }))
  return { roots, default: roots[0]?.id || null, sqlite: sqliteAvailable() }
}

// format-drift probe (server/shared/formatProbe.ts): re-sample now / take the
// current shape as the new baseline
function postProbeRun(_q: URLSearchParams, body: ProviderRequest) {
  const root = resolveRoot(body?.root)
  return { root: root.id, probe: runProbe('antigravity', root) }
}
function postProbeAccept(_q: URLSearchParams, body: ProviderRequest) {
  const root = resolveRoot(body?.root)
  return { root: root.id, probe: acceptProbe('antigravity', root) }
}
function postRoots(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.path) throw httpErr(400, 'missing path')
  return addRoot(body.path, body.label)
}
function postRootLabel(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.id) throw httpErr(400, 'missing id')
  return renameRoot(body.id, body.label)
}
function deleteRoots(q: URLSearchParams) {
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  return removeRoot(id)
}

// --- projects / sessions -----------------------------------------------------

function getProjects(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, rootDir: root.dir, projects: listProjects(root.dir) }
}

function getSessions(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  if (!slug) throw httpErr(400, 'missing slug')
  const parts: string[] = []
  const sessions = sessionFiles(root.dir, slug)
    .filter((e) => !e.isSubagent)
    .map((e) => {
      const fp = fpOf(e.file)
      const s = sessionSummary(root.dir, e, fp)
      parts.push(`${e.id}:${fp ? fp.key : '?'}:${s.tokens.total}:${s.childCount}`)
      return s
    })
    .sort((a, b) => String(b.lastTs || '').localeCompare(String(a.lastTs || '')))
  return { root: root.id, slug, sessions, _etag: `"${sha1(fingerprintParts(parts))}"` }
}

function findEntry(rootDir: string, id: string) {
  if (!isSessionId(id)) throw httpErr(400, 'invalid session id')
  const entry = sessionFileById(rootDir, id)
  if (!entry) throw httpErr(404, 'session not found')
  return entry
}

const toChild = (rootDir: string, c: NonNullable<ReturnType<typeof sessionFileById>>) => {
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

function getSession(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findEntry(root.dir, id)
  const fp = fingerprintOf(entry.file)
  const summary = sessionSummary(root.dir, entry, fp)
  const children = childrenOf(root.dir, id).map((c) => toChild(root.dir, c))
  const childSig = children.length ? sha1(childFingerprintParts(children, ',')).slice(0, 16) : ''
  return {
    root: root.id,
    slug: summary.cwd || NO_CWD,
    id,
    summary,
    children,
    timeline: sessionTimeline(entry.file, fp),
    _etag: etagOf(fp, `${childSig}:${summary.tokens.total}`),
  }
}

// Move a conversation to the OS trash: its brain/<id> directory, its SQLite
// (with -wal / -shm), its annotation and presence lock — then its children.
async function deleteSession(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  findEntry(root.dir, id)
  const ids = [id]
  const seen = new Set(ids)
  for (let i = 0; i < ids.length; i++) for (const c of childrenOf(root.dir, ids[i])) if (!seen.has(c.id)) seen.add(c.id) && ids.push(c.id)
  for (const cid of ids.reverse()) {
    for (const p of [
      path.join(brainDir(root.dir), cid),
      dbFile(root.dir, cid),
      `${dbFile(root.dir, cid)}-wal`,
      `${dbFile(root.dir, cid)}-shm`,
      annotationFile(root.dir, cid),
      path.join(root.dir, 'presence', `${cid}.lock`),
    ]) {
      if (fs.existsSync(p)) await safeTrash(p)
    }
  }
  invalidateIndex(root.dir)
  return { root: root.id, id, trashed: true, alsoTrashed: ids.filter((x) => x !== id) }
}

function getSubagents(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const children = childrenOf(root.dir, id).map((c) => toChild(root.dir, c))
  return { root: root.id, id, children, groups: [], _etag: `"${sha1(childFingerprintParts(children))}"` }
}

function getRaw(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findEntry(root.dir, id)
  const fp = fingerprintOf(entry.file)
  return { root: root.id, id, records: sessionRecords(entry.file, fp), _etag: etagOf(fp) }
}

// --- stats / activity / history -------------------------------------------------

function getStats(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const selected = homeProjects(q),
    incomplete = []
  let sessions = 0
  let userTurns = 0
  let toolCalls = 0
  const toolCounts: Record<string, number> = {}
  const modelCounts: Record<string, number> = {}
  const tokens = zeroTokens()
  const projects = []
  let subagentSessions = 0
  for (const proj of listProjects(root.dir)) {
    if (selected && !selected.has(proj.slug)) continue
    // `sessions` = top-level conversations, `subagentSessions` = spawned children;
    // turns and tokens add up over both (same population as codex)
    const acc = {
      slug: proj.slug,
      cwd: proj.cwd,
      sessions: 0,
      subagentSessions: 0,
      userTurns: 0,
      toolCalls: 0,
      tokens: zeroTokens(),
      toolCounts: {} as Record<string, number>,
      models: new Set<string>(),
      lastActivity: proj.lastActivity,
    }
    for (const e of sessionFiles(root.dir, proj.slug)) {
      const s = sessionSummary(root.dir, e, fpOf(e.file))
      if (s.oversized) incomplete.push({ slug: proj.slug, id: e.id, reason: 'Transcript too large; usage is unavailable' })
      if (e.isSubagent) {
        subagentSessions++
        acc.subagentSessions++
      } else {
        sessions++
        acc.sessions++
      }
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
  return {
    root: root.id,
    projectCount: projects.length,
    sessions,
    subagentSessions,
    userTurns,
    toolCalls,
    toolCounts,
    modelCounts,
    tokens,
    projects,
    fields: tokenFields(TOKEN_SPECIFIC),
    ...(q.get('home') === '1' ? { incomplete } : {}),
  }
}

function getActivity(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const selected = homeProjects(q)
  const days = Number(q.get('days')) || 84
  const list = []
  for (const proj of listProjects(root.dir)) {
    if (selected && !selected.has(proj.slug)) continue
    for (const e of sessionFiles(root.dir, proj.slug)) {
      const s = sessionSummary(root.dir, e, fpOf(e.file))
      list.push({
        id: e.id,
        slug: proj.slug,
        cwd: proj.cwd,
        title: s.title,
        firstTs: s.firstTs,
        lastTs: s.lastTs,
        userTurns: s.userTurns,
        toolCalls: s.toolCalls,
        tokens: s.tokens,
        models: s.models,
        ...(q.get('home') === '1' ? { isSubagent: !!e.isSubagent, oversized: !!s.oversized } : {}),
      })
    }
  }
  return q.get('home') === '1' ? { root: root.id, records: list } : { root: root.id, ...bucketActivity(list, { days }) }
}

// history.jsonl holds interactive prompts: { display, timestamp (ms), workspace }
function getHistory(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const out = []
  let readError = null,
    malformed = 0
  try {
    for (const line of fs.readFileSync(path.join(root.dir, 'history.jsonl'), 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        // ms on disk; tolerate an ISO string (older fixtures) so ts is always ms
        const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || null : o.timestamp || null
        out.push({ display: o.display || '', project: o.workspace || null, sessionId: o.conversationId || null, ts })
      } catch {
        malformed++
      }
    }
  } catch (e) {
    readError = jsonRecord(e).code === 'ENOENT' ? 'No prompt-history file recorded by this source' : optionalString(jsonRecord(e).message)
  }
  return { root: root.id, ...homeHistory(out, q, readError, malformed) }
}

// --- the CLI itself: version and usage limits ----------------------------------------
// `agy -p /usage --output-format json` answers with the account's 5-hour /
// weekly buckets without creating a conversation (verified), but it starts a
// language server for a few seconds — so the answer is cached.

function runAgy(args: string[], timeout = 25000): Promise<string | null> {
  const bin = TERMINAL_CONFIG.findBin()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }, (err, stdout) =>
      resolve(err && !stdout ? null : String(stdout || ''))
    )
  })
}
const memo = new Map<string, { at: number; value: unknown; inflight?: Promise<unknown> }>() // key -> { at, value, inflight }
async function memoized<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  if (hit?.inflight) return hit.inflight as Promise<T>
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
async function getUsage(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const snap = await memoized('usage', 5 * 60 * 1000, async () => {
    const out = await runAgy(['-p', '/usage', '--output-format', 'json'])
    if (!out) return null
    let j: Record<string, unknown>
    try {
      j = jsonRecord(JSON.parse(out.trim().split('\n').pop() || '') as unknown)
    } catch {
      return null
    }
    const groups = jsonArray(jsonRecord(jsonRecord(j.command).data).groups).map(jsonRecord)
    const pick = (g: Record<string, unknown>, win: string) =>
      jsonArray(g.buckets)
        .map(jsonRecord)
        .find((b) => b.window === win)
    const toWin = (b: Record<string, unknown> | undefined, minutes: number) =>
      b
        ? {
            used_percent: Math.round((1 - (typeof b.remaining_fraction === 'number' ? b.remaining_fraction : 1)) * 100),
            window_minutes: minutes,
            resets_at: b.reset_time ? Math.floor(Date.parse(String(b.reset_time)) / 1000) : null,
          }
        : null
    const byGroup = groups.map((g) => ({ name: g.name, primary: toWin(pick(g, '5h'), 300), secondary: toWin(pick(g, 'weekly'), 10080) }))
    const main = byGroup.find((g) => /gemini/i.test(String(g.name))) || byGroup[0] || null
    return { rateLimits: main ? { primary: main.primary, secondary: main.secondary } : null, groups: byGroup, ts: new Date().toISOString() }
  })
  return {
    root: root.id,
    rateLimits: snap?.rateLimits || null,
    contextWindow: null,
    sessionId: null,
    ts: snap?.ts ? Date.parse(snap.ts) || null : null,
    groups: snap?.groups || [],
  }
}

// --- memory (artifacts), plugins, resources ---------------------------------------------

// agy's closest thing to memory: the Markdown artifacts a conversation writes
// under brain/<id>/ (task / implementation plan / walkthrough), read-only
function getMemory(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const memories = []
  try {
    for (const id of fs.readdirSync(brainDir(root.dir))) {
      const dir = path.join(brainDir(root.dir), id)
      let files: string[] = []
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
        memories.push({
          id: `${id}/${f}`,
          sessionId: id,
          title: f.replace(/\.md$/, ''),
          kind: meta?.artifactType || null,
          summary: meta?.summary || '',
          updatedAt: meta?.updatedAt || null,
          body,
        })
      }
    }
  } catch {}
  memories.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { root: root.id, scope: 'artifacts', writable: false, source: memories.length ? 'artifacts' : 'empty', memories }
}

function getPlugins(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, ...readPlugins(root.dir) }
}

function getResources(q: URLSearchParams) {
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

async function postOpen(_q: URLSearchParams, body: ProviderRequest) {
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

async function postTerminal(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  const attached = await reattachTerminal({ body, root, config: TERMINAL_CONFIG })
  if (attached) return { ok: true, ...attached }
  let cwd: string | null | undefined
  let resumeId = null
  if (body.id) {
    if (!isSessionId(body.id)) throw httpErr(400, 'invalid session id')
    cwd = cwdForId(root.dir, body.id)
    resumeId = body.id
  } else if (body.cwd) {
    cwd = body.cwd
  } else if (body.slug && path.isAbsolute(body.slug)) {
    cwd = body.slug
  } else if (body.brief) {
    cwd = USER_HOME // a hand-off with no folder (Insights) runs from the home directory
  } else throw httpErr(400, 'missing id or cwd')
  if (!cwd || !fs.existsSync(cwd)) throw httpErr(404, 'The working directory is unavailable. Choose an existing folder.')
  const identity = terminalIdentity(TERMINAL_CONFIG.id, root.id, { id: resumeId, launchId: body.launchId })
  const key = identity.key
  // AI hand-off: the request + file + docs go into a brief file; the CLI starts
  // seeded with a one-line prompt that points at it (server/shared/handoff.ts)
  let promptArgs = null
  let briefFile = null
  if (!resumeId && body.brief && typeof body.brief === 'object') {
    briefFile = writeBrief(composeBrief({ ...body.brief, providerLabel: 'Antigravity', cwd }), { key })
    promptArgs = TERMINAL_CONFIG.promptArgs(seedPrompt(briefFile))
  }
  const context = handoffLaunch(body, TERMINAL_CONFIG.id, root.id, cwd)
  if (context) promptArgs = TERMINAL_CONFIG.promptArgs(context.prompt)
  const meta = {
    root: root.id,
    slug: body.slug || null,
    id: resumeId,
    launchId: identity.launchId,
    cwd,
    isNew: !resumeId,
    title: body.title || null,
    ...context?.meta,
  }
  const res = await startTerminal({ key, cwd, configDir: root.dir, resumeId, promptArgs, meta, config: TERMINAL_CONFIG })
  return { ok: true, brief: briefFile, ...res }
}
const getTerminals = () => ({ terminals: listTerminals() })
const deleteTerminal = async (q: URLSearchParams) => stopTerminal(q.get('key') || '', 'antigravity')
const getLiveTerminals = () => ({ terminals: listLiveTmux() })
const getActiveSessions = () => ({ tmux: listLiveTmux(), sdk: [] })

// --- dispatcher --------------------------------------------------------------

// Provider-owned data handlers; request inventory belongs to the shared factory.
export const DATA = {
  id: 'antigravity',
  terminal: TERMINAL_CONFIG,
  getRoots: getRoots,
  postRoots: postRoots,
  postRootLabel: postRootLabel,
  deleteRoots: deleteRoots,
  postProbeRun: postProbeRun,
  postProbeAccept: postProbeAccept,
  getActivity: getActivity,
  getProjects: getProjects,
  getSessions: getSessions,
  getSession: getSession,
  deleteSession: deleteSession,
  getRaw: getRaw,
  getSubagents: getSubagents,
  getStats: getStats,
  getHistory: getHistory,
  getUsage: getUsage,
  getVersion: getVersion,
  getMemory: getMemory,
  getPlugins: getPlugins,
  getResources: getResources,
  postResource: null,
  deleteResource: null,
  skills: null,
  postOpen: postOpen,
  getBrowse: getBrowse,
  getPickFolder: getPickFolder,
  postTerminal: postTerminal,
  getTerminals: getTerminals,
  getLiveTerminals: getLiveTerminals,
  getActiveSessions: getActiveSessions,
  deleteTerminal: deleteTerminal,
  notWritable,
}
