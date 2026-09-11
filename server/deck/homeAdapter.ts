import type { makeDispatch } from '../shared/dispatch.ts'
import { jsonRecord } from '../shared/json.ts'
// Provider boundary for Home. A future provider may implement this contract
// directly; the aggregation service never inspects provider-native files.
export type HomeSource = { root: string } & (
  | { allProjects: true; projects?: { slug: string; cwd?: string | null }[] }
  | { allProjects?: false; projects: { slug: string; cwd?: string | null }[] }
)
type ActivitySession = NonNullable<Parameters<typeof import('../shared/activity.ts').bucketActivity>[0]>[number]
export interface HomeActivityRecord extends ActivitySession {
  id: string
  slug: string
  isSubagent?: boolean
  oversized?: boolean
}
export interface HomeProjectStats extends Record<string, unknown> {
  slug: string
  cwd?: string | null
  sessions?: number
  tokens?: Record<string, number | null>
}
export interface HomeHistoryRow {
  rowId: string
  display: unknown
  project?: string | null
  ts?: string | number | null
  [field: string]: unknown
}
export interface ProviderHomeData extends Record<string, unknown> {
  tokens?: Record<string, number | null>
  incomplete?: unknown[]
  coverage?: { readError?: unknown; unattributed?: number; malformed?: number }
  projects?: HomeProjectStats[]
  fields?: { common: string[]; specific: string[] }
  records?: HomeActivityRecord[]
  history?: HomeHistoryRow[]
}
export function createHomeAdapter(dispatch: ReturnType<typeof makeDispatch>, { statsNote = '', resourceStyle = 'scoped' } = {}) {
  const get = async (endpoint: string, params: Record<string, string>): Promise<ProviderHomeData> => {
    const result = await dispatch('GET', `/api/${endpoint}`, new URLSearchParams(params))
    if (result.status !== 200) throw Object.assign(new Error(String(jsonRecord(result.body).error || 'Source unavailable')), { status: result.status })
    // AgentDeck-owned normalized provider replies, not provider-native JSON.
    return result.body as ProviderHomeData
  }
  const scopeParams = (source: HomeSource) => ({
    root: source.root,
    home: '1',
    ...(!source.allProjects
      ? { slugs: JSON.stringify(source.projects.map((p) => p.slug)), cwds: JSON.stringify(source.projects.map((p) => p.cwd).filter(Boolean)) }
      : {}),
  })
  return {
    statsNote,
    stats: (source: HomeSource) => get('stats', scopeParams(source)),
    insights: (source: HomeSource) => get('activity', scopeParams(source)),
    history: (source: HomeSource) => get('history', scopeParams(source)),
    plugins: (source: HomeSource) => get('plugins', { root: source.root }),
    resources: async (source: HomeSource, project?: { slug: string } | null) => {
      const data = await get('resources', {
        root: source.root,
        ...(project
          ? { slug: project.slug, ...(resourceStyle === 'scoped' ? { scope: 'project' } : {}) }
          : resourceStyle === 'scoped'
            ? { scope: 'user' }
            : {}),
      })
      const items: { label: string; names: unknown[] }[] = []
      for (const [key, label] of Object.entries({
        agents: 'Agents',
        skills: 'Skills',
        commands: 'Commands',
        workflows: 'Workflows',
        rules: 'Rules',
        'output-styles': 'Output styles',
        mcpServers: 'MCP servers',
        hooks: 'Hooks',
      })) {
        const rows = data[key]
        if (Array.isArray(rows))
          items.push({
            label,
            names: rows.map((x: unknown) => {
              if (typeof x === 'string') return x
              const item = jsonRecord(x)
              return item.name || item.event || item.id || item.scope || label
            }),
          })
      }
      const files = []
      for (const [key, label] of Object.entries({
        claudeMd: 'CLAUDE.md',
        agentsMd: 'AGENTS.md',
        geminiMd: 'GEMINI.md',
        mcpJson: '.mcp.json',
        settingsJson: 'settings.json',
        settingsLocalJson: 'settings.local.json',
        configToml: 'config.toml',
        hasHooksJson: 'hooks.json',
      })) {
        if (data[key] != null && data[key] !== false) files.push(label)
      }
      if (files.length) items.unshift({ label: 'Files', names: files })
      return { items, readOnly: data.readOnly === true, base: data.base || null }
    },
  }
}
