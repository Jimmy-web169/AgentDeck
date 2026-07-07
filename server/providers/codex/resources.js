import fs from 'node:fs'
import path from 'node:path'
import { safeTrash } from '../../shared/trash.js'

// Inventory the configurable Codex resources at a given scope. Codex resolves
// most of these at BOTH user scope (the Codex home, e.g. ~/.codex) and project
// scope (a repo's .codex/ dir + its AGENTS.md). This module reads them for
// display — it never writes. We don't ship a full TOML parser; we do targeted
// line scans that are robust enough to surface the structures that matter and
// always include the raw config.toml so nothing is hidden.

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Split a TOML doc into top-level lines + [table] / [[array]] sections.
// Skips lines inside triple-quoted strings so a `[...]`-looking line in a
// multiline value doesn't get mistaken for a section header.
function splitToml(toml) {
  const top = []
  const sections = []
  let cur = null
  let inBlock = false
  for (const raw of (toml || '').split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (inBlock) {
      if ((line.match(/"""/g) || []).length % 2 === 1) inBlock = false
      ;(cur ? cur.lines : top).push(line)
      continue
    }
    const s = line.trim()
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(s)
    if (header && !s.startsWith('#')) {
      cur = { header: header[1].trim(), array: s.startsWith('[['), lines: [] }
      sections.push(cur)
    } else {
      ;(cur ? cur.lines : top).push(line)
    }
    if ((line.match(/"""/g) || []).length % 2 === 1) inBlock = true
  }
  return { top, sections }
}

// Pull `key = value` pairs from a block of lines (strips quotes/comments;
// skips multiline triple-quoted values).
function kvPairs(lines, keys) {
  const out = {}
  let inBlock = false
  for (const raw of lines) {
    if (inBlock) {
      if ((raw.match(/"""/g) || []).length % 2 === 1) inBlock = false
      continue
    }
    const s = raw.trim()
    if (!s || s.startsWith('#')) continue
    const m = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(s)
    if (m) {
      let v = m[2]
      if (v.includes('"""')) {
        if ((v.match(/"""/g) || []).length % 2 === 1) inBlock = true
        v = v.replace(/"""/g, '').trim()
      }
      v = v.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
      if (!keys || keys.includes(m[1])) out[m[1]] = v
    }
  }
  return out
}

// Top-level summary chips + global [agents]/[features] tables.
function configSummary(toml) {
  const { top, sections } = splitToml(toml)
  const t = kvPairs(top, ['model', 'model_provider', 'approval_policy', 'sandbox_mode', 'model_reasoning_effort', 'web_search', 'personality'])
  const features = {}
  const agentLimits = {}
  for (const sec of sections) {
    if (sec.header === 'features') Object.assign(features, kvPairs(sec.lines))
    else if (sec.header === 'agents') Object.assign(agentLimits, kvPairs(sec.lines, ['max_threads', 'max_depth', 'job_max_runtime_seconds']))
  }
  return { summary: t, features, agentLimits }
}

// MCP servers configured in a config.toml ([mcp_servers.<id>] sections).
function mcpServers(toml) {
  const { sections } = splitToml(toml)
  const out = []
  for (const sec of sections) {
    const m = /^mcp_servers\.([A-Za-z0-9_.-]+)$/.exec(sec.header)
    if (!m) continue
    const kv = kvPairs(sec.lines, ['command', 'url', 'enabled', 'startup_timeout_sec'])
    out.push({
      id: m[1],
      transport: kv.url ? 'http' : 'stdio',
      command: kv.command || null,
      url: kv.url || null,
      enabled: kv.enabled !== 'false',
    })
  }
  return out
}

// Lifecycle hook events declared inline ([[hooks.<Event>]]) or in hooks.json.
function hookEvents(toml, hooksJson) {
  const events = new Set()
  for (const sec of splitToml(toml).sections) {
    const m = /^hooks\.([A-Za-z]+)$/.exec(sec.header)
    if (m) events.add(m[1])
  }
  if (hooksJson) {
    try {
      const o = JSON.parse(hooksJson)
      for (const k of Object.keys(o.hooks || {})) events.add(k)
    } catch {}
  }
  return [...events].sort()
}

// Custom subagent definitions: standalone TOML files in the agents/ dir.
function customAgents(agentsDir) {
  if (!dirExists(agentsDir)) return []
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(agentsDir)
  } catch {
    return []
  }
  for (const name of entries) {
    if (!name.endsWith('.toml')) continue
    const text = readText(path.join(agentsDir, name))
    if (text == null) continue
    const { top } = splitToml(text)
    const kv = kvPairs(top, ['name', 'description', 'model', 'sandbox_mode', 'model_reasoning_effort'])
    out.push({
      file: name,
      name: kv.name || name.replace(/\.toml$/, ''),
      description: kv.description || '',
      model: kv.model || null,
      sandbox: kv.sandbox_mode || null,
      effort: kv.model_reasoning_effort || null,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function listRules(rulesDir) {
  if (!dirExists(rulesDir)) return []
  const out = []
  try {
    for (const name of fs.readdirSync(rulesDir)) {
      if (!name.endsWith('.rules')) continue
      out.push({ name, content: readText(path.join(rulesDir, name)) || '' })
    }
  } catch {}
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Skills: each dir with a SKILL.md (+ YAML frontmatter name/description).
function frontmatter(md) {
  if (!md.startsWith('---')) return {}
  const end = md.indexOf('\n---', 3)
  if (end === -1) return {}
  const out = {}
  for (const line of md.slice(3, end).split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (m && !line.startsWith(' ')) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const MAX_SKILL_BYTES = 64 * 1024
function listSkills(dirs) {
  const out = []
  const seen = new Set()
  for (const { dir, system } of dirs) {
    if (!dirExists(dir)) continue
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const content = readText(path.join(dir, e.name, 'SKILL.md'))
      if (content == null) continue
      const key = `${e.name}`
      if (seen.has(key)) continue
      seen.add(key)
      const fm = frontmatter(content)
      out.push({ name: fm.name || e.name, description: fm.description || '', system: !!system, content: content.slice(0, MAX_SKILL_BYTES) })
    }
  }
  return out.sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name))
}

function readAgentsMd(dir) {
  // an override file, when present, replaces AGENTS.md at that level
  const override = readText(path.join(dir, 'AGENTS.override.md'))
  if (override != null) return { name: 'AGENTS.override.md', content: override }
  const base = readText(path.join(dir, 'AGENTS.md'))
  if (base != null) return { name: 'AGENTS.md', content: base }
  return null
}

// ---- writing (create config from the UI) -----------------------------------
// All writes target the user's own machine (their Codex home, or a project's
// .codex/). The server is localhost-only and the UI confirms before writing.

function httpish(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

function safeName(s) {
  const v = String(s || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || v.includes('..')) {
    throw httpish(400, 'invalid name — use letters, digits, dot, underscore or hyphen')
  }
  return v
}

const q = (s) => JSON.stringify(String(s ?? '')) // TOML/JSON-safe double-quoted string

function scopePaths(scope, base) {
  const codexDir = scope === 'project' ? path.join(base, '.codex') : base
  return {
    codexDir,
    agentsDir: path.join(codexDir, 'agents'),
    skillsDir: scope === 'project' ? path.join(codexDir, 'skills') : path.join(base, 'skills'),
    hooksJson: path.join(codexDir, 'hooks.json'),
    configToml: path.join(codexDir, 'config.toml'),
    agentsMd: path.join(base, 'AGENTS.md'),
  }
}

function buildAgentToml(f) {
  const lines = [`name = ${q(f.name)}`, `description = ${q(f.description || '')}`]
  if (f.model) lines.push(`model = ${q(f.model)}`)
  if (f.model_reasoning_effort) lines.push(`model_reasoning_effort = ${q(f.model_reasoning_effort)}`)
  if (f.sandbox_mode) lines.push(`sandbox_mode = ${q(f.sandbox_mode)}`)
  const nicks = (f.nickname_candidates || []).filter(Boolean)
  if (nicks.length) lines.push(`nickname_candidates = [${nicks.map(q).join(', ')}]`)
  lines.push(`developer_instructions = """\n${String(f.developer_instructions || '').trim()}\n"""`)
  return lines.join('\n') + '\n'
}

function buildMcpBlock(f) {
  const L = [`[mcp_servers.${f.id}]`]
  if (f.transport === 'http') {
    L.push(`url = ${q(f.url)}`)
    if (f.bearer_token_env_var) L.push(`bearer_token_env_var = ${q(f.bearer_token_env_var)}`)
  } else {
    L.push(`command = ${q(f.command)}`)
    const args = (f.args || []).filter((a) => a !== '')
    if (args.length) L.push(`args = [${args.map(q).join(', ')}]`)
  }
  return L.join('\n') + '\n'
}

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop']

function addHook(file, f) {
  let doc = {}
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {}
  if (!doc || typeof doc !== 'object') doc = {}
  if (!doc.hooks || typeof doc.hooks !== 'object') doc.hooks = {}
  if (!Array.isArray(doc.hooks[f.event])) doc.hooks[f.event] = []
  const handler = { type: 'command', command: f.command }
  if (f.timeout) handler.timeout = Number(f.timeout)
  if (f.statusMessage) handler.statusMessage = f.statusMessage
  const group = { hooks: [handler] }
  if (f.matcher) group.matcher = f.matcher
  doc.hooks[f.event].push(group)
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
}

// Create a resource at the given scope. Returns the path written.
export function createResource(scope, base, body) {
  const p = scopePaths(scope, base)
  switch (body.kind) {
    case 'agent': {
      const name = safeName(body.name)
      fs.mkdirSync(p.agentsDir, { recursive: true })
      const file = path.join(p.agentsDir, `${name}.toml`)
      if (fs.existsSync(file) && !body.overwrite) throw httpish(409, `agent "${name}" already exists`)
      fs.writeFileSync(file, buildAgentToml({ ...body, name }))
      return file
    }
    case 'skill': {
      const name = safeName(body.name)
      const dir = path.join(p.skillsDir, name)
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'SKILL.md')
      if (fs.existsSync(file) && !body.overwrite) throw httpish(409, `skill "${name}" already exists`)
      const desc = String(body.description || '').replace(/\s*\n\s*/g, ' ').trim()
      fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${desc}\n---\n\n${String(body.body || '').trim()}\n`)
      return file
    }
    case 'hook': {
      if (!HOOK_EVENTS.includes(body.event)) throw httpish(400, 'unknown hook event')
      if (!String(body.command || '').trim()) throw httpish(400, 'hook command is required')
      fs.mkdirSync(p.codexDir, { recursive: true })
      addHook(p.hooksJson, body)
      return p.hooksJson
    }
    case 'mcp': {
      const id = safeName(body.id)
      if (body.transport === 'http') {
        if (!String(body.url || '').trim()) throw httpish(400, 'server url is required')
      } else if (!String(body.command || '').trim()) {
        throw httpish(400, 'launch command is required')
      }
      fs.mkdirSync(p.codexDir, { recursive: true })
      let toml = ''
      try {
        toml = fs.readFileSync(p.configToml, 'utf8')
      } catch {}
      if (new RegExp(`(^|\\n)\\s*\\[mcp_servers\\.${id}\\]`).test(toml)) throw httpish(409, `mcp server "${id}" is already configured`)
      const sep = toml ? (toml.endsWith('\n') ? '\n' : '\n\n') : ''
      fs.writeFileSync(p.configToml, toml + sep + buildMcpBlock({ ...body, id }))
      return p.configToml
    }
    case 'agentsMd': {
      fs.writeFileSync(p.agentsMd, `${String(body.content || '').replace(/\s*$/, '')}\n`)
      return p.agentsMd
    }
    default:
      throw httpish(400, `unknown resource kind: ${body.kind}`)
  }
}

// Resolve the resource paths for a scope and read everything.
//   user scope:    base = the Codex home (~/.codex)
//   project scope: base = a project's cwd; config/agents/hooks/rules live in base/.codex/
export function inventory(scope, baseDir) {
  const codexDir = scope === 'project' ? path.join(baseDir, '.codex') : baseDir
  const configToml = readText(path.join(codexDir, 'config.toml'))
  const hooksJson = readText(path.join(codexDir, 'hooks.json'))
  const { summary, features, agentLimits } = configSummary(configToml)
  const skillDirs =
    scope === 'project'
      ? [{ dir: path.join(baseDir, '.agents', 'skills') }, { dir: path.join(codexDir, 'skills') }]
      : [{ dir: path.join(baseDir, 'skills') }, { dir: path.join(baseDir, 'skills', '.system'), system: true }]
  return {
    scope,
    base: baseDir,
    codexDir,
    summary,
    features,
    agentLimits,
    configToml,
    hasHooksJson: hooksJson != null,
    agentsMd: readAgentsMd(baseDir),
    agents: customAgents(path.join(codexDir, 'agents')),
    mcpServers: mcpServers(configToml),
    hooks: hookEvents(configToml, hooksJson),
    rules: listRules(path.join(codexDir, 'rules')),
    skills: listSkills(skillDirs),
  }
}

// ---- deleting (remove config from the UI) ----------------------------------
// File/dir resources (skill, agent, rule) are moved to the OS trash via `trash`
// — recoverable, and nothing is hard-deleted. Embedded resources (mcp, hook)
// are removed in place by rewriting their host file (config.toml / hooks.json).
// config.toml and AGENTS.md themselves are edited, never deleted, from here.

// The same skill search dirs `inventory` uses, so a delete matches what the UI
// listed. System skills are never deletable.
function skillDirsFor(scope, base) {
  const codexDir = scope === 'project' ? path.join(base, '.codex') : base
  return scope === 'project'
    ? [{ dir: path.join(base, '.agents', 'skills') }, { dir: path.join(codexDir, 'skills') }]
    : [{ dir: path.join(base, 'skills') }, { dir: path.join(base, 'skills', '.system'), system: true }]
}

// Find the on-disk skill dir whose listed name (frontmatter name || dir name)
// matches `name` — mirrors listSkills so deletes line up with the UI.
function findSkillDir(dirs, name) {
  for (const { dir, system } of dirs) {
    if (system || !dirExists(dir)) continue
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const md = readText(path.join(dir, e.name, 'SKILL.md'))
      if (md == null) continue
      if ((frontmatter(md).name || e.name) === name) return path.join(dir, e.name)
    }
  }
  return null
}

// Find the agent .toml whose listed name (name key || file stem) matches.
function findAgentFile(agentsDir, name) {
  if (!dirExists(agentsDir)) return null
  let entries = []
  try {
    entries = fs.readdirSync(agentsDir)
  } catch {
    return null
  }
  for (const f of entries) {
    if (!f.endsWith('.toml')) continue
    const kv = kvPairs(splitToml(readText(path.join(agentsDir, f)) || '').top, ['name'])
    if ((kv.name || f.replace(/\.toml$/, '')) === name) return path.join(agentsDir, f)
  }
  return null
}

function findRuleFile(rulesDir, name) {
  if (!dirExists(rulesDir)) return null
  try {
    for (const f of fs.readdirSync(rulesDir)) if (f === name && f.endsWith('.rules')) return path.join(rulesDir, f)
  } catch {}
  return null
}

// Remove a [section]/[[section]] (header + its body up to the next header) from
// a TOML doc, leaving everything else byte-for-byte. Triple-quote aware so a
// `[...]`-looking line inside a multiline value isn't mistaken for a header.
function stripTomlSection(toml, target) {
  const out = []
  let skipping = false
  let inBlock = false
  let removed = false
  for (const raw of (toml || '').split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (inBlock) {
      if ((line.match(/"""/g) || []).length % 2 === 1) inBlock = false
      if (!skipping) out.push(line)
      continue
    }
    const s = line.trim()
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(s)
    if (header && !s.startsWith('#')) {
      skipping = header[1].trim() === target
      if (skipping) removed = true
    }
    if (!skipping) out.push(line)
    if ((line.match(/"""/g) || []).length % 2 === 1) inBlock = true
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed }
}

// Delete a resource at the given scope. Returns what happened. Throws httpish
// (status) for unknown kinds, missing targets, or undeletable singletons.
export async function deleteResource(scope, base, kind, rawName) {
  const name = String(rawName ?? '').trim()
  if (!name) throw httpish(400, 'missing name')
  const p = scopePaths(scope, base)
  switch (kind) {
    case 'skill': {
      const target = findSkillDir(skillDirsFor(scope, base), name)
      if (!target) throw httpish(404, `skill "${name}" not found (system skills can't be deleted here)`)
      await safeTrash(target)
      return { kind, name, trashed: true }
    }
    case 'agent': {
      const file = findAgentFile(p.agentsDir, name)
      if (!file) throw httpish(404, `agent "${name}" not found`)
      await safeTrash(file)
      return { kind, name, trashed: true }
    }
    case 'rule': {
      const file = findRuleFile(path.join(p.codexDir, 'rules'), name)
      if (!file) throw httpish(404, `rule "${name}" not found`)
      await safeTrash(file)
      return { kind, name, trashed: true }
    }
    case 'mcp': {
      const toml = readText(p.configToml)
      if (toml == null) throw httpish(404, 'config.toml not found at this scope')
      const { text, removed } = stripTomlSection(toml, `mcp_servers.${name}`)
      if (!removed) throw httpish(404, `mcp server "${name}" not found in config.toml`)
      fs.writeFileSync(p.configToml, text)
      return { kind, name, removed: true }
    }
    case 'hook': {
      let removed = false
      // hooks defined in hooks.json: drop the event's handler list
      try {
        const doc = JSON.parse(fs.readFileSync(p.hooksJson, 'utf8'))
        if (doc?.hooks && name in doc.hooks) {
          delete doc.hooks[name]
          fs.writeFileSync(p.hooksJson, JSON.stringify(doc, null, 2) + '\n')
          removed = true
        }
      } catch {}
      // hooks defined inline in config.toml: drop the [[hooks.<Event>]] section
      const toml = readText(p.configToml)
      if (toml != null) {
        const r = stripTomlSection(toml, `hooks.${name}`)
        if (r.removed) {
          fs.writeFileSync(p.configToml, r.text)
          removed = true
        }
      }
      if (!removed) throw httpish(404, `hook event "${name}" not found`)
      return { kind, name, removed: true }
    }
    default:
      throw httpish(400, `cannot delete resource kind "${kind}" from here`)
  }
}
