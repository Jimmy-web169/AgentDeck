import { useEffect, useState } from 'react'
import { useProviderApi } from '../../lib/providerApi.js'
import Markdown from '../shared/Markdown.jsx'
import ReadOnlyNote from '../shared/ReadOnlyNote.jsx'

// What configures agy, in the same two-pane shape as the Codex and Claude Code
// Config views: a grouped list on the left (instructions, skills, plugins,
// hooks, rules, MCP servers, settings), the selected item on the right, a docs
// link on every group. Read-only — agy's own commands (`agy mcp …`,
// `agy plugin …`, the /config overlay) and the files under .agents/ or
// ~/.gemini/config are the writers.

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
const sourceLabel = (s) => SOURCE_LABEL[s] || (s?.startsWith('plugin:') ? `plugin · ${s.slice(7)}` : s || '')

// ---- the same building blocks the Codex view uses ----
function GroupHead({ label, count, docs }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
        {label}
        {count != null && <span className={`text-[10px] normal-case px-1 rounded ${count ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-600'}`}>{count}</span>}
        {docs && (
          <a href={docs} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-zinc-600 hover:text-sky-400 normal-case" title="Antigravity docs">↗</a>
        )}
      </span>
    </div>
  )
}

function Item({ active, dot = true, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-1.5 hover:bg-ink-700/50 flex items-start gap-2 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 mt-1.5" />}
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
      <span className="font-mono text-zinc-200 break-all">{String(value)}</span>
    </span>
  )
}

