import fs from 'node:fs'
import path from 'node:path'
import { HOME } from '../../shared/roots.ts'

// Read-only inventory of what configures agy. Locations follow the official
// docs (antigravity.google/docs/skills, /docs/mcp, /docs/plugins,
// /docs/cli/settings) plus what the CLI itself keeps under its home:
//
//   workspace   {cwd}/.agents/{settings.json, mcp_config.json, hooks.json, rules.md, rules/, skills/, plugins/}
//               (.agent/ is the pre-2.0 name and still honoured)
//   shared      ~/.gemini/config/{settings.json, mcp_config.json, hooks.json, rules.md, rules/, skills/, plugins/}
//               (every Antigravity surface: IDE, CLI, hub)
//   cli         ~/.gemini/antigravity-cli/{settings.json, keybindings.json, skills/, builtin/skills/}
//   legacy      ~/.gemini/skills, ~/.gemini/GEMINI.md (Gemini CLI era; agy still reads GEMINI.md)
//
// Creating or deleting through AgentDeck is not offered for this provider —
// `agy mcp …`, `agy plugin …` and the /config overlay are the vendor's writers.

// Provider configuration stays unknown until its individual fields are read.
const fields = (value: unknown): Record<string, unknown> => Object(value)

const configDir = () => path.join(HOME, '.gemini', 'config')
const readJson = (p: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const readText = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
const listDirs = (dir: string) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}
const listFiles = (dir: string, ext: string) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => e.name)
  } catch {
    return []
  }
}

