import { useEffect, useState } from 'react'
import { codexApi as api } from '../../api.js'
import Markdown from '../shared/Markdown.jsx'
import NewResourceForm from './NewResourceForm.jsx'
import SkillImport from './SkillImport.jsx'

const DOCS = {
  agent: 'https://developers.openai.com/codex/subagents',
  skill: 'https://developers.openai.com/codex/skills',
  hook: 'https://developers.openai.com/codex/hooks',
  mcp: 'https://developers.openai.com/codex/mcp',
  config: 'https://developers.openai.com/codex/config-reference',
  agentsMd: 'https://developers.openai.com/codex/guides/agents-md',
}
const SANDBOX_COLOR = { 'read-only': 'text-emerald-300', 'workspace-write': 'text-amber-300', 'danger-full-access': 'text-red-300' }

// left-pane group header: label, count, a docs ↗ link, and create/import actions
function GroupHead({ label, count, docs, children }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
        {label}
        <span className={`text-[10px] normal-case px-1 rounded ${count ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-600'}`}>{count}</span>
        {docs && (
          <a href={docs} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-zinc-600 hover:text-sky-400 normal-case" title="Codex docs">↗</a>
        )}
      </span>
      <span className="flex gap-2.5">{children}</span>
    </div>
  )
}

function Item({ active, dot = true, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-1.5 hover:bg-ink-700/50 flex items-start gap-2 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />}
      <span className="min-w-0">
        <span className="block text-[12.5px] text-zinc-200 truncate font-mono">{title}</span>
        {subtitle && <span className="block text-[10.5px] text-zinc-500 truncate">{subtitle}</span>}
      </span>
    </button>
  )
}

function Chip({ label, value }) {
  if (value == null || value === '') return null
  return (
    <span className="inline-flex items-center gap-1 text-[12px] rounded bg-ink-700 border border-zinc-700 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-200">{String(value)}</span>
    </span>
  )
}

