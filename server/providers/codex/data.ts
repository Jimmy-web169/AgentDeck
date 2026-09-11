import type { NormalizedSummary } from '../../shared/parserTypes.ts'
import type { Root } from '../../../shared/types.d.ts'
import type { ProviderRequest } from '../../shared/providerRoutes.ts'
import type { Fingerprint } from '../../shared/parseCache.ts'
import { jsonRecord, optionalString } from '../../shared/json.ts'
import { fingerprintParts, childFingerprintParts } from '../../../shared/identity.ts'
import { writeFork } from '../../shared/forkFile.ts'
import { requireFields } from '../../shared/validate.ts'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { homeProjects, homeHistory } from '../../shared/homeQuery.ts'
import {
  rootsWithMeta,
  renameRoot,
  addRoot,
  removeRoot,
  resolveRoot,
  listProjects,
  sessionFiles,
  sessionFileById,
  NO_CWD,
  childrenOf,
  cwdForId,
  isSessionId,
  latestRateLimits,
  latestCliVersion,
  invalidateIndex,
} from './paths.ts'
import { safeTrash } from '../../shared/trash.ts'
import { probeStatus, runProbe, acceptProbe } from '../../shared/formatProbe.ts'
import { writeBrief, composeBrief, seedPrompt } from '../../shared/handoff.ts'
import { handoffLaunch } from '../../deck/handoffStore.ts'
import { HOME as USER_HOME } from '../../shared/roots.ts'
import { readRecords, buildTimeline, summarize } from './parser.ts'
import { addTokens, tokenFields, zeroTokens as zeroTokensShared } from '../../shared/tokens.ts'
import { child } from '../../shared/children.ts'
import { cachedRecords, cachedDerived, fingerprintOf, etagOf } from '../../shared/parseCache.ts'
import { withOversizeFallback } from '../../shared/transcriptGuard.ts'

// Rollout reads go through the shared fingerprint cache (same discipline as
// the claude provider): one stat per file per request — taken BEFORE any
// content read — revalidates the cache and feeds the `_etag`, so results are
// exactly as fresh as re-parsing every time. See parseCache.js for the
// ordering and immutability contracts (spread-copy before mutating summaries).
const sessionRecords = (file: string, fp: Fingerprint | undefined) => cachedRecords(file, readRecords, fp)
const sessionSummary = (file: string, id: string, fp?: Fingerprint) => cachedDerived(file, 'summary', () => summarize(sessionRecords(file, fp), id), fp)
const sessionTimeline = (file: string, fp: Fingerprint | undefined) => cachedDerived(file, 'timeline', () => buildTimeline(sessionRecords(file, fp)), fp)
// One over-the-cap rollout must not take a whole list/stats endpoint down with
// it: degrade THAT entry to a summary-shaped stub (summarize of zero records
// keeps the exact shape) so every other session stays visible. Opening the
// oversized session itself still 413s via the single-session handlers.
const oversizeStub = (id: string, e: { bytes?: number }): NormalizedSummary => ({
  ...summarize([], id),
  title: `(transcript too large — ${Math.round((e.bytes || 0) / 1e6)} MB)`,
  oversized: true,
})

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex')
import { inventory, createResource, deleteResource } from './resources.ts'
import { parseSkillsAdd, runSkillsAdd } from '../../shared/skills.ts'
import { SKILL_CONFIG } from './skills.ts'
import { readMemories, readPlugins } from './codex-data.ts'

import { forkLines } from './fork.ts'
import { bucketActivity } from '../../shared/activity.ts'
import { openTool } from '../../shared/launch.ts'
import { getBrowse, getPickFolder } from '../../shared/browse.ts'
import { startTerminal, stopTerminal, listTerminals, listLiveTmux, findOnPath, reattachTerminal } from '../../shared/terminal.ts'
import { terminalIdentity } from '../../shared/terminalIdentity.ts'
import { resolveCodexSession, resolveSavedCodexSession } from './terminal.ts'

