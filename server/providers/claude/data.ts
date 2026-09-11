import type { NormalizedSummary } from '../../shared/parserTypes.ts'
import type { Root } from '../../../shared/types.d.ts'
import type { ProviderRequest } from '../../shared/providerRoutes.ts'
import type { Fingerprint } from '../../shared/parseCache.ts'
import { jsonRecord, optionalString } from '../../shared/json.ts'
import { fingerprintParts } from '../../../shared/identity.ts'
import { writeFork } from '../../shared/forkFile.ts'
import { requireFields } from '../../shared/validate.ts'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { homeProjects, homeHistory } from '../../shared/homeQuery.ts'
import { rootsWithMeta, renameRoot, addRoot, removeRoot, resolveRoot, sessionFiles, sessionHasSubagents, listProjectSlugs, assertInside } from './paths.ts'
import { readRecords, buildTimeline, summarize } from './parser.ts'
import { addTokens, tokenFields, zeroTokens as zeroTokensShared } from '../../shared/tokens.ts'
import { child } from '../../shared/children.ts'
import { cachedRecords, cachedDerived, fingerprintOf, etagOf } from '../../shared/parseCache.ts'
import { withOversizeFallback } from '../../shared/transcriptGuard.ts'

// All transcript reads below go through the fingerprint cache: a stat per
// request revalidates, so results are exactly as fresh as parsing every time.
// Handlers that emit an `_etag` take ONE fingerprint per file (fingerprintOf,
// BEFORE any read) and thread it through both cache lookups and etagOf — see
// the ordering contract in parseCache.js. Cached returns are shared objects:
// treat them as immutable and spread-copy before attaching request fields.
const sessionRecords = (file: string, fp: Fingerprint | undefined) => cachedRecords(file, readRecords, fp)
const sessionSummary = (file: string, id: string, fp?: Fingerprint) => cachedDerived(file, 'summary', () => summarize(sessionRecords(file, fp), id), fp)
const sessionTimeline = (file: string, fp: Fingerprint | undefined) => cachedDerived(file, 'timeline', () => buildTimeline(sessionRecords(file, fp)), fp)
// One over-the-cap transcript must not take a whole list/stats endpoint down
// with it: degrade THAT entry to a summary-shaped stub (summarize of zero
// records keeps the exact shape) so every other session stays visible. Opening
// the oversized session itself still 413s via the single-session handlers.
const oversizeStub = (id: string, e: { bytes?: number }): NormalizedSummary => ({
  ...summarize([], id),
  title: `(transcript too large — ${Math.round((e.bytes || 0) / 1e6)} MB)`,
  oversized: true,
})
import { discoverRuns, discoverPlainAgents } from './runs.ts'
import { inventory, readResource, writeResource, deleteResource } from './resources.ts'
import { safeTrash } from '../../shared/trash.ts'
import { probeStatus, runProbe, acceptProbe } from '../../shared/formatProbe.ts'
import { writeBrief, composeBrief, seedPrompt } from '../../shared/handoff.ts'
import { handoffLaunch } from '../../deck/handoffStore.ts'
import { HOME as USER_HOME } from '../../shared/roots.ts'
import { withWatchersPaused } from '../../shared/watchGate.ts'
import { parseSkillsAdd, runSkillsAdd } from '../../shared/skills.ts'
import { SKILL_CONFIG } from './skills.ts'
import { openTool } from '../../shared/launch.ts'
import { getBrowse, getPickFolder } from '../../shared/browse.ts'

import { forkLines } from './fork.ts'
import { bucketActivity } from '../../shared/activity.ts'
import { startTerminal, stopTerminal, listTerminals, listLiveTmux, findOnPath, reattachTerminal } from '../../shared/terminal.ts'
import { terminalIdentity } from '../../shared/terminalIdentity.ts'
import { prepareClaudeLaunch, resolveClaudeSession, resolveSavedClaudeSession } from './terminal.ts'