function PaneHead({ title, docs, children }) {
  return (
    <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800">
      <span className="text-[13px] font-mono text-zinc-200 truncate">{title}</span>
      {docs && <a href={docs} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400" title="Codex docs">docs ↗</a>}
      <div className="flex-1" />
      {children}
    </div>
  )
}

export default function ResourcesView({ root, scope = 'user', slug }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null) // { kind, id? }
  const [form, setForm] = useState(null) // { kind, initial }
  const [importing, setImporting] = useState(false)
  const [reload, setReload] = useState(0)
  const [pendingDel, setPendingDel] = useState(null) // `${kind}:${name}` awaiting inline confirm
  const [delErr, setDelErr] = useState(null) // non-fatal delete error (doesn't blank the pane)

  const projectMissing = scope === 'project' && !(slug && slug.startsWith('/'))
  const openForm = (kind, initial) => setForm({ kind, initial })
  const refetch = () => setReload((n) => n + 1)

  useEffect(() => {
    if (!root || projectMissing) {
      setData(null)
      return
    }
    setError(null)
    api.resources(root, scope, slug).then(setData).catch((e) => setError(e.message))
  }, [root, scope, slug, projectMissing, reload])

  // drop a pending delete-confirm / error when the selection changes
  useEffect(() => {
    setPendingDel(null)
    setDelErr(null)
  }, [sel])

  if (projectMissing) {
    return <div className="h-full flex items-center justify-center text-center text-zinc-600 text-sm px-6">Open a project on the left to view & configure its project-scoped <span className="font-mono">&nbsp;.codex/</span></div>
  }
  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading…</div>

  const isProject = scope === 'project'
  const add = (kind, initial) => (e) => { e.stopPropagation(); openForm(kind, initial) }
  const NewBtn = ({ kind, initial, label = '+ new' }) => <button onClick={add(kind, initial)} className="text-[11px] text-emerald-300 hover:text-emerald-200">{label}</button>

  // Delete a resource. skill/agent/rule are trashed (recoverable); mcp/hook are
  // stripped from their host config file. Clears the selection if it was showing
  // the deleted item, then refetches.
  const del = async (kind, name) => {
    try {
      await api.deleteResource(root, scope, slug, kind, name)
      if (sel?.kind === kind && sel?.id === name) setSel(null)
      setPendingDel(null)
      setDelErr(null)
      refetch()
    } catch (e) {
      setPendingDel(null)
      setDelErr(e.message)
    }
  }
  // Inline delete confirm: Delete → delete? yes / no.
  const DelBtn = ({ kind, name }) => {
    const key = `${kind}:${name}`
    if (pendingDel === key) {
      return (
        <span className="flex items-center gap-1">
          <span className="text-[11px] text-red-300">delete?</span>
          <button onClick={() => del(kind, name)} className="text-[12px] px-2 py-1 rounded bg-red-500/30 text-red-200">yes</button>
          <button onClick={() => setPendingDel(null)} className="text-[12px] px-2 py-1 rounded bg-ink-600 text-zinc-300">no</button>
        </span>
      )
    }
    return <button onClick={() => setPendingDel(key)} className="text-[12px] px-3 py-1 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20" title="Delete">Delete</button>
  }

  // ---- right pane preview for the current selection ----
  const renderPreview = () => {
    if (!sel) {
      return (
        <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-6">
          Select an item to preview it, or use <span className="text-emerald-300">&nbsp;+ new&nbsp;</span> / <span className="text-sky-300">&nbsp;↓ install&nbsp;</span> to add configuration at {isProject ? 'project' : 'user'} scope.
        </div>
      )
    }
    if (sel.kind === 'agentsMd') {
      return (
        <>
          <PaneHead title={data.agentsMd?.name || 'AGENTS.md'} docs={DOCS.agentsMd}>
            <button onClick={() => openForm('agentsMd', data.agentsMd?.content || '')} className="text-[12px] px-3 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30">{data.agentsMd ? 'Edit' : 'Create'}</button>
          </PaneHead>
          <div className="flex-1 overflow-y-auto p-4">{data.agentsMd ? <Markdown>{data.agentsMd.content}</Markdown> : <div className="text-zinc-600 text-sm">No AGENTS.md at this scope yet.</div>}</div>
        </>
      )
    }
    if (sel.kind === 'config') {
      return (
        <>
          <PaneHead title="config.toml" docs={DOCS.config} />
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(Object.values(data.summary).some(Boolean) || Object.keys(data.features).length || Object.keys(data.agentLimits).length) && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.summary).map(([k, v]) => <Chip key={k} label={k} value={v} />)}
                {Object.entries(data.agentLimits).map(([k, v]) => <Chip key={k} label={`agents.${k}`} value={v} />)}
                {Object.entries(data.features).map(([k, v]) => <Chip key={k} label={`feat.${k}`} value={v} />)}
              </div>
            )}
            {data.configToml ? (
              <pre className="text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words bg-ink-900 rounded-lg p-3">{data.configToml}</pre>
            ) : (
              <div className="text-zinc-600 text-sm">No config.toml at this scope.</div>
            )}
          </div>
        </>
      )
    }
    if (sel.kind === 'hooks') {
      return (
        <>
          <PaneHead title="Hooks" docs={DOCS.hook}><NewBtn kind="hook" /></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {data.hooks.length ? (
              <div className="flex flex-wrap gap-1.5">{data.hooks.map((h) => (
                <span key={h} className="text-[11px] font-mono px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 inline-flex items-center gap-1.5">
                  {h}
                  {pendingDel === `hook:${h}` ? (
                    <span className="inline-flex items-center gap-1">
                      <button onClick={() => del('hook', h)} className="text-red-200 bg-red-500/30 rounded px-1.5" title="confirm">delete? yes</button>
                      <button onClick={() => setPendingDel(null)} className="text-zinc-300 bg-ink-600 rounded px-1.5" title="cancel">no</button>
                    </span>
                  ) : (
                    <button onClick={() => setPendingDel(`hook:${h}`)} className="text-red-400/70 hover:text-red-300" title={`remove all ${h} hooks`}>✕</button>
                  )}
                </span>
              ))}</div>
            ) : (
              <div className="text-zinc-600 text-sm">No lifecycle hooks at this scope. Use “+ new” to add one.</div>
            )}
            {data.hasHooksJson && <div className="text-[11px] text-zinc-600">defined in hooks.json</div>}
          </div>
        </>
      )
    }
    if (sel.kind === 'agent') {
      const a = data.agents.find((x) => x.name === sel.id)
      if (!a) return null
      return (
        <>
          <PaneHead title={`agents/${a.file}`} docs={DOCS.agent}><DelBtn kind="agent" name={a.name} /></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[15px] font-medium text-violet-300">⤷ {a.name}</span>
              {a.model && <Chip label="model" value={a.model} />}
              {a.sandbox && <span className={`text-[12px] ${SANDBOX_COLOR[a.sandbox] || 'text-zinc-400'}`}>{a.sandbox}</span>}
              {a.effort && <Chip label="effort" value={a.effort} />}
            </div>
            {a.description && <p className="text-[13px] text-zinc-300">{a.description}</p>}
            <div className="text-[11px] text-zinc-600">defined in <span className="font-mono">{isProject ? '.codex/' : ''}agents/{a.file}</span> — edit it in your editor to change instructions.</div>
          </div>
        </>
      )
    }
    if (sel.kind === 'mcp') {
      const m = data.mcpServers.find((x) => x.id === sel.id)
      if (!m) return null
      return (
        <>
          <PaneHead title={`mcp_servers.${m.id}`} docs={DOCS.mcp}><DelBtn kind="mcp" name={m.id} /></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[15px] font-medium text-cyan-300">{m.id}</span>
              <Chip label="transport" value={m.transport} />
              {!m.enabled && <span className="text-[11px] text-amber-300">disabled</span>}
            </div>
            {m.url && <Chip label="url" value={m.url} />}
            {m.command && <Chip label="command" value={m.command} />}
          </div>
        </>
      )
    }
    if (sel.kind === 'skill') {
      const s = data.skills.find((x) => x.name === sel.id)
      if (!s) return null
      return (
        <>
          <PaneHead title={s.name} docs={DOCS.skill}>{s.system ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">system</span> : <DelBtn kind="skill" name={s.name} />}</PaneHead>
          <div className="flex-1 overflow-y-auto p-4">
            {s.description && <div className="text-[12px] text-zinc-500 mb-3">{s.description}</div>}
            <Markdown>{s.content}</Markdown>
          </div>
        </>
      )
    }
    if (sel.kind === 'rule') {
      const r = data.rules.find((x) => x.name === sel.id)
      if (!r) return null
      return (
        <>
          <PaneHead title={r.name}><DelBtn kind="rule" name={r.name} /></PaneHead>
          <div className="flex-1 overflow-y-auto p-4"><pre className="text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words">{r.content}</pre></div>
        </>
      )
    }
    return null
  }

  const is = (kind, id) => sel?.kind === kind && sel?.id === id

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 text-[12px] flex items-center gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isProject ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{isProject ? 'PROJECT scope' : 'USER scope'}</span>
        <span className="text-zinc-500 font-mono truncate">{data.codexDir}</span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ---- left list ---- */}
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
          <GroupHead label="Instructions" count={data.agentsMd ? 1 : 0} docs={DOCS.agentsMd}><NewBtn kind="agentsMd" initial={data.agentsMd?.content || ''} label={data.agentsMd ? 'edit' : '+ new'} /></GroupHead>
          <Item active={is('agentsMd')} dot={!!data.agentsMd} title="AGENTS.md" onClick={() => setSel({ kind: 'agentsMd' })} />
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Custom agents" count={data.agents.length} docs={DOCS.agent}><NewBtn kind="agent" /></GroupHead>
          {data.agents.map((a) => <Item key={a.file} active={is('agent', a.name)} title={a.name} subtitle={a.description} onClick={() => setSel({ kind: 'agent', id: a.name })} />)}
          {!data.agents.length && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — tap + new</div>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Skills" count={data.skills.length} docs={DOCS.skill}>
            <button onClick={(e) => { e.stopPropagation(); setImporting(true) }} className="text-[11px] text-sky-300 hover:text-sky-200" title="Install from skills.sh / GitHub">↓ install</button>
            <NewBtn kind="skill" />
          </GroupHead>
          {data.skills.map((s) => <Item key={s.name} active={is('skill', s.name)} title={s.name} subtitle={s.system ? 'system' : s.description} onClick={() => setSel({ kind: 'skill', id: s.name })} />)}
          {!data.skills.length && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — + new / ↓ install</div>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Hooks" count={data.hooks.length} docs={DOCS.hook}><NewBtn kind="hook" /></GroupHead>
          <Item active={is('hooks')} dot={data.hooks.length > 0} title={data.hooks.length ? data.hooks.join(', ') : 'no hooks'} onClick={() => setSel({ kind: 'hooks' })} />

          {data.rules.length > 0 && (
            <>
              <div className="border-b border-zinc-800/60" />
              <GroupHead label="Rules" count={data.rules.length} />
              {data.rules.map((r) => <Item key={r.name} active={is('rule', r.name)} title={r.name} onClick={() => setSel({ kind: 'rule', id: r.name })} />)}
            </>
          )}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="MCP servers" count={data.mcpServers.length} docs={DOCS.mcp}><NewBtn kind="mcp" /></GroupHead>
          {data.mcpServers.map((m) => <Item key={m.id} active={is('mcp', m.id)} title={m.id} subtitle={m.transport} onClick={() => setSel({ kind: 'mcp', id: m.id })} />)}
          {!data.mcpServers.length && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — tap + new</div>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Settings" count={data.configToml ? 1 : 0} docs={DOCS.config} />
          <Item active={is('config')} dot={!!data.configToml} title="config.toml" subtitle={data.summary.model ? `model ${data.summary.model}` : null} onClick={() => setSel({ kind: 'config' })} />
        </div>

        {/* ---- right preview ---- */}
        <div className="flex-1 flex flex-col min-w-0">
          {delErr && (
            <div className="m-2 shrink-0 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 flex justify-between">
              <span>Delete failed: {delErr}</span>
              <button onClick={() => setDelErr(null)} className="text-red-400">×</button>
            </div>
          )}
          {renderPreview()}
        </div>
      </div>

      {form && <NewResourceForm kind={form.kind} initial={form.initial} scope={scope} root={root} slug={slug} onClose={() => setForm(null)} onSaved={refetch} />}
      {importing && <SkillImport root={root} scope={scope} slug={slug} onClose={() => setImporting(false)} onImported={refetch} />}
    </div>
  )
}
