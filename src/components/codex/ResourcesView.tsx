import type { CodexResources, ResourceSelection, ResourceScopeProps } from '../../api/models.ts'
import { errorMessage } from '../../lib/errors.ts'
import { useDeleteResource } from '../../api/index.ts'
import { ResourcePreview, DOCS, GroupHead, Item, NewBtn } from './ResourcePreview.tsx'
import { useEffect, useState } from 'react'
import { useProviderApi, useResources, useProviderId, useProviderLabel } from '../../api/index.ts'
import HandoffDialog, { HandoffButton } from '../shared/HandoffDialog.tsx'
import NewResourceForm from './NewResourceForm.tsx'
import SkillImport from './SkillImport.tsx'

export default function ResourcesView({ root, scope = 'user', slug }: ResourceScopeProps) {
  const api = useProviderApi()
  const write = useDeleteResource(api.provider)
  const providerId = useProviderId()
  const providerLabel = useProviderLabel()
  const [sel, setSel] = useState<ResourceSelection | null>(null) // { kind, id? }
  const [handoff, setHandoff] = useState(false) // AI hand-off dialog for the current selection
  const [form, setForm] = useState<{ kind: string; initial?: string } | null>(null) // { kind, initial }
  const [importing, setImporting] = useState(false)
  const [pendingDel, setPendingDel] = useState<string | null>(null) // `${kind}:${name}` awaiting inline confirm
  const [delErr, setDelErr] = useState<string | null>(null) // non-fatal delete error (doesn't blank the pane)

  const projectMissing = scope === 'project' && !slug?.startsWith('/')
  const openForm = (kind: string, initial?: string) => setForm({ kind, initial })

  const {
    data,
    error: failure,
    refetch,
  } = useResources<CodexResources>({ provider: api.provider, root: root || '', scope, slug }, { enabled: !projectMissing })
  const error = failure?.message

  // drop a pending delete-confirm / error when the selection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: Selection identity resets the pending confirmation and error even though their reset does not read the selection.
  useEffect(() => {
    setPendingDel(null)
    setDelErr(null)
  }, [sel])

  if (projectMissing) {
    return (
      <div className="h-full flex items-center justify-center text-center text-zinc-600 text-sm px-6">
        Open a project on the left to view & configure its project-scoped <span className="font-mono">&nbsp;.codex/</span>
      </div>
    )
  }
  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading…</div>

  const isProject = scope === 'project'
  // Delete a resource. skill/agent/rule are trashed (recoverable); mcp/hook are
  // stripped from their host config file. Clears the selection if it was showing
  // the deleted item, then refetches.
  const del = async (kind: string, name: string) => {
    try {
      await write.mutateAsync({ ref: { root, scope, slug, kind, name } })
      if (sel?.kind === kind && sel?.id === name) setSel(null)
      setPendingDel(null)
      setDelErr(null)
      refetch()
    } catch (e) {
      setPendingDel(null)
      setDelErr(errorMessage(e))
    }
  }
  const is = (kind: string, id?: string) => sel?.kind === kind && sel?.id === id

  // what the hand-off brief says about the current selection (kind, file, content, docs)
  const handoffContext = () => {
    const base = data.codexDir
    if (sel?.kind === 'agentsMd')
      return { kind: 'AGENTS.md (instructions)', filePath: `${base}/AGENTS.md`, content: data.agentsMd?.content || '', docs: DOCS.agentsMd }
    if (sel?.kind === 'config')
      return { kind: 'config.toml (settings, model, MCP servers)', filePath: `${base}/config.toml`, content: data.configToml || '', docs: DOCS.config }
    if (sel?.kind === 'hooks') return { kind: 'lifecycle hooks', filePath: `${base}/hooks.json`, content: null, docs: DOCS.hook }
    if (sel?.kind === 'mcp')
      return { kind: `MCP server "${sel.id}" in config.toml`, filePath: `${base}/config.toml`, content: data.configToml || '', docs: DOCS.mcp }
    if (sel?.kind === 'skill')
      return {
        kind: `skill "${sel.id}"`,
        filePath: `${base}/skills/${sel.id}/SKILL.md`,
        content: data.skills.find((x) => x.name === sel.id)?.content || '',
        docs: DOCS.skill,
      }
    if (sel?.kind === 'agent')
      return {
        kind: `custom agent "${sel.id}"`,
        filePath: `${base}/agents/${data.agents.find((x) => x.name === sel.id)?.file || sel.id}`,
        content: null,
        docs: DOCS.agent,
      }
    if (sel?.kind === 'rule')
      return {
        kind: `rule "${sel.id}"`,
        filePath: `${base}/rules/${sel.id}`,
        content: data.rules.find((x) => x.name === sel.id)?.content || '',
        docs: DOCS.config,
      }
    return { kind: `${isProject ? 'project' : 'user'}-scope ${providerLabel} configuration`, filePath: base, content: null, docs: DOCS.config }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 text-[12px] flex items-center gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isProject ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
          {isProject ? 'PROJECT scope' : 'USER scope'}
        </span>
        <span className="text-zinc-500 font-mono truncate">{data.codexDir}</span>
        <span className="flex-1" />
        <HandoffButton onClick={() => setHandoff(true)} label={`Ask ${providerLabel}`} />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ---- left list ---- */}
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
          <GroupHead label="Instructions" count={data.agentsMd ? 1 : 0} docs={DOCS.agentsMd}>
            <NewBtn openForm={openForm} kind="agentsMd" initial={data.agentsMd?.content || ''} label={data.agentsMd ? 'edit' : '+ new'} />
          </GroupHead>
          <Item active={is('agentsMd')} dot={!!data.agentsMd} title="AGENTS.md" onClick={() => setSel({ kind: 'agentsMd' })} />
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Custom agents" count={data.agents.length} docs={DOCS.agent}>
            <NewBtn openForm={openForm} kind="agent" />
          </GroupHead>
          {data.agents.map((a) => (
            <Item key={a.file} active={is('agent', a.name)} title={a.name} subtitle={a.description} onClick={() => setSel({ kind: 'agent', id: a.name })} />
          ))}
          {!data.agents.length && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — tap + new</div>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Skills" count={data.skills.length} docs={DOCS.skill}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setImporting(true)
              }}
              className="text-[11px] text-sky-300 hover:text-sky-200"
              title="Install from skills.sh / GitHub"
            >
              ↓ install
            </button>
            <NewBtn openForm={openForm} kind="skill" />
          </GroupHead>
          {data.skills.map((s) => (
            <Item
              key={s.name}
              active={is('skill', s.name)}
              title={s.name}
              subtitle={s.system ? 'system' : s.description}
              onClick={() => setSel({ kind: 'skill', id: s.name })}
            />
          ))}
          {!data.skills.length && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — + new / ↓ install</div>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Hooks" count={data.hooks.length} docs={DOCS.hook}>
            <NewBtn openForm={openForm} kind="hook" />
          </GroupHead>
          <Item
            active={is('hooks')}
            dot={data.hooks.length > 0}
            title={data.hooks.length ? data.hooks.join(', ') : 'no hooks'}
            onClick={() => setSel({ kind: 'hooks' })}
          />

          {data.rules.length > 0 && (
            <>
              <div className="border-b border-zinc-800/60" />
              <GroupHead label="Rules" count={data.rules.length} />
              {data.rules.map((r) => (
                <Item key={r.name} active={is('rule', r.name)} title={r.name} onClick={() => setSel({ kind: 'rule', id: r.name })} />
              ))}
            </>
          )}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="MCP servers" count={data.mcpServers.length} docs={DOCS.mcp}>
            <NewBtn openForm={openForm} kind="mcp" />
          </GroupHead>
          {data.mcpServers.map((m) => (
            <Item key={m.id} active={is('mcp', m.id)} title={m.id} subtitle={m.transport} onClick={() => setSel({ kind: 'mcp', id: m.id })} />
          ))}
          {!data.mcpServers.length && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — tap + new</div>}
          <div className="border-b border-zinc-800/60" />

          <GroupHead label="Settings" count={data.configToml ? 1 : 0} docs={DOCS.config} />
          <Item
            active={is('config')}
            dot={!!data.configToml}
            title="config.toml"
            subtitle={data.summary.model ? `model ${data.summary.model}` : null}
            onClick={() => setSel({ kind: 'config' })}
          />
        </div>

        {/* ---- right preview ---- */}
        <div className="flex-1 flex flex-col min-w-0">
          {delErr && (
            <div className="m-2 shrink-0 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 flex justify-between">
              <span>Delete failed: {delErr}</span>
              <button type="button" onClick={() => setDelErr(null)} className="text-red-400">
                ×
              </button>
            </div>
          )}
          <ResourcePreview ctx={{ data, sel, pendingDel, setPendingDel, openForm, isProject, del }} />
        </div>
      </div>

      {form && (
        <NewResourceForm kind={form.kind} initial={form.initial} scope={scope} root={root} slug={slug} onClose={() => setForm(null)} onSaved={refetch} />
      )}
      {handoff && (
        <HandoffDialog
          api={api}
          providerId={providerId}
          providerLabel={providerLabel}
          root={root}
          cwd={isProject ? slug : null}
          context={handoffContext()}
          onClose={() => setHandoff(false)}
        />
      )}
      {importing && <SkillImport root={root} scope={scope} slug={slug} onClose={() => setImporting(false)} onImported={() => refetch()} />}
    </div>
  )
}