const TERMINAL_CONFIG = {
  findBin: () => findOnPath(['claude'], [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']),
  id: 'claude',
  title: 'claude',
  envKey: 'CLAUDE_CONFIG_DIR',
  resumeArgs: (id: string) => ['--resume', id],
  promptArgs: (p: string) => [p], // `claude "<prompt>"` — interactive, seeded (AI hand-off)
  checkOrigin: false,
  prepareLaunch: prepareClaudeLaunch,
  resolveSession: resolveClaudeSession,
  resolveSavedSession: resolveSavedClaudeSession,
}

function httpErr(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

// --- helpers -----------------------------------------------------------------

function readCwd(file: string) {
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

function projectInfo(rootDir: string, slug: string) {
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
  const roots = rootsWithMeta().map((r) => ({ ...r, probe: probeStatus('claude', r.id) }))
  return { roots, default: roots[0]?.id || null }
}

// format-drift probe (server/shared/formatProbe.ts): re-sample now / take the
// current shape as the new baseline
function postProbeRun(_q: URLSearchParams, body: ProviderRequest) {
  const root = resolveRoot(body?.root)
  return { root: root.id, probe: runProbe('claude', root) }
}
function postProbeAccept(_q: URLSearchParams, body: ProviderRequest) {
  const root = resolveRoot(body?.root)
  return { root: root.id, probe: acceptProbe('claude', root) }
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

function getProjects(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const projects = listProjectSlugs(root.dir)
    .map((slug) => projectInfo(root.dir, slug))
    .filter((value): value is NonNullable<typeof value> => !!value)
    .sort((a, b) => b.lastActivity - a.lastActivity)
  return { root: root.id, rootDir: root.dir, projects }
}

function getSessions(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  if (!slug) throw httpErr(400, 'missing slug')
  const parts: string[] = []
  const sessions = sessionFiles(root.dir, slug)
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
      s.mtime = fp ? fp.mtimeMs : 0
      s.hasSubagents = s.hasSidechain || sessionHasSubagents(root.dir, slug, f.id)
      parts.push(`${f.id}:${fp ? fp.key : '?'}:${s.hasSubagents ? 1 : 0}`)
      return s
    })
    .sort((a, b) => String(b.lastTs || '').localeCompare(String(a.lastTs || '')))
  const _etag = `"${crypto.createHash('sha1').update(fingerprintParts(parts)).digest('hex')}"`
  return { root: root.id, slug, sessions, _etag }
}

function findSessionFile(rootDir: string, slug: string, id: string) {
  const found = sessionFiles(rootDir, slug).find((f) => f.id === id)
  if (!found) throw httpErr(404, 'session not found')
  return found.file
}

function getSession(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  const file = findSessionFile(root.dir, slug, id)
  // one stat before any read: summary, timeline and etag all come from this
  // snapshot, so the etag can never be newer than the body it describes
  const fp = fingerprintOf(file)
  const summary = { ...sessionSummary(file, id, fp) }
  summary.cwd = readCwd(file)
  summary.hasSubagents = summary.hasSidechain || sessionHasSubagents(root.dir, slug, id)
  return {
    root: root.id,
    slug,
    id,
    summary,
    timeline: sessionTimeline(file, fp),
    _etag: etagOf(fp, summary.hasSubagents ? 'S' : ''),
  }
}

function getRaw(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  const file = findSessionFile(root.dir, slug, id)
  const fp = fingerprintOf(file)
  return { root: root.id, slug, id, records: sessionRecords(file, fp), _etag: etagOf(fp) }
}

// Move a session to the OS trash (recoverable): its .jsonl transcript plus its
// sidecar dir (subagents / workflow runs), which lives next to the .jsonl under
// the same id. The id is matched against the real directory listing (via
// findSessionFile), so it can't address anything but an existing session.
// Sidecar first: if that fails the session stays listed and a retry covers both.
async function deleteSession(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  const file = findSessionFile(root.dir, slug, id)
  const sideDir = path.join(root.dir, 'projects', slug, id)
  assertInside(root.dir, sideDir)
  // our own watchers hold handles on the sidecar dir; on Windows that makes
  // the recycle-bin move fail — pause them for the duration of the trash
  await withWatchersPaused(async () => {
    if (fs.existsSync(sideDir)) await safeTrash(sideDir)
    await safeTrash(file)
  })
  return { root: root.id, slug, id, trashed: true }
}

function getSubagents(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const id = q.get('id')
  if (!slug || !id) throw httpErr(400, 'missing slug/id')
  const runs = discoverRuns(root.dir, slug, id)
  const agents = discoverPlainAgents(root.dir, slug, id)
  // `children` / `groups` is the provider-neutral shape (server/shared/children.ts);
  // `runs` / `agents` stay for the Sub-agents view, which is unchanged
  const toChild = (a: ReturnType<typeof discoverPlainAgents>[number], group: string | null) =>
    child({
      id: a.id,
      parentId: id,
      kind: 'agent',
      label: optionalString(a.description) || a.label || a.id,
      type: optionalString(a.agentType) || null,
      status: a.status,
      firstTs: a.firstTs,
      lastTs: a.lastTs,
      toolCalls: a.toolCalls,
      tokens: a.tokens || null,
      model: a.model || null,
      depth: a.spawnDepth,
      group,
      oversized: a.oversized,
      extra: { toolUseId: a.toolUseId || null, description: a.description || null },
    })
  return {
    root: root.id,
    slug,
    id,
    runs,
    agents,
    children: [...agents.map((a) => toChild(a, null)), ...runs.flatMap((r) => (r.agents || []).map((a) => toChild(a, r.runId)))],
    groups: runs.map((r) => ({
      id: r.runId,
      name: r.name || r.description || r.runId,
      status: r.runStatus || 'unknown',
      agentCount: r.agentCount ?? (r.agents || []).length,
      elapsedMs: r.elapsedMs ?? null,
      tokens: r.totals || null,
    })),
  }
}

// Full transcript of a single sub-agent: its prompt, tool calls, and process.
// Workflow agent: pass run=wf_... ; plain Task/Agent: omit run.
function getSubagent(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const slug = q.get('slug')
  const session = q.get('session')
  const run = q.get('run')
  const agent = q.get('agent')
  if (!slug || !session || !agent) throw httpErr(400, 'missing slug/session/agent')
  if (/[\\/]/.test(agent) || agent.includes('..')) throw httpErr(400, 'bad agent')
  const subagentsDir = path.join(root.dir, 'projects', slug, session, 'subagents')
  let file: string
  if (run) {
    if (!/^wf_[\w.-]+$/.test(run)) throw httpErr(400, 'bad run')
    file = path.join(subagentsDir, 'workflows', run, `agent-${agent}.jsonl`)
  } else {
    file = path.join(subagentsDir, `agent-${agent}.jsonl`)
  }
  assertInside(root.dir, file)
  if (!fs.existsSync(file)) throw httpErr(404, 'agent transcript not found')
  const fp = fingerprintOf(file) // one stat, before any read (see parseCache.js)
  // spread-copy: cached summaries are shared across requests (immutable)
  return { root: root.id, run, agent, summary: { ...sessionSummary(file, agent, fp) }, timeline: sessionTimeline(file, fp), _etag: etagOf(fp) }
}

// token fields: the common set every provider has, plus Claude's own cacheCreate
const TOKEN_SPECIFIC = ['cacheCreate']
const zeroTokens = () => zeroTokensShared(TOKEN_SPECIFIC)

// root-level totals + a per-project rollup. Drill into a project's per-session
// breakdown via GET /api/sessions?root=&slug= (already per-session summaries).
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
  for (const slug of listProjectSlugs(root.dir)) {
    if (selected && !selected.has(slug)) continue
    const files = sessionFiles(root.dir, slug)
    if (!files.length) continue
    const proj = {
      slug,
      cwd: null,
      sessions: files.length,
      subagentSessions: 0,
      userTurns: 0,
      toolCalls: 0,
      tokens: zeroTokens(),
      toolCounts: {} as Record<string, number>,
      models: new Set<string>(),
      lastActivity: 0,
    }
    for (const f of files) {
      // one stat per file, before its content is read (see parseCache.js)
      let fp = null
      try {
        fp = fingerprintOf(f.file)
      } catch {}
      const s = withOversizeFallback(
        () => sessionSummary(f.file, f.id, fp || undefined),
        (e) => oversizeStub(f.id, e) // counts as a session, contributes zeros
      )
      if (s.oversized) incomplete.push({ slug, id: f.id, reason: 'Transcript too large; usage is unavailable' })
      const mtime = fp ? fp.mtimeMs : 0
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
  // `fields` tells the UI which token fields every provider shares (add these up
  // across folders) and which are Claude's own
  // sub-agent transcripts are sidecar files (projects/*/*/subagents/), not sessions
  return {
    root: root.id,
    projectCount: projects.length,
    sessions,
    subagentSessions: 0,
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
        out.push({ display: o.display || '', project: o.project || null, sessionId: o.sessionId || null, ts: o.timestamp || o.ts || null })
      } catch {
        malformed++
      }
    }
  } catch (e) {
    readError = jsonRecord(e).code === 'ENOENT' ? 'No prompt-history file recorded by this source' : optionalString(jsonRecord(e).message)
  }
  return { root: root.id, ...homeHistory(out, q, readError, malformed) }
}

function getMemory(q: URLSearchParams) {
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
  // scope/writable: the envelope every provider's memory shares (spec §4 item 4)
  return { root: root.id, slug, scope: 'project', writable: true, index, files }
}

// Memory files are flat .md files under projects/<slug>/memory (getMemory reads
// them non-recursively), so names allow no separators at all — stricter than
// resources' safeName, which permits '/' for nested rules.
function checkMemoryName(name: string | null) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
    throw httpErr(400, `Invalid name: ${name}`)
  }
  if (!name.endsWith('.md')) throw httpErr(400, 'Name must end with .md')
  return name
}