const TERMINAL_CONFIG = {
  findBin: () => findOnPath(['codex'], [path.join(os.homedir(), '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex']),
  id: 'codex',
  title: 'codex',
  envKey: 'CODEX_HOME',
  resumeArgs: (id: string) => ['resume', id],
  promptArgs: (p: string) => [p], // `codex "<prompt>"` — interactive, seeded (AI hand-off)
  checkOrigin: true,
  resolveSession: resolveCodexSession,
  resolveSavedSession: resolveSavedCodexSession,
}

function httpErr(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

// --- roots -------------------------------------------------------------------

function getRoots() {
  const roots = rootsWithMeta().map((r) => ({ ...r, probe: probeStatus('codex', r.id) }))
  return { roots, default: roots[0]?.id || null }
}

// format-drift probe (server/shared/formatProbe.ts): re-sample now / take the
// current shape as the new baseline
function postProbeRun(_q: URLSearchParams, body: ProviderRequest) {
  const root = resolveRoot(body?.root)
  return { root: root.id, probe: runProbe('codex', root) }
}
function postProbeAccept(_q: URLSearchParams, body: ProviderRequest) {
  const root = resolveRoot(body?.root)
  return { root: root.id, probe: acceptProbe('codex', root) }
}

function postRoots(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.path) throw httpErr(400, 'missing path')
  return addRoot(body.path, body.label)
}

// relabel a tracked folder (display only; empty label = back to the default)
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
    // subagent threads are hidden here — they're viewed from the parent's Sub-agents tab
    .filter((f) => !f.isSubagent)
    .map((f) => {
      // one stat per file, before its content is read (see parseCache.js)
      let fp = null
      try {
        fp = fingerprintOf(f.file)
      } catch {}
      const s = withOversizeFallback(
        () => ({ ...sessionSummary(f.file, f.id, fp || undefined) }),
        (e) => oversizeStub(f.id, e)
      )
      s.mtime = f.mtimeMs
      s.isSubagent = f.isSubagent
      s.parentId = f.parentId
      s.agentRole = f.agentRole
      s.agentNickname = f.agentNickname
      s.childCount = childrenOf(root.dir, f.id).length
      parts.push(`${f.id}:${fp ? fp.key : '?'}:${s.childCount}`)
      return s
    })
    .sort((a, b) => String(b.lastTs || '').localeCompare(String(a.lastTs || '')))
  const _etag = `"${sha1(fingerprintParts(parts))}"`
  return { root: root.id, slug, sessions, _etag }
}

function findFile(rootDir: string, id: string) {
  const entry = sessionFileById(rootDir, id)
  if (!entry) throw httpErr(404, 'session not found')
  return entry
}

function getSession(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findFile(root.dir, id)
  // one stat before any read: summary, timeline and etag all come from this
  // snapshot, so the etag can never be newer than the body it describes
  const fp = fingerprintOf(entry.file)
  const children = childrenOf(root.dir, id)
  // spread-copy: cached summaries are shared across requests (immutable)
  const summary = { ...sessionSummary(entry.file, id, fp) }
  summary.isSubagent = entry.isSubagent
  summary.parentId = entry.parentId
  summary.agentRole = entry.agentRole
  summary.agentNickname = entry.agentNickname
  // the children list rides on this payload, so it must move the etag too
  const childSig = children.length ? sha1(childFingerprintParts(children, ',')).slice(0, 16) : ''
  return {
    root: root.id,
    slug: summary.cwd || entry.cwd || '(unknown working dir)',
    id,
    summary,
    children,
    timeline: sessionTimeline(entry.file, fp),
    _etag: etagOf(fp, childSig),
  }
}

// Move a session to the OS trash (recoverable): its rollout .jsonl plus every
// descendant subagent rollout (codex subagents are separate rollouts linked by
// parent id — the analogue of claude's sidecar dir). Files are located only by
// their unique id via the index, so this can't address anything but existing
// sessions. Children first: if one fails the parent stays listed and a retry
// covers the rest.
async function deleteSession(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const entry = findFile(root.dir, id) // 404 when already gone
  // collect descendants breadth-first (depth is small; cycle-guard via seen set)
  const seen = new Set([id])
  const queue = [id]
  const descendants = []
  while (queue.length) {
    for (const c of childrenOf(root.dir, queue.shift())) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      queue.push(c.id)
      const e = sessionFileById(root.dir, c.id)
      if (e) descendants.push(e.file)
    }
  }
  for (const f of descendants.reverse()) await safeTrash(f)
  await safeTrash(entry.file)
  invalidateIndex(root.dir)
  return { root: root.id, id, trashed: true }
}

