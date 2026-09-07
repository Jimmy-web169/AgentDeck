import { useEffect, useState } from 'react'
import { useProviderApi } from '../../lib/providerApi.js'
import Markdown from '../shared/Markdown.jsx'

// Read-only inventory of what configures agy: skills (built-in / user /
// plugin / workspace), MCP servers, trusted workspaces, permission grants and
// the GEMINI.md / AGENTS.md instructions. agy's own commands (`agy plugin …`,
// `agy mcp …`) are the writers; this view only shows what they wrote.

const DOCS = {
  skill: 'https://antigravity.google/docs/cli/skills',
  mcp: 'https://antigravity.google/docs/cli/mcp',
  settings: 'https://antigravity.google/docs/cli/settings',
  agentsMd: 'https://antigravity.google/docs/cli/agents-md',
}

function Section({ title, count, docs, children }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-ink-900/40">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800/60">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</span>
        {count != null && <span className={`text-[10px] px-1 rounded ${count ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-600'}`}>{count}</span>}
        {docs && <a href={docs} target="_blank" rel="noreferrer" className="text-zinc-600 hover:text-sky-400" title="Antigravity docs">↗</a>}
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  )
}

const Empty = ({ children }) => <div className="text-[12px] text-zinc-600 py-1">{children}</div>

function Skills({ list }) {
  if (!list.length) return <Empty>No skills here.</Empty>
  return (
    <div className="divide-y divide-zinc-800/50">
      {list.map((s) => (
        <div key={`${s.source}/${s.name}`} className="py-1.5 flex items-start gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 font-mono shrink-0 mt-0.5">{s.source}</span>
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 font-mono">{m.scope}</span>
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-100">{scope === 'project' ? 'Workspace config' : 'Antigravity config'}</h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            Read-only — <span className="font-mono">agy plugin …</span> / <span className="font-mono">agy mcp …</span> and the files under <span className="font-mono">{data.base}</span> are the writers.
          </p>
        </div>
        <Section title="Skills" count={data.skills?.length || 0} docs={DOCS.skill}><Skills list={data.skills || []} /></Section>
        <Section title="MCP servers" count={data.mcpServers?.length || 0} docs={DOCS.mcp}><Mcp list={data.mcpServers || []} /></Section>
        {scope === 'user' && (
          <Section title="Trusted workspaces" count={trustedList.length} docs={DOCS.settings}>
            {trustedList.length ? trustedList.map((w) => <div key={w} className="text-[12px] font-mono text-zinc-300 truncate py-0.5">{w}</div>) : <Empty>none yet — agy asks on first use of a folder.</Empty>}
          </Section>
        )}
        {scope === 'user' && <Section title="Permission grants" docs={DOCS.settings}><Json value={data.permissions} /></Section>}
        {(data.geminiMd || scope === 'user') && (
          <Section title="GEMINI.md" docs={DOCS.agentsMd}>{data.geminiMd ? <div className="text-[13px]"><Markdown>{data.geminiMd}</Markdown></div> : <Empty>no GEMINI.md</Empty>}</Section>
        )}
        {scope === 'project' && (
          <Section title="AGENTS.md" docs={DOCS.agentsMd}>{data.agentsMd ? <div className="text-[13px]"><Markdown>{data.agentsMd}</Markdown></div> : <Empty>no AGENTS.md in this workspace</Empty>}</Section>
        )}
      </div>
    </div>
  )
}