function memoryFile(root: Root, slug: string, name: string) {
  const file = path.join(root.dir, 'projects', slug, 'memory', name)
  assertInside(root.dir, file) // also guards slug traversal — the joined path must stay inside the root
  return file
}

function postMemory(_q: URLSearchParams, body: ProviderRequest) {
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

async function deleteMemory(q: URLSearchParams) {
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
function normalizeInstalledPlugins(raw: unknown) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === 'string' ? { name: x } : x))
  // v2 nests the real map under `plugins`; legacy keyed objects don't.
  const object = jsonRecord(raw)
  const map = object.plugins && typeof object.plugins === 'object' ? jsonRecord(object.plugins) : object
  const out = []
  for (const [key, val] of Object.entries(map)) {
    const at = key.lastIndexOf('@')
    const rec = jsonRecord(Array.isArray(val) ? val[0] : val)
    out.push({
      name: at > 0 ? key.slice(0, at) : key,
      marketplace: at > 0 ? key.slice(at + 1) : (rec.marketplace ?? null),
      version: rec.version ?? null,
      scope: rec.scope ?? null,
      installedAt: rec.installedAt ?? null,
      lastUpdated: rec.lastUpdated ?? null,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function getPlugins(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const pdir = path.join(root.dir, 'plugins')
  const readJson = (f: string): unknown => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8'))
    } catch {
      return null
    }
  }
  const installedRaw = readJson('installed_plugins.json')
  const known = jsonRecord(readJson('known_marketplaces.json'))
  // marketplaces actually present on disk, annotated with their source repo
  let marketplaces: { name: string; repo: unknown }[] = []
  try {
    marketplaces = fs
      .readdirSync(path.join(pdir, 'marketplaces'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, repo: jsonRecord(jsonRecord(known[e.name]).source).repo || null }))
  } catch {}
  return {
    root: root.id,
    installed: normalizeInstalledPlugins(installedRaw),
    marketplaces,
  }
}