// subagent threads spawned by a session (separate rollouts linked via parent id)
function getSubagents(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  // Each subagent is its own rollout; summarize it so the UI can show context%,
  // turns and tokens without loading the full transcript up front.
  const parts: string[] = []
  const children = childrenOf(root.dir, id).map((c) => {
    const entry = sessionFileById(root.dir, c.id)
    let s = null
    try {
      if (entry) {
        // one stat per child, before its content is read (see parseCache.js)
        const fp = fingerprintOf(entry.file)
        s = sessionSummary(entry.file, c.id, fp)
        parts.push(`${c.id}:${fp.key}`)
      }
    } catch {}
    // the provider-neutral child shape (server/shared/children.ts) plus the
    // Codex-specific fields the Sub-agents view and the inline thread already use
    return child({
      id: c.id,
      parentId: id,
      kind: 'session',
      label: s?.title || s?.firstPrompt || c.agentRole || c.id,
      type: c.agentRole || null,
      status: c.mtimeMs && Date.now() - c.mtimeMs < 60000 ? 'running' : 'done',
      firstTs: s?.firstTs || c.startTs || null,
      lastTs: s?.lastTs || null,
      toolCalls: s?.toolCalls || 0,
      tokens: s?.tokens || null,
      model: s?.models?.[0] || null,
      depth: c.depth ?? null,
      extra: {
        mtimeMs: c.mtimeMs,
        startTs: c.startTs,
        agentRole: c.agentRole,
        agentNickname: c.agentNickname,
        agentPath: c.agentPath,
        title: s?.title || null,
        firstPrompt: s?.firstPrompt || '',
        userTurns: s?.userTurns || 0,
        assistantTurns: s?.assistantTurns || 0,
        models: s?.models || [],
        contextWindow: s?.contextWindow || 0,
        lastTokenUsage: s?.lastTokenUsage || null,
      },
    })
  })
  const _etag = `"${sha1(fingerprintParts(parts))}"`
  return { root: root.id, id, children, _etag }
}

function getRaw(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const id = q.get('id')
  if (!id) throw httpErr(400, 'missing id')
  const file = findFile(root.dir, id).file
  const fp = fingerprintOf(file)
  return { root: root.id, id, records: sessionRecords(file, fp), _etag: etagOf(fp) }
}

// --- stats -------------------------------------------------------------------

// token fields: the common set every provider has, plus Codex's own reasoning
// (cacheCreate rides on the summary shape but is always 0 for Codex, so it is
// not declared as one of its fields)
const TOKEN_SPECIFIC = ['reasoning']
const zeroTokens = () => zeroTokensShared([...TOKEN_SPECIFIC, 'cacheCreate'])

