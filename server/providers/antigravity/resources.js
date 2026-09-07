import fs from 'node:fs'
import path from 'node:path'
import { HOME } from '../../shared/roots.js'

// Read-only inventory of what configures agy: skills (built-in, user,
// plugin, workspace), MCP servers (~/.gemini/config/mcp_config.json plus the
// plugins' own), plugins, and the instruction files (AGENTS.md / GEMINI.md).
// Creating or deleting through AgentDeck is not offered for this provider yet —
// `agy plugin …` / `agy mcp …` are the vendor's own writers.

const configDir = () => path.join(HOME, '.gemini', 'config')
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const readText = (p) => {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function skillsIn(dir, source) {
  const out = []
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const md = path.join(dir, e.name, 'SKILL.md')
      if (!fs.existsSync(md)) continue
      const head = readText(md) || ''
      const desc = head.match(/^description:\s*(.+)$/m)?.[1]?.trim() || ''
      out.push({ name: e.name, description: desc.slice(0, 200), dir: path.join(dir, e.name), source })
    }
  } catch {}
  return out
}

function mcpFrom(file, scope) {
  const j = readJson(file)
  const servers = j && typeof j.mcpServers === 'object' ? j.mcpServers : {}
  return Object.entries(servers).map(([name, s]) => ({
    name,
    scope,
    sourcePath: file,
    transport: s.serverUrl || s.url ? 'sse' : 'stdio',
    command: s.command || null,
    args: Array.isArray(s.args) ? s.args : [],
    env: s.env && typeof s.env === 'object' ? Object.keys(s.env) : [],
    url: s.serverUrl || s.url || null,
    enabled: !s.disabled,
    toolDeny: Array.isArray(s.disabledTools) ? s.disabledTools : [],
  }))
}

export function readPlugins(rootDir) {
  const dir = path.join(configDir(), 'plugins')
  const enabledMap = readJson(path.join(configDir(), 'config.json'))?.plugins || {}
  const installed = []
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const pdir = path.join(dir, e.name)
      const manifest = readJson(path.join(pdir, 'plugin.json')) || {}
      const ver = readJson(path.join(pdir, 'installed_version.json'))
      installed.push({
        name: manifest.name || e.name,
        version: manifest.version || ver?.version || null,
        description: manifest.description || '',
        path: pdir,
        enabled: enabledMap[pdir]?.enabled ?? enabledMap[e.name]?.enabled ?? true,
        skills: skillsIn(path.join(pdir, 'skills'), 'plugin').length,
      })
    }
  } catch {}
  return { installed, marketplaces: [], rootDir }
}

export function inventory(scope, base, rootDir) {
  if (scope === 'project') {
    return {
      scope,
      base,
      skills: skillsIn(path.join(base, '.agents', 'skills'), 'project'),
      mcpServers: mcpFrom(path.join(base, '.agents', 'mcp_config.json'), 'project'),
      agentsMd: readText(path.join(base, 'AGENTS.md')),
      geminiMd: readText(path.join(base, 'GEMINI.md')),
      readOnly: true,
    }
  }
  const skills = [...skillsIn(path.join(rootDir, 'builtin', 'skills'), 'builtin'), ...skillsIn(path.join(HOME, '.gemini', 'skills'), 'user')]
  const mcpServers = [...mcpFrom(path.join(configDir(), 'mcp_config.json'), 'user')]
  try {
    for (const e of fs.readdirSync(path.join(configDir(), 'plugins'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const pdir = path.join(configDir(), 'plugins', e.name)
      skills.push(...skillsIn(path.join(pdir, 'skills'), `plugin:${e.name}`))
      mcpServers.push(...mcpFrom(path.join(pdir, 'mcp_config.json'), `plugin:${e.name}`))
    }
  } catch {}
  return {
    scope,
    base: rootDir,
    skills,
    mcpServers,
    agentsMd: null,
    geminiMd: readText(path.join(HOME, '.gemini', 'GEMINI.md')),
    settings: readJson(path.join(rootDir, 'settings.json')),
    permissions: readJson(path.join(configDir(), 'config.json'))?.userSettings?.globalPermissionGrants || null,
    readOnly: true,
  }
}