// --- resources ---------------------------------------------------------------

function projectCwd(rootDir: string, slug: string) {
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
function resolveScope(rootId: string | null | undefined, slug: string | null | undefined) {
  const root = resolveRoot(rootId)
  if (slug) {
    const cwd = projectCwd(root.dir, slug)
    return { root, base: path.join(cwd, '.claude'), claudeRoot: cwd, scope: 'project', label: cwd }
  }
  return { root, base: root.dir, claudeRoot: root.dir, scope: 'root', label: root.label }
}

function getResources(q: URLSearchParams) {
  const s = resolveScope(q.get('root'), q.get('slug'))
  return { root: s.root.id, scope: s.scope, label: s.label, ...inventory(s.base, { claudeRoot: s.claudeRoot }) }
}

const PROJECT_ONLY: Record<string, string> = {
  mcpJson: '.mcp.json is project-scope only (user MCP lives in ~/.claude.json)',
  settingsLocalJson: 'settings.local.json is project-scope only',
}
function guardScope(kind: string | null, scope: string) {
  if (kind && PROJECT_ONLY[kind] && scope !== 'project') throw httpErr(400, PROJECT_ONLY[kind])
}

function getResource(q: URLSearchParams) {
  const s = resolveScope(q.get('root'), q.get('slug'))
  guardScope(q.get('kind'), s.scope)
  return { root: s.root.id, scope: s.scope, ...readResource(s.base, q.get('kind') || '', q.get('name'), { claudeRoot: s.claudeRoot }) }
}

function postResource(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root || !body?.kind || !body?.name) throw httpErr(400, 'missing root/kind/name')
  const s = resolveScope(body.root, body.slug)
  guardScope(body.kind, s.scope)
  return writeResource(s.base, body.kind, body.name, body.content || '', { claudeRoot: s.claudeRoot })
}

