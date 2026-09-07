import { useEffect, useState } from 'react'
import { useProviderApi } from '../../lib/providerApi.js'
import Markdown from '../shared/Markdown.jsx'
import ReadOnlyNote from '../shared/ReadOnlyNote.jsx'

// Read-only inventory of what configures agy: skills, MCP servers, hooks,
// rules, plugins, settings, permission grants and the GEMINI.md / AGENTS.md
// instructions. agy's own commands (`agy mcp …`, `agy plugin …`, the /config
// overlay) are the writers; this view only shows what they wrote.

export const DOCS = {
  overview: 'https://antigravity.google/docs/cli/overview',
  skill: 'https://antigravity.google/docs/skills',
  mcp: 'https://antigravity.google/docs/mcp',
  plugin: 'https://antigravity.google/docs/plugins',
  hooks: 'https://antigravity.google/docs/hooks',
  rules: 'https://antigravity.google/docs/rules-workflows',
  settings: 'https://antigravity.google/docs/cli/settings',
  permissions: 'https://antigravity.google/docs/cli/permissions',
  projects: 'https://antigravity.google/docs/cli/projects',
}

const WHY = 'agy writes these itself — `agy mcp …`, `agy plugin …`, the /config overlay and the files under .agents/ or ~/.gemini/config. AgentDeck reads them and never edits them.'

const SOURCE_LABEL = { builtin: 'built-in', cli: 'agy home', shared: '~/.gemini/config', legacy: '~/.gemini/skills', workspace: 'workspace' }
const sourceLabel = (s) => SOURCE_LABEL[s] || (s.startsWith('plugin:') ? `plugin · ${s.slice(7)}` : s)

function Section({ title, count, docs, children }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-ink-900/40">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800/60">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</span>
        {count != null && <span className={`text-[10px] px-1 rounded ${count ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-600'}`}>{count}</span>}
        {docs && <a href={docs} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-600 hover:text-sky-400 normal-case" title="Antigravity docs">docs ↗</a>}
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  )
}

const Empty = ({ children }) => <div className="text-[12px] text-zinc-600 py-1">{children}</div>
const Tag = ({ children }) => <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 font-mono shrink-0">{children}</span>