function skillsIn(dir: string, source: string) {
  const out = []
  for (const name of listDirs(dir)) {
    const md = path.join(dir, name, 'SKILL.md')
    if (!fs.existsSync(md)) continue
    const head = readText(md) || ''
    const fm = head.match(/^---\s*\n([\s\S]*?)\n---/)
    // a frontmatter scalar: one line, or a folded/literal block (`>-`, `|`) whose
    // indented continuation lines are joined — Google's bundled skills use the latter
    const field = (k: string) => {
      const lines = (fm?.[1] || '').split('\n')
      const i = lines.findIndex((l) => new RegExp(`^${k}:`).test(l))
      if (i < 0) return ''
      const first = lines[i].slice(k.length + 1).trim()
      if (!/^[>|][+-]?$/.test(first)) return first.replace(/^["']|["']$/g, '')
      const cont = []
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) cont.push(lines[j].trim())
      return cont.join(' ')
    }
    // the body after the frontmatter, capped — the right pane previews it like Codex's skills
    const body = fm ? head.slice(fm[0].length).trim() : head
    out.push({ name: field('name') || name, description: field('description').slice(0, 200), dir: path.join(dir, name), source, content: body.slice(0, 8000) })
  }
  return out
}

function mcpFrom(file: string, scope: string) {
  const j = fields(readJson(file))
  const servers = j && typeof j.mcpServers === 'object' ? j.mcpServers : {}
  return Object.entries(fields(servers)).map(([name, value]) => {
    const s = fields(value)
    return {
      name,
      scope,
      sourcePath: file,
      transport: s.serverUrl || s.url ? 'http' : 'stdio',
      command: s.command || null,
      args: Array.isArray(s.args) ? s.args : [],
      cwd: s.cwd || null,
      env: s.env && typeof s.env === 'object' ? Object.keys(s.env) : [],
      headers: s.headers && typeof s.headers === 'object' ? Object.keys(s.headers) : [],
      url: s.serverUrl || s.url || null,
      enabled: !s.disabled,
      toolDeny: Array.isArray(s.disabledTools) ? s.disabledTools : [],
    }
  })
}

// hooks.json: { hooks?: { <event>: [...] } } or { <event>: [...] } — we only
// report which events are wired and how many handlers each has
function hooksFrom(file: string, scope: string) {
  const value = readJson(file)
  if (!value || typeof value !== 'object') return null
  const j = fields(value)
  const map = j.hooks && typeof j.hooks === 'object' ? j.hooks : j
  const events = Object.entries(fields(map))
    .filter(([, v]) => Array.isArray(v) || (v && typeof v === 'object'))
    .map(([k, v]) => ({ event: k, handlers: Array.isArray(v) ? v.length : Object.keys(fields(v)).length }))
  return { scope, sourcePath: file, events }
}

function rulesIn(base: string, scope: string) {
  const out = []
  const one = path.join(base, 'rules.md')
  if (fs.existsSync(one)) out.push({ scope, name: 'rules.md', path: one, text: (readText(one) || '').slice(0, 4000) })
  for (const f of listFiles(path.join(base, 'rules'), '.md')) {
    const p = path.join(base, 'rules', f)
    out.push({ scope, name: f, path: p, text: (readText(p) || '').slice(0, 4000) })
  }
  return out
}

// a plugin directory (global or workspace): plugin.json marker + skills/, rules/, mcp_config.json, hooks.json
function pluginsIn(dir: string, scope: string, enabledMap: unknown) {
  const out = []
  for (const name of listDirs(dir)) {
    const pdir = path.join(dir, name)
    if (!fs.existsSync(path.join(pdir, 'plugin.json'))) continue
    const manifest = fields(readJson(path.join(pdir, 'plugin.json')))
    const ver = fields(readJson(path.join(pdir, 'installed_version.json')))
    out.push({
      name: manifest.name || name,
      dirName: name,
      version: manifest.version || ver?.version || null,
      description: manifest.description || '',
      path: pdir,
      scope,
      enabled: fields(fields(enabledMap)[pdir]).enabled ?? fields(fields(enabledMap)[name]).enabled ?? true,
      skills: skillsIn(path.join(pdir, 'skills'), `plugin:${name}`).length,
      rules: rulesIn(pdir, `plugin:${name}`).length,
      mcpServers: mcpFrom(path.join(pdir, 'mcp_config.json'), `plugin:${name}`).length,
      hooks: !!hooksFrom(path.join(pdir, 'hooks.json'), `plugin:${name}`),
    })
  }
  return out
}

export function readPlugins(rootDir: string) {
  const enabledMap = fields(readJson(path.join(configDir(), 'config.json'))).plugins || {}
  const installed = pluginsIn(path.join(configDir(), 'plugins'), 'user', enabledMap)
  return { installed, marketplaces: [], rootDir, readOnly: true }
}

// the workspace config dir: .agents/ (current) else .agent/ (pre-2.0)
function workspaceConfigDir(base: string) {
  const a = path.join(base, '.agents')
  if (fs.existsSync(a)) return a
  const b = path.join(base, '.agent')
  return fs.existsSync(b) ? b : a
}

export function inventory(scope: string, base: string, rootDir: string) {
  if (scope === 'project') {
    const wd = workspaceConfigDir(base)
    const plugins = pluginsIn(path.join(wd, 'plugins'), 'workspace', null)
    const skills = skillsIn(path.join(wd, 'skills'), 'workspace')
    const mcpServers = mcpFrom(path.join(wd, 'mcp_config.json'), 'workspace')
    const hooks = [hooksFrom(path.join(wd, 'hooks.json'), 'workspace')].filter(Boolean)
    const rules = rulesIn(wd, 'workspace')
    for (const p of plugins) {
      skills.push(...skillsIn(path.join(p.path, 'skills'), `plugin:${p.name}`))
      mcpServers.push(...mcpFrom(path.join(p.path, 'mcp_config.json'), `plugin:${p.name}`))
      const h = hooksFrom(path.join(p.path, 'hooks.json'), `plugin:${p.name}`)
      if (h) hooks.push(h)
      rules.push(...rulesIn(p.path, `plugin:${p.name}`))
    }
    return {
      scope,
      base,
      configDir: wd,
      skills,
      mcpServers,
      hooks,
      rules,
      plugins,
      settings: readJson(path.join(wd, 'settings.json')),
      agentsMd: readText(path.join(base, 'AGENTS.md')),
      geminiMd: readText(path.join(base, 'GEMINI.md')),
      readOnly: true,
    }
  }
  const cfg = configDir()
  const enabledMap = fields(readJson(path.join(cfg, 'config.json'))).plugins || {}
  const plugins = pluginsIn(path.join(cfg, 'plugins'), 'user', enabledMap)
  const skills = [
    ...skillsIn(path.join(rootDir, 'builtin', 'skills'), 'builtin'),
    ...skillsIn(path.join(rootDir, 'skills'), 'cli'),
    ...skillsIn(path.join(cfg, 'skills'), 'shared'),
    ...skillsIn(path.join(HOME, '.gemini', 'skills'), 'legacy'),
  ]
  const mcpServers = mcpFrom(path.join(cfg, 'mcp_config.json'), 'shared')
  const hooks = [hooksFrom(path.join(cfg, 'hooks.json'), 'shared')].filter(Boolean)
  const rules = rulesIn(cfg, 'shared')
  for (const p of plugins) {
    skills.push(...skillsIn(path.join(p.path, 'skills'), `plugin:${p.name}`))
    mcpServers.push(...mcpFrom(path.join(p.path, 'mcp_config.json'), `plugin:${p.name}`))
    const h = hooksFrom(path.join(p.path, 'hooks.json'), `plugin:${p.name}`)
    if (h) hooks.push(h)
    rules.push(...rulesIn(p.path, `plugin:${p.name}`))
  }
  return {
    scope,
    base: rootDir,
    configDir: cfg,
    skills,
    mcpServers,
    hooks,
    rules,
    plugins,
    agentsMd: null,
    geminiMd: readText(path.join(HOME, '.gemini', 'GEMINI.md')),
    settings: readJson(path.join(rootDir, 'settings.json')),
    sharedSettings: readJson(path.join(cfg, 'settings.json')),
    keybindings: readJson(path.join(rootDir, 'keybindings.json')),
    permissions: fields(fields(readJson(path.join(cfg, 'config.json'))).userSettings).globalPermissionGrants || null,
    readOnly: true,
  }
}