async function deleteResource_(q: URLSearchParams) {
  const s = resolveScope(q.get('root'), q.get('slug'))
  return deleteResource(s.base, q.get('kind') || '', q.get('name'), q.get('stamp'), { claudeRoot: s.claudeRoot })
}

// --- skill import: delegate to the `skills` CLI (npx skills add) -------------
// Runs an external program on the user's machine; the UI confirms before calling.

async function postSkillRun(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root) throw httpErr(400, 'missing root')
  if (!body?.ref) throw httpErr(400, 'missing ref')
  const s = resolveScope(body.root, body.slug)
  const args = parseSkillsAdd(body.ref)
  // project scope -> cwd-relative install into <project-cwd>/.claude/skills;
  // user scope -> -g + CLAUDE_CONFIG_DIR=<root> installs into <root>/skills.
  const global = s.scope !== 'project'
  const cwd = s.scope === 'project' ? s.claudeRoot : s.root.dir
  const configDir = global ? s.root.dir : null
  return await runSkillsAdd({ cwd, args, global, configDir, config: SKILL_CONFIG })
}

// --- open local app (editor / terminal) at a session's working dir -----------

async function postOpen(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root || !body?.what) throw httpErr(400, 'missing root/what')
  const root = resolveRoot(body.root)
  let cwd = null
  if (body.cwd && path.isAbsolute(body.cwd) && fs.existsSync(body.cwd))
    cwd = body.cwd // explicit (new-project draft)
  else if (body.slug && body.id) cwd = readCwd(findSessionFile(root.dir, body.slug, body.id))
  else if (body.slug) cwd = projectCwd(root.dir, body.slug) // draft / no specific session
  if (!cwd || !path.isAbsolute(cwd)) throw httpErr(404, 'cannot resolve this project’s working directory')
  await openTool(body.what, cwd)
  return { ok: true, what: body.what, cwd }
}

// --- terminal mode: embedded ttyd running the real claude TUI ----------------

async function postTerminal(_q: URLSearchParams, body: ProviderRequest) {
  if (!body?.root) throw httpErr(400, 'missing root')
  const root = resolveRoot(body.root)
  const attached = await reattachTerminal({ body, root, config: TERMINAL_CONFIG })
  if (attached) return { ok: true, ...attached }
  let cwd: string | null | undefined
  let resumeId = null
  if (body.id && body.slug) {
    cwd = readCwd(findSessionFile(root.dir, body.slug, body.id)) // continue existing
    resumeId = body.id
  } else if (body.cwd) {
    cwd = body.cwd // new conversation at an explicit path
  } else if (body.slug) {
    cwd = projectCwd(root.dir, body.slug) // new conversation under an existing project
  } else if (body.brief) {
    cwd = USER_HOME // a hand-off with no folder (Insights) runs from the home directory
  } else {
    throw httpErr(400, 'missing slug/id or cwd')
  }
  if (!cwd || !fs.existsSync(cwd)) throw httpErr(404, 'The working directory is unavailable. Choose an existing folder.')
  const identity = terminalIdentity(TERMINAL_CONFIG.id, root.id, { id: resumeId, launchId: body.launchId })
  const key = identity.key
  // CLAUDE_CONFIG_DIR = the session's tracked root → uses that account's login (the credential fix)
  // AI hand-off: the request + file + docs go into a brief file; the CLI starts
  // seeded with a one-line prompt that points at it (server/shared/handoff.ts)
  let promptArgs = null
  let briefFile = null
  if (!resumeId && body.brief && typeof body.brief === 'object') {
    briefFile = writeBrief(composeBrief({ ...body.brief, providerLabel: 'Claude Code', cwd }), { key })
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
  return stopTerminal(q.get('key') || '', 'claude')
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

// open the OS-native folder chooser (blocks until the user picks/cancels)

// --- dispatcher --------------------------------------------------------------

// Usage limits (5-hour / weekly) bridged from the status line. Claude Code only
// exposes rate_limits to a status line command (never to disk), so an optional
// status line snippet writes <config_dir>/rate-limits.json, which we read here.
// See README "Usage limits bar". Absent file → null (bar simply hides).
// usage.ts is always ms (the status line writes unix seconds; codex/agy snapshots are ISO)
const toMs = (v: unknown) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) || null : null)
function getUsage(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root.dir, 'rate-limits.json'), 'utf8'))
    return {
      root: root.id,
      rateLimits: d.rate_limits || null,
      contextWindow: d.context_window || null,
      sessionId: d.session_id || null,
      ts: toMs(d.updated_at),
    }
  } catch {
    return { root: root.id, rateLimits: null, contextWindow: null, sessionId: null, ts: null }
  }
}

