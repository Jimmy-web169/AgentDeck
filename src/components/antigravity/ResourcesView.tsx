import type { AntigravityResources, ResourceSelection, ResourceScopeProps } from '../../api/models.ts'
import { ResourcePreview, DOCS, WHY, sourceLabel, GroupHead, Item, Empty } from './ResourcePreview.tsx'
import { useState } from 'react'
import { useProviderApi, useResources } from '../../api/index.ts'
import ReadOnlyNote from '../shared/ReadOnlyNote.tsx'
import HandoffDialog, { HandoffButton } from '../shared/HandoffDialog.tsx'

// What configures agy, in the same two-pane shape as the Codex and Claude Code
// Config views: a grouped list on the left (instructions, skills, plugins,
// hooks, rules, MCP servers, settings), the selected item on the right, a docs
// link on every group. Read-only — agy's own commands (`agy mcp …`,
// `agy plugin …`, the /config overlay) and the files under .agents/ or
// ~/.gemini/config are the writers.

export default function ResourcesView({ root, scope = 'user', slug }: ResourceScopeProps) {
  const api = useProviderApi()
  const [sel, setSel] = useState<ResourceSelection | null>(null) // { kind, id? }
  const [handoff, setHandoff] = useState(false)

  const projectMissing = scope === 'project' && !slug
  const { data, error: failure } = useResources<AntigravityResources>({ provider: api.provider, root: root || '', scope, slug }, { enabled: !projectMissing })
  const error = failure?.message

  if (projectMissing) {
    return (
      <div className="h-full flex items-center justify-center text-center text-zinc-600 text-sm px-6">
        Open a project on the left to view its workspace config (<span className="font-mono">&nbsp;.agents/</span>)
      </div>
    )
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
  const is = (kind: string, id?: string) => sel?.kind === kind && sel?.id === id

  // what the hand-off brief says about the current selection; agy edits its own files
  const handoffContext = () => {
    const wd = data.configDir
    if (sel?.kind === 'geminiMd')
      return {
        kind: 'GEMINI.md (instructions)',
        filePath: isProject ? `${data.base}/GEMINI.md` : '~/.gemini/GEMINI.md',
        content: data.geminiMd || '',
        docs: DOCS.rules,
      }
    if (sel?.kind === 'agentsMd')
      return { kind: 'AGENTS.md (instructions)', filePath: `${data.base}/AGENTS.md`, content: data.agentsMd || '', docs: DOCS.rules }
    if (sel?.kind === 'skill') {
      const s = skills.find((x) => x.dir === sel.id)
      return { kind: `skill "${s?.name || ''}"`, filePath: `${sel.id}/SKILL.md`, content: s?.content || '', docs: DOCS.skill }
    }
    if (sel?.kind === 'plugin') return { kind: 'plugin', filePath: sel.id, content: null, docs: DOCS.plugin }
    if (sel?.kind === 'hooks') return { kind: 'hooks.json', filePath: sel.id, content: null, docs: DOCS.hooks }
    if (sel?.kind === 'rule') {
      const r = rules.find((x) => x.path === sel.id)
      return { kind: `rule "${r?.name || ''}"`, filePath: sel.id, content: r?.text || '', docs: DOCS.rules }
    }
    if (sel?.kind === 'mcp') {
      const m = mcp.find((x) => `${x.scope}/${x.name}` === sel.id)
      return { kind: `MCP server "${m?.name || ''}" (mcp_config.json)`, filePath: m?.sourcePath || `${wd}/mcp_config.json`, content: null, docs: DOCS.mcp }
    }
    if (sel?.kind === 'settings')
      return {
        kind: 'settings.json',
        filePath: isProject ? `${wd}/settings.json` : `${data.base}/settings.json`,
        content: JSON.stringify(data.settings || {}, null, 2),
        docs: DOCS.settings,
      }
    return { kind: `${isProject ? 'workspace' : 'user'}-scope Antigravity configuration`, filePath: wd, content: null, docs: DOCS.overview }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 text-[12px] flex items-center gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isProject ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
          {isProject ? 'WORKSPACE scope' : 'USER scope'}
        </span>
        <span className="text-zinc-500 font-mono truncate">{data.configDir}</span>
        <ReadOnlyNote why={WHY} />
        <span className="flex-1" />
        <HandoffButton onClick={() => setHandoff(true)} label="Ask agy" />
        <a href={DOCS.overview} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400 shrink-0">
          Antigravity CLI docs ↗
        </a>
      </div>
      {handoff && (
        <HandoffDialog
          api={api}
          providerId="antigravity"
          providerLabel="Antigravity"
          root={root}
          cwd={isProject ? slug : null}
          context={handoffContext()}
          onClose={() => setHandoff(false)}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {/* ---- left list ---- */}
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
          <GroupHead label="Instructions" count={(data.geminiMd ? 1 : 0) + (data.agentsMd ? 1 : 0)} docs={DOCS.rules} />
          <Item
            active={is('geminiMd')}
            dot={!!data.geminiMd}
            title="GEMINI.md"
            subtitle={isProject ? 'workspace root' : '~/.gemini'}
            onClick={() => setSel({ kind: 'geminiMd' })}
          />
          {isProject && (
            <Item active={is('agentsMd')} dot={!!data.agentsMd} title="AGENTS.md" subtitle="workspace root" onClick={() => setSel({ kind: 'agentsMd' })} />
          )}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Skills" count={skills.length} docs={DOCS.skill} />
          {skills.map((s) => (
            <Item
              key={s.dir}
              active={is('skill', s.dir)}
              title={s.name}
              subtitle={`${sourceLabel(s.source)}${s.description ? ` · ${s.description}` : ''}`}
              onClick={() => setSel({ kind: 'skill', id: s.dir })}
            />
          ))}
          {!skills.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Plugins" count={plugins.length} docs={DOCS.plugin} />
          {plugins.map((p) => (
            <Item
              key={p.path}
              active={is('plugin', p.path)}
              title={p.name}
              subtitle={`${p.enabled ? 'enabled' : 'disabled'}${p.version ? ` · v${p.version}` : ''}${p.skills ? ` · ${p.skills} skills` : ''}`}
              onClick={() => setSel({ kind: 'plugin', id: p.path })}
            />
          ))}
          {!plugins.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Hooks" count={hooks.length} docs={DOCS.hooks} />
          {hooks.map((h) => (
            <Item
              key={h.sourcePath}
              active={is('hooks', h.sourcePath)}
              title="hooks.json"
              subtitle={`${sourceLabel(h.scope)} · ${h.events.length} event${h.events.length === 1 ? '' : 's'}`}
              onClick={() => setSel({ kind: 'hooks', id: h.sourcePath })}
            />
          ))}
          {!hooks.length && <Empty>no hooks.json</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Rules" count={rules.length} docs={DOCS.rules} />
          {rules.map((r) => (
            <Item
              key={r.path}
              active={is('rule', r.path)}
              title={r.name}
              subtitle={sourceLabel(r.scope)}
              onClick={() => setSel({ kind: 'rule', id: r.path })}
            />
          ))}
          {!rules.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="MCP servers" count={mcp.length} docs={DOCS.mcp} />
          {mcp.map((m) => (
            <Item
              key={`${m.scope}/${m.name}`}
              active={is('mcp', `${m.scope}/${m.name}`)}
              title={m.name}
              subtitle={`${sourceLabel(m.scope)} · ${m.transport}${m.enabled ? '' : ' · disabled'}`}
              onClick={() => setSel({ kind: 'mcp', id: `${m.scope}/${m.name}` })}
            />
          ))}
          {!mcp.length && <Empty>none at this scope</Empty>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Settings" count={settingsCount} docs={DOCS.settings} />
          <Item
            active={is('settings')}
            dot={!!(data.settings || data.sharedSettings)}
            title={isProject ? '.agents/settings.json' : 'settings.json'}
            subtitle={!isProject && trustedList.length ? `${trustedList.length} trusted workspace${trustedList.length === 1 ? '' : 's'}` : null}
            onClick={() => setSel({ kind: 'settings' })}
          />
          {!isProject && <Item active={is('keybindings')} dot={!!data.keybindings} title="keybindings.json" onClick={() => setSel({ kind: 'keybindings' })} />}
          {!isProject && (
            <>
              <div className="border-b border-zinc-800/60" />
              <GroupHead label="Access" docs={DOCS.permissions} />
              <Item
                active={is('trusted')}
                dot={trustedList.length > 0}
                title="Trusted workspaces"
                subtitle={trustedList.length ? `${trustedList.length}` : 'none yet'}
                onClick={() => setSel({ kind: 'trusted' })}
              />
              <Item active={is('permissions')} dot={!!data.permissions} title="Permission grants" onClick={() => setSel({ kind: 'permissions' })} />
            </>
          )}
        </div>

        {/* ---- right preview ---- */}
        <div className="flex-1 flex flex-col min-w-0">
          <ResourcePreview ctx={{ data, sel, isProject, skills, plugins, hooks, rules, mcp, trustedList }} />
        </div>
      </div>
    </div>
  )
}