function Skills({ list }) {
  if (!list.length) return <Empty>No skills here.</Empty>
  return (
    <div className="divide-y divide-zinc-800/50">
      {list.map((s) => (
        <div key={`${s.source}/${s.dir}`} className="py-1.5 flex items-start gap-2">
          <Tag>{sourceLabel(s.source)}</Tag>
          <span className="min-w-0">
            <span className="block text-[12.5px] text-zinc-200 font-mono truncate" title={s.dir}>{s.name}</span>
            {s.description && <span className="block text-[11px] text-zinc-500">{s.description}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function Mcp({ list }) {
  if (!list.length) return <Empty>No MCP servers configured.</Empty>
  return (
    <div className="divide-y divide-zinc-800/50">
      {list.map((m) => (
        <div key={`${m.scope}/${m.name}`} className="py-1.5">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-zinc-200 font-mono">{m.name}</span>
            <Tag>{sourceLabel(m.scope)}</Tag>
            <span className="text-[10px] text-zinc-500">{m.transport}</span>
            {!m.enabled && <span className="text-[10px] text-amber-300">disabled</span>}
          </div>
          <div className="text-[11px] text-zinc-500 font-mono truncate" title={m.sourcePath}>
            {m.url || [m.command, ...(m.args || [])].filter(Boolean).join(' ')}
          </div>
          {m.toolDeny?.length > 0 && <div className="text-[10.5px] text-zinc-600">tools off: {m.toolDeny.join(', ')}</div>}
        </div>
      ))}
    </div>
  )
}

function Hooks({ list }) {
  if (!list.length) return <Empty>No hooks.json.</Empty>
  return (
    <div className="divide-y divide-zinc-800/50">
      {list.map((h) => (
        <div key={h.sourcePath} className="py-1.5">
          <div className="flex items-center gap-2 text-[12px]">
            <Tag>{sourceLabel(h.scope)}</Tag>
            <span className="text-zinc-500 font-mono truncate" title={h.sourcePath}>{h.sourcePath}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {h.events.length ? h.events.map((e) => <span key={e.event} className="text-[10.5px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 font-mono">{e.event} · {e.handlers}</span>) : <span className="text-[11px] text-zinc-600">no events wired</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Rules({ list }) {
  const [open, setOpen] = useState(null)
  if (!list.length) return <Empty>No rules files.</Empty>
  return (
    <div className="divide-y divide-zinc-800/50">
      {list.map((r) => (
        <div key={r.path} className="py-1.5">
          <button onClick={() => setOpen((o) => (o === r.path ? null : r.path))} className="w-full text-left flex items-center gap-2 text-[12.5px] hover:text-white">
            <Tag>{sourceLabel(r.scope)}</Tag>
            <span className="text-zinc-200 font-mono truncate" title={r.path}>{r.name}</span>
            <span className="ml-auto text-[10.5px] text-zinc-600">{open === r.path ? 'hide' : 'show'}</span>
          </button>
          {open === r.path && <div className="mt-1.5 text-[13px] border-l-2 border-zinc-800 pl-3"><Markdown>{r.text || ''}</Markdown></div>}
        </div>
      ))}
    </div>
  )
}

function Plugins({ list }) {
  if (!list.length) return <Empty>No plugins here.</Empty>
  return (
    <div className="divide-y divide-zinc-800/50">
      {list.map((p) => (
        <div key={p.path} className="py-1.5">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-zinc-200 font-medium truncate">{p.name}</span>
            {p.version && <span className="text-[10.5px] text-zinc-600 font-mono">v{p.version}</span>}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>{p.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div className="text-[10.5px] text-zinc-600 font-mono truncate" title={p.path}>{p.path}</div>
          <div className="text-[11px] text-zinc-500">{[p.skills && `${p.skills} skills`, p.mcpServers && `${p.mcpServers} MCP`, p.rules && `${p.rules} rules`, p.hooks && 'hooks'].filter(Boolean).join(' · ') || 'empty'}</div>
        </div>
      ))}
    </div>
  )
}

function Json({ value }) {
  if (value == null) return <Empty>none</Empty>
  return <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-all max-h-72 overflow-y-auto">{JSON.stringify(value, null, 2)}</pre>
}

export default function ResourcesView({ root, scope = 'user', slug }) {
  const api = useProviderApi()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!root || (scope === 'project' && !slug)) return
    setData(null)
    setError(null)
    api.resources(root, scope, slug).then(setData).catch((e) => setError(e.message))
  }, [root, scope, slug])

  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading…</div>
  const trusted = data.settings?.trustedWorkspaces
  const trustedList = Array.isArray(trusted) ? trusted : trusted && typeof trusted === 'object' ? Object.keys(trusted) : []
  const project = scope === 'project'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-100 flex items-center gap-2">
            {project ? 'Workspace config' : 'Antigravity config'}
            <ReadOnlyNote why={WHY} />
          </h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            {project ? (
              <>What this workspace adds for agy — <span className="font-mono">{data.configDir}</span>, plus AGENTS.md / GEMINI.md at its root.</>
            ) : (
              <>Shared across Antigravity surfaces under <span className="font-mono">{data.configDir}</span>; the CLI's own settings and skills under <span className="font-mono">{data.base}</span>.</>
            )}{' '}
            <a href={DOCS.overview} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">Antigravity CLI docs ↗</a>
          </p>
        </div>
        <Section title="Skills" count={data.skills?.length || 0} docs={DOCS.skill}><Skills list={data.skills || []} /></Section>
        <Section title="MCP servers" count={data.mcpServers?.length || 0} docs={DOCS.mcp}><Mcp list={data.mcpServers || []} /></Section>
        <Section title="Plugins" count={data.plugins?.length || 0} docs={DOCS.plugin}><Plugins list={data.plugins || []} /></Section>
        <Section title="Hooks" count={data.hooks?.length || 0} docs={DOCS.hooks}><Hooks list={data.hooks || []} /></Section>
        <Section title="Rules" count={data.rules?.length || 0} docs={DOCS.rules}><Rules list={data.rules || []} /></Section>
        {!project && (
          <Section title="Trusted workspaces" count={trustedList.length} docs={DOCS.projects}>
            {trustedList.length ? trustedList.map((w) => <div key={w} className="text-[12px] font-mono text-zinc-300 truncate py-0.5">{w}</div>) : <Empty>none yet — agy asks on first use of a folder.</Empty>}
          </Section>
        )}
        {!project && <Section title="Permission grants" docs={DOCS.permissions}><Json value={data.permissions} /></Section>}
        <Section title={project ? 'Workspace settings' : 'Settings'} docs={DOCS.settings}>
          <Json value={project ? data.settings : { ...(data.sharedSettings || {}), ...(data.settings || {}) }} />
        </Section>
        <Section title="GEMINI.md" docs={DOCS.rules}>{data.geminiMd ? <div className="text-[13px]"><Markdown>{data.geminiMd}</Markdown></div> : <Empty>no GEMINI.md{project ? ' in this workspace' : ' in ~/.gemini'}</Empty>}</Section>
        {project && <Section title="AGENTS.md" docs={DOCS.rules}>{data.agentsMd ? <div className="text-[13px]"><Markdown>{data.agentsMd}</Markdown></div> : <Empty>no AGENTS.md in this workspace</Empty>}</Section>}
      </div>
    </div>
  )
}