// The Claude Code version observed in the most recent tracked session — read
// from the `version` field carried on transcript records. This is the version
// AgentDeck has *observed* tracking, not necessarily what's installed right now.
function latestClaudeVersion(rootDir: string) {
  const projectsDir = path.join(rootDir, 'projects')
  let newest = null
  try {
    for (const slug of fs.readdirSync(projectsDir)) {
      let entries: string[]
      try {
        entries = fs.readdirSync(path.join(projectsDir, slug))
      } catch {
        continue
      }
      for (const f of entries) {
        if (!f.endsWith('.jsonl')) continue
        const fp = path.join(projectsDir, slug, f)
        let m: number
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

function getVersion(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  return { version: latestClaudeVersion(root.dir) }
}

// --- activity ----------------------------------------------------------------
// GET /api/activity?root=&days= — per-day / hour / weekday usage profile of one
// tracked folder (see server/shared/activity.ts for the attribution rules).
function getActivity(q: URLSearchParams) {
  const root = resolveRoot(q.get('root'))
  const selected = homeProjects(q)
  const days = Number(q.get('days')) || 84
  const list = []
  for (const slug of listProjectSlugs(root.dir)) {
    if (selected && !selected.has(slug)) continue
    const files = sessionFiles(root.dir, slug)
    if (!files.length) continue
    let cwd = null
    for (const f of files) {
      let fp = null
      try {
        fp = fingerprintOf(f.file)
      } catch {}
      const s = withOversizeFallback(
        () => sessionSummary(f.file, f.id, fp || undefined),
        (e) => oversizeStub(f.id, e)
      )
      if (!cwd) cwd = readCwd(f.file)
      list.push({
        id: f.id,
        slug,
        cwd,
        title: s.title,
        firstTs: s.firstTs,
        lastTs: s.lastTs,
        userTurns: s.userTurns,
        toolCalls: s.toolCalls,
        tokens: s.tokens,
        models: s.models,
        ...(q.get('home') === '1' ? { oversized: !!s.oversized } : {}),
      })
    }
  }
  return q.get('home') === '1' ? { root: root.id, records: list } : { root: root.id, ...bucketActivity(list, { days }) }
}

// Provider-owned data handlers; request inventory belongs to the shared factory.
export const DATA = {
  requestFields: { session: ['slug', 'id'], resource: ['root', 'kind', 'name'] },
  id: 'claude',
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
  deleteResource: deleteResource_,
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
export { getSubagent, postMemory, deleteMemory, getResource }

// A fork is a new native transcript; publishing never edits the source.
export function postFork(_query: URLSearchParams, input: unknown) {
  const body = requireFields(input, ['root', 'slug', 'id']) as ProviderRequest & { root: string; slug: string; id: string }
  if (body.cut != null && (typeof body.cut !== 'string' || !body.cut)) throw httpErr(400, 'cut must be a non-empty prompt UUID')
  const root = resolveRoot(body.root)
  const source = findSessionFile(root.dir, body.slug, body.id)
  try {
    const fork = writeFork(
      root.dir,
      source,
      (id) => id + '.jsonl',
      (lines, id) => forkLines(lines, body.cut as string | null | undefined, id)
    )
    return { root: root.id, slug: body.slug, id: fork.id }
  } catch (error) {
    if (jsonRecord(error).code === 'CUT_NOT_FOUND' || jsonRecord(error).code === 'EMPTY_FORK') throw httpErr(400, String(jsonRecord(error).message))
    throw error
  }
}