// root-level totals + a per-project (cwd) rollup. Drill into a project's
// per-session breakdown via GET /api/sessions?root=&slug= .
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
    // one population everywhere: `sessions` counts top-level rollouts (what the
    // sidebar lists), `subagentSessions` the spawned children; turns and tokens
    // add up over both, so the root numbers equal the sum of the projects
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
    for (const f of sessionFiles(root.dir, proj.slug)) {
      // one stat per file, before its content is read (see parseCache.js)
      let fp = null
      try {
        fp = fingerprintOf(f.file)
      } catch {}
      const s = withOversizeFallback(
        () => sessionSummary(f.file, f.id, fp || undefined),
        (e) => oversizeStub(f.id, e) // counts as a session, contributes zeros
      )
      if (s.oversized) incomplete.push({ slug: proj.slug, id: f.id, reason: 'Transcript too large; usage is unavailable' })
      if (f.isSubagent) {
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
  // `fields` tells the UI which token fields every provider shares (add these up
  // across folders) and which are Codex's own
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

// --- history -----------------------------------------------------------------

function getHistory(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const projectCache = new Map<string, string | null>()
  const projectOfId = (id: string) => {
    if (projectCache.has(id)) return projectCache.get(id)
    try {
      const cwd = sessionFileById(root.dir, id)?.cwd
      const project = cwd && cwd !== NO_CWD ? cwd : null
      projectCache.set(id, project)
      return project
    } catch {
      return null
    }
  }
  const out = []
  let readError = null,
    malformed = 0
  try {
    for (const line of fs.readFileSync(path.join(root.dir, 'history.jsonl'), 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const o = JSON.parse(s)
        // ts is unix seconds → ms for the UI's time formatter; the cwd comes from
        // the rollout index when the thread is known (history.jsonl has none)
        const sid = o.session_id || null
        out.push({ display: o.text || '', project: (sid && projectOfId(sid)) || null, sessionId: sid, ts: o.ts ? o.ts * 1000 : null })
      } catch {
        malformed++
      }
    }
  } catch (e) {
    readError = jsonRecord(e).code === 'ENOENT' ? 'No prompt-history file recorded by this source' : optionalString(jsonRecord(e).message)
  }
  return { root: root.id, ...homeHistory(out, q, readError, malformed) }
}

// --- configurable resources (user scope + project scope) ---------------------
// User scope = the tracked Codex home. Project scope = a project's working dir
// (slug is the cwd), whose config/agents/hooks/rules live under <cwd>/.codex/.

function getResources(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const scope = q.get('scope') === 'project' ? 'project' : 'user'
  let base: string
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
function scopeBase(root: Root, scope: string | null, slug: string | null | undefined) {
  if (scope !== 'project') return root.dir
  if (!slug || !path.isAbsolute(slug)) throw httpErr(400, 'project scope needs a project (cwd) slug')
  if (!fs.existsSync(slug)) throw httpErr(404, `project directory no longer exists: ${slug}`)
  return slug
}

function postResource(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  const scope = body.scope === 'project' ? 'project' : 'user'
  const base = scopeBase(root, scope, body.slug)
  const file = createResource(scope, base, body)
  return { ok: true, path: file }
}

// Delete a resource at the chosen scope. file/dir resources go to the OS trash;
// embedded ones (mcp/hook) are stripped from their host file. See deleteResource.
function deleteResourceHandler(q: URLSearchParams) {
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
function getUsage(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const snap = latestRateLimits(root.dir) // { rateLimits, ts, sessionId } | null
  return {
    root: root.id,
    rateLimits: snap?.rateLimits || null,
    contextWindow: null,
    sessionId: snap?.sessionId || null,
    ts: snap?.ts ? (typeof snap.ts === 'number' ? snap.ts : Date.parse(snap.ts) || null) : null,
  }
}

// The Codex CLI version observed in the most recent tracked session.
function getVersion(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  return { version: latestCliVersion(root.dir) }
}

// Codex per-conversation memories (read-only, from memories_1.sqlite).
function getMemory(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  // thread memories Codex writes itself — read-only here (spec §4 item 4)
  return { root: root.id, scope: 'thread', writable: false, ...readMemories(root.dir) }
}

// Installed Codex plugins (from plugins/cache + config.toml enabled-state).
function getPlugins(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  return { root: root.id, ...readPlugins(root.dir) }
}

// --- skill install: delegate to the `skills` CLI (npx skills add -a codex) ----
// Runs an external program on the user's machine after the UI confirms.
async function postSkillRun(_q: URLSearchParams, body: ProviderRequest) {
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

async function postOpen(_q: URLSearchParams, body: ProviderRequest) {
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

async function postTerminal(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  const attached = await reattachTerminal({ body, root, config: TERMINAL_CONFIG })
  if (attached) return { ok: true, ...attached }
  let cwd: string | null | undefined
  let resumeId = null
  if (body.id) {
    if (!isSessionId(body.id)) throw httpErr(400, 'invalid session id') // goes to `codex resume <id>` as argv
    cwd = cwdForId(root.dir, body.id) // continue an existing session
    resumeId = body.id
  } else if (body.cwd) {
    cwd = body.cwd // new conversation at an explicit path
  } else if (body.slug && path.isAbsolute(body.slug)) {
    cwd = body.slug // new conversation under an existing project (slug is the cwd)
  } else if (body.brief) {
    cwd = USER_HOME // a hand-off with no folder (Insights) runs from the home directory
  } else {
    throw httpErr(400, 'missing id or cwd')
  }
  if (!cwd || !fs.existsSync(cwd)) throw httpErr(404, 'The working directory is unavailable. Choose an existing folder.')
  const identity = terminalIdentity(TERMINAL_CONFIG.id, root.id, { id: resumeId, launchId: body.launchId })
  const key = identity.key
  // AI hand-off: the request + file + docs go into a brief file; the CLI starts
  // seeded with a one-line prompt that points at it (server/shared/handoff.ts)
  let promptArgs = null
  let briefFile = null
  if (!resumeId && body.brief && typeof body.brief === 'object') {
    briefFile = writeBrief(composeBrief({ ...body.brief, providerLabel: 'Codex', cwd }), { key })
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

function getTerminals() {
  return { terminals: listTerminals() }
}

async function deleteTerminal(q: URLSearchParams) {
  return stopTerminal(q.get('key') || '', 'codex')
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

// --- dispatcher --------------------------------------------------------------

// --- activity ----------------------------------------------------------------
// GET /api/activity?root=&days= — per-day / hour / weekday usage profile of one
// Codex home (see server/shared/activity.ts for the attribution rules).
function getActivity(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const selected = homeProjects(q)
  const days = Number(q.get('days')) || 84
  const list = []
  for (const proj of listProjects(root.dir)) {
    if (selected && !selected.has(proj.slug)) continue
    for (const f of sessionFiles(root.dir, proj.slug)) {
      let fp = null
      try {
        fp = fingerprintOf(f.file) // one stat per file, same discipline as claude
      } catch {}
      const s = withOversizeFallback(
        () => sessionSummary(f.file, f.id, fp || undefined),
        (e) => oversizeStub(f.id, e)
      )
      list.push({
        id: f.id,
        slug: proj.slug,
        cwd: proj.cwd,
        title: s.title,
        firstTs: s.firstTs,
        lastTs: s.lastTs,
        userTurns: s.userTurns,
        toolCalls: s.toolCalls,
        tokens: s.tokens,
        models: s.models,
        ...(q.get('home') === '1' ? { isSubagent: !!f.isSubagent, oversized: !!s.oversized } : {}),
      })
    }
  }
  return q.get('home') === '1' ? { root: root.id, records: list } : { root: root.id, ...bucketActivity(list, { days }) }
}

// Provider-owned data handlers; request inventory belongs to the shared factory.
export const DATA = {
  id: 'codex',
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
  postResource: postResource,
  deleteResource: deleteResourceHandler,
  skills: postSkillRun,
  postOpen: postOpen,
  getBrowse: getBrowse,
  getPickFolder: getPickFolder,
  postTerminal: postTerminal,
  getTerminals: getTerminals,
  getLiveTerminals: getLiveTerminals,
  getActiveSessions: getActiveSessions,
  deleteTerminal: deleteTerminal,
}

// Publish beside the source so native resume discovery retains its layout.
export function postFork(_query: URLSearchParams, input: unknown) {
  const body = requireFields(input, ['root', 'id']) as ProviderRequest & { root: string; id: string }
  if (body.cut != null && (typeof body.cut !== 'number' || !Number.isSafeInteger(body.cut) || body.cut < 1))
    throw httpErr(400, 'cut must be a positive prompt ordinal')
  const root = resolveRoot(body.root)
  const source = findFile(root.dir, body.id)
  try {
    const fork = writeFork(
      root.dir,
      source.file,
      (id) => 'rollout-' + new Date().toISOString().replaceAll(':', '-') + '-' + id + '.jsonl',
      (lines, id) => forkLines(lines, body.cut as number | null | undefined, id)
    )
    invalidateIndex(root.dir)
    return { root: root.id, slug: source.cwd || null, id: fork.id }
  } catch (error) {
    if (jsonRecord(error).code === 'CUT_NOT_FOUND' || jsonRecord(error).code === 'EMPTY_FORK') throw httpErr(400, String(jsonRecord(error).message))
    throw error
  }
}
