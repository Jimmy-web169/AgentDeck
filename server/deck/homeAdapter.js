// Provider boundary for Home. A future provider may implement this contract
// directly; the aggregation service never inspects provider-native files.
export function createHomeAdapter(dispatch, { statsNote = '', resourceStyle = 'scoped' } = {}) {
  const get = async (endpoint, params) => {
    const result = await dispatch('GET', `/api/${endpoint}`, new URLSearchParams(params))
    if (result.status !== 200) throw Object.assign(new Error(result.body?.error || 'Source unavailable'), { status: result.status })
    return result.body
  }
  const scopeParams = (source) => ({ root: source.root, home: '1', ...(!source.allProjects ? { slugs: JSON.stringify(source.projects.map((p) => p.slug)), cwds: JSON.stringify(source.projects.map((p) => p.cwd).filter(Boolean)) } : {}) })
  return {
    statsNote,
    stats: (source) => get('stats', scopeParams(source)),
    insights: (source) => get('activity', scopeParams(source)),
    history: (source) => get('history', scopeParams(source)),
    plugins: (source) => get('plugins', { root: source.root }),
    resources: async (source, project) => {
      const data = await get('resources', { root: source.root, ...(project ? { slug: project.slug, ...(resourceStyle === 'scoped' ? { scope: 'project' } : {}) } : resourceStyle === 'scoped' ? { scope: 'user' } : {}) })
      const items = []
      for (const [key, label] of Object.entries({ agents: 'Agents', skills: 'Skills', commands: 'Commands', workflows: 'Workflows', rules: 'Rules', 'output-styles': 'Output styles', mcpServers: 'MCP servers', hooks: 'Hooks' })) {
        if (Array.isArray(data[key])) items.push({ label, names: data[key].map((x) => typeof x === 'string' ? x : x.name || x.event || x.id || x.scope || label) })
      }
      const files = []
      for (const [key, label] of Object.entries({ claudeMd: 'CLAUDE.md', agentsMd: 'AGENTS.md', geminiMd: 'GEMINI.md', mcpJson: '.mcp.json', settingsJson: 'settings.json', settingsLocalJson: 'settings.local.json', configToml: 'config.toml', hasHooksJson: 'hooks.json' })) {
        if (data[key] != null && data[key] !== false) files.push(label)
      }
      if (files.length) items.unshift({ label: 'Files', names: files })
      return { items, readOnly: data.readOnly === true, base: data.base || null }
    },
  }
}