function PaneHead({ title, docs, children }) {
  return (
    <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800">
      <span className="text-[13px] font-mono text-zinc-200 truncate">{title}</span>
      {docs && <a href={docs} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400" title="Antigravity docs">docs ↗</a>}
      <div className="flex-1" />
      {children}
    </div>
  )
}

const Pre = ({ children }) => <pre className="text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words bg-ink-900 rounded-lg p-3">{children}</pre>
const Json = ({ value }) => (value == null ? <div className="text-zinc-600 text-sm">Not present at this scope.</div> : <Pre>{JSON.stringify(value, null, 2)}</Pre>)
const Empty = ({ children }) => <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">{children}</div>
const Where = ({ path: p }) => <div className="text-[11px] text-zinc-600">on disk: <span className="font-mono break-all">{p}</span></div>

export default function ResourcesView({ root, scope = 'user', slug }) {
  const api = useProviderApi()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null) // { kind, id? }

  const projectMissing = scope === 'project' && !slug
  useEffect(() => {
    if (!root || projectMissing) {
      setData(null)
      return
    }
    setError(null)
    api.resources(root, scope, slug).then(setData).catch((e) => setError(e.message))
  }, [root, scope, slug, projectMissing])

  if (projectMissing) {
    return <div className="h-full flex items-center justify-center text-center text-zinc-600 text-sm px-6">Open a project on the left to view its workspace config (<span className="font-mono">&nbsp;.agents/</span>)</div>
  }
  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading…</div>

  const isProject = scope === 'project'
  const skills = data.skills || []
  const plugins = data.plugins || []
  const hooks = data.hooks || []
  const rules = data.rules || []
  const mcp = data.mcpServers || []
  const trusted = data.settings?.trustedWorkspaces
  const trustedList = Array.isArray(trusted) ? trusted : trusted && typeof trusted === 'object' ? Object.keys(trusted) : []
  const settingsCount = [data.settings, data.sharedSettings, data.keybindings].filter(Boolean).length
  const is = (kind, id) => sel?.kind === kind && sel?.id === id

  // ---- right pane for the current selection ----
  const renderPreview = () => {
    if (!sel) {
      return (
        <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-6">
          Select an item to preview it. This is what agy reads at {isProject ? 'workspace' : 'user'} scope; change it with agy's own commands or by editing the files.
        </div>
      )
    }
    if (sel.kind === 'geminiMd' || sel.kind === 'agentsMd') {
      const text = sel.kind === 'geminiMd' ? data.geminiMd : data.agentsMd
      const name = sel.kind === 'geminiMd' ? 'GEMINI.md' : 'AGENTS.md'
      return (
        <>
          <PaneHead title={name} docs={DOCS.rules} />
          <div className="flex-1 overflow-y-auto p-4">{text ? <Markdown>{text}</Markdown> : <div className="text-zinc-600 text-sm">No {name} at this scope.</div>}</div>
        </>
      )
    }
    if (sel.kind === 'skill') {
      const s = skills.find((x) => x.dir === sel.id)
      if (!s) return null
      return (
        <>
          <PaneHead title={s.name} docs={DOCS.skill}><span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(s.source)}</span></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {s.description && <div className="text-[12px] text-zinc-500">{s.description}</div>}
            {s.content ? <Markdown>{s.content}</Markdown> : <div className="text-zinc-600 text-sm">Empty SKILL.md.</div>}
            <Where path={`${s.dir}/SKILL.md`} />
          </div>
        </>
      )
    }
    if (sel.kind === 'plugin') {
      const p = plugins.find((x) => x.path === sel.id)
      if (!p) return null
      return (
        <>
          <PaneHead title={p.name} docs={DOCS.plugin}>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>{p.enabled ? 'enabled' : 'disabled'}</span>
          </PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              {p.version && <Chip label="version" value={p.version} />}
              <Chip label="scope" value={p.scope} />
              <Chip label="skills" value={p.skills} />
              <Chip label="MCP servers" value={p.mcpServers} />
              <Chip label="rules" value={p.rules} />
              {p.hooks && <Chip label="hooks" value="hooks.json" />}
            </div>
            {p.description && <p className="text-[13px] text-zinc-300">{p.description}</p>}
            <div className="text-[11px] text-zinc-600">Its skills, MCP servers and rules are listed in their own groups tagged <span className="font-mono">plugin · {p.name}</span>.</div>
            <Where path={p.path} />
          </div>
        </>
      )
    }
    if (sel.kind === 'hooks') {
      const h = hooks.find((x) => x.sourcePath === sel.id)
      if (!h) return null
      return (
        <>
          <PaneHead title="hooks.json" docs={DOCS.hooks}><span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(h.scope)}</span></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {h.events.length ? (
              <div className="flex flex-wrap gap-1.5">{h.events.map((e) => <span key={e.event} className="text-[11px] font-mono px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300">{e.event} <span className="text-zinc-500">· {e.handlers}</span></span>)}</div>
            ) : (
              <div className="text-zinc-600 text-sm">No events wired in this file.</div>
            )}
            <Where path={h.sourcePath} />
          </div>
        </>
      )
    }
    if (sel.kind === 'rule') {
      const r = rules.find((x) => x.path === sel.id)
      if (!r) return null
      return (
        <>
          <PaneHead title={r.name} docs={DOCS.rules}><span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(r.scope)}</span></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <Markdown>{r.text || ''}</Markdown>
            <Where path={r.path} />
          </div>
        </>
      )
    }
    if (sel.kind === 'mcp') {
      const m = mcp.find((x) => `${x.scope}/${x.name}` === sel.id)
      if (!m) return null
      return (
        <>
          <PaneHead title={`mcpServers.${m.name}`} docs={DOCS.mcp}><span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(m.scope)}</span></PaneHead>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[15px] font-medium text-cyan-300">{m.name}</span>
              <Chip label="transport" value={m.transport} />
              {!m.enabled && <span className="text-[11px] text-amber-300">disabled</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {m.url && <Chip label="serverUrl" value={m.url} />}
              {m.command && <Chip label="command" value={[m.command, ...(m.args || [])].join(' ')} />}
              {m.cwd && <Chip label="cwd" value={m.cwd} />}
              {m.env?.length > 0 && <Chip label="env" value={m.env.join(', ')} />}
              {m.headers?.length > 0 && <Chip label="headers" value={m.headers.join(', ')} />}
              {m.toolDeny?.length > 0 && <Chip label="disabledTools" value={m.toolDeny.join(', ')} />}
            </div>
            <Where path={m.sourcePath} />
          </div>
        </>
      )
    }
    if (sel.kind === 'settings') {
      return (
        <>
          <PaneHead title={isProject ? '.agents/settings.json' : 'settings.json'} docs={DOCS.settings} />
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!isProject && data.sharedSettings && (
              <>
                <div className="text-[11px] text-zinc-500">shared · <span className="font-mono">~/.gemini/config/settings.json</span></div>
                <Json value={data.sharedSettings} />
                <div className="text-[11px] text-zinc-500">CLI · <span className="font-mono">{data.base}/settings.json</span> (sparse — only what differs from the defaults)</div>
              </>
            )}
            <Json value={data.settings} />
          </div>
        </>
      )
    }
    if (sel.kind === 'keybindings') {
      return (
        <>
          <PaneHead title="keybindings.json" docs={DOCS.settings} />
          <div className="flex-1 overflow-y-auto p-4"><Json value={data.keybindings} /></div>
        </>
      )
    }
    if (sel.kind === 'permissions') {
      return (
        <>
          <PaneHead title="Permission grants" docs={DOCS.permissions} />
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-[12px] text-zinc-500">What agy may do without asking, as granted in its permission prompts (<span className="font-mono">~/.gemini/config/config.json</span>).</div>
            <Json value={data.permissions} />
          </div>
        </>
      )
    }
    if (sel.kind === 'trusted') {
      return (
        <>
          <PaneHead title="Trusted workspaces" docs={DOCS.projects} />
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <div className="text-[12px] text-zinc-500">Folders agy may work in without the trust prompt; a print-mode run elsewhere records no workspace and lands under “(no workspace)”.</div>
            {trustedList.length ? trustedList.map((w) => <div key={w} className="text-[12.5px] font-mono text-zinc-300 break-all">{w}</div>) : <div className="text-zinc-600 text-sm">None yet — agy asks on first use of a folder.</div>}
          </div>
        </>
      )
    }
    return null
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 text-[12px] flex items-center gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isProject ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{isProject ? 'WORKSPACE scope' : 'USER scope'}</span>
        <span className="text-zinc-500 font-mono truncate">{data.configDir}</span>
        <ReadOnlyNote why={WHY} />
        <span className="flex-1" />
        <a href={DOCS.overview} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400 shrink-0">Antigravity CLI docs ↗</a>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ---- left list ---- */}
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
          <GroupHead label="Instructions" count={(data.geminiMd ? 1 : 0) + (data.agentsMd ? 1 : 0)} docs={DOCS.rules} />
          <Item active={is('geminiMd')} dot={!!data.geminiMd} title="GEMINI.md" subtitle={isProject ? 'workspace root' : '~/.gemini'} onClick={() => setSel({ kind: 'geminiMd' })} />
          {isProject && <Item active={is('agentsMd')} dot={!!data.agentsMd} title="AGENTS.md" subtitle="workspace root" onClick={() => setSel({ kind: 'agentsMd' })} />}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Skills" count={skills.length} docs={DOCS.skill} />
          {skills.map((s) => <Item key={s.dir} active={is('skill', s.dir)} title={s.name} subtitle={`${sourceLabel(s.source)}${s.description ? ` · ${s.description}` : ''}`} onClick={() => setSel({ kind: 'skill', id: s.dir })} />)}
          {!skills.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Plugins" count={plugins.length} docs={DOCS.plugin} />
          {plugins.map((p) => <Item key={p.path} active={is('plugin', p.path)} title={p.name} subtitle={`${p.enabled ? 'enabled' : 'disabled'}${p.version ? ` · v${p.version}` : ''}${p.skills ? ` · ${p.skills} skills` : ''}`} onClick={() => setSel({ kind: 'plugin', id: p.path })} />)}
          {!plugins.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Hooks" count={hooks.length} docs={DOCS.hooks} />
          {hooks.map((h) => <Item key={h.sourcePath} active={is('hooks', h.sourcePath)} title="hooks.json" subtitle={`${sourceLabel(h.scope)} · ${h.events.length} event${h.events.length === 1 ? '' : 's'}`} onClick={() => setSel({ kind: 'hooks', id: h.sourcePath })} />)}
          {!hooks.length && <Empty>no hooks.json</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Rules" count={rules.length} docs={DOCS.rules} />
          {rules.map((r) => <Item key={r.path} active={is('rule', r.path)} title={r.name} subtitle={sourceLabel(r.scope)} onClick={() => setSel({ kind: 'rule', id: r.path })} />)}
          {!rules.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="MCP servers" count={mcp.length} docs={DOCS.mcp} />
          {mcp.map((m) => <Item key={`${m.scope}/${m.name}`} active={is('mcp', `${m.scope}/${m.name}`)} title={m.name} subtitle={`${sourceLabel(m.scope)} · ${m.transport}${m.enabled ? '' : ' · disabled'}`} onClick={() => setSel({ kind: 'mcp', id: `${m.scope}/${m.name}` })} />)}
          {!mcp.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Settings" count={settingsCount} docs={DOCS.settings} />
          <Item active={is('settings')} dot={!!(data.settings || data.sharedSettings)} title={isProject ? '.agents/settings.json' : 'settings.json'} subtitle={!isProject && trustedList.length ? `${trustedList.length} trusted workspace${trustedList.length === 1 ? '' : 's'}` : null} onClick={() => setSel({ kind: 'settings' })} />
          {!isProject && <Item active={is('keybindings')} dot={!!data.keybindings} title="keybindings.json" onClick={() => setSel({ kind: 'keybindings' })} />}
          {!isProject && (
            <>
              <div className="border-b border-zinc-800/60" />
              <GroupHead label="Access" docs={DOCS.permissions} />
              <Item active={is('trusted')} dot={trustedList.length > 0} title="Trusted workspaces" subtitle={trustedList.length ? `${trustedList.length}` : 'none yet'} onClick={() => setSel({ kind: 'trusted' })} />
              <Item active={is('permissions')} dot={!!data.permissions} title="Permission grants" onClick={() => setSel({ kind: 'permissions' })} />
            </>
          )}
        </div>

        {/* ---- right preview ---- */}
        <div className="flex-1 flex flex-col min-w-0">{renderPreview()}</div>
      </div>
    </div>
  )
}
