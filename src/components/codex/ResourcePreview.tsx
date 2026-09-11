import type { CodexResources, ResourceSelection } from '../../api/models.ts'
export interface ResourceContext {
  data: CodexResources
  sel: ResourceSelection | null
  pendingDel: string | null
  setPendingDel: (value: string | null) => void
  openForm: (kind: string, initial?: string) => void
  isProject: boolean
  del: (kind: string, name: string) => unknown
}
import Markdown from '../shared/Markdown.tsx'

export const DOCS = {
  agent: 'https://developers.openai.com/codex/subagents',
  skill: 'https://developers.openai.com/codex/skills',
  hook: 'https://developers.openai.com/codex/hooks',
  mcp: 'https://developers.openai.com/codex/mcp',
  config: 'https://developers.openai.com/codex/config-reference',
  agentsMd: 'https://developers.openai.com/codex/guides/agents-md',
}

const SANDBOX_COLOR: Record<string, string> = { 'read-only': 'text-emerald-300', 'workspace-write': 'text-amber-300', 'danger-full-access': 'text-red-300' }

export function GroupHead({ label, count, docs, children }: React.PropsWithChildren<{ label: string; count?: number; docs?: string }>) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
        {label}
        <span className={`text-[10px] normal-case px-1 rounded ${count ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-600'}`}>{count}</span>
        {docs && (
          <a
            href={docs}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-zinc-600 hover:text-sky-400 normal-case"
            title="Codex docs"
          >
            ↗
          </a>
        )}
      </span>
      <span className="flex gap-2.5">{children}</span>
    </div>
  )
}

export function Item({
  active,
  dot = true,
  title,
  subtitle,
  onClick,
}: {
  active?: boolean
  dot?: boolean
  title: string
  subtitle?: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 hover:bg-ink-700/50 flex items-start gap-2 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />}
      <span className="min-w-0">
        <span className="block text-[12.5px] text-zinc-200 truncate font-mono">{title}</span>
        {subtitle && <span className="block text-[10.5px] text-zinc-500 truncate">{subtitle}</span>}
      </span>
    </button>
  )
}

function Chip({ label, value }: { label: string; value?: unknown }) {
  if (value == null || value === '') return null
  return (
    <span className="inline-flex items-center gap-1 text-[12px] rounded bg-ink-700 border border-zinc-700 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-200">{String(value)}</span>
    </span>
  )
}

function PaneHead({ title, docs, children }: React.PropsWithChildren<{ title: string; docs?: string }>) {
  return (
    <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800">
      <span className="text-[13px] font-mono text-zinc-200 truncate">{title}</span>
      {docs && (
        <a href={docs} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400" title="Codex docs">
          docs ↗
        </a>
      )}
      <div className="flex-1" />
      {children}
    </div>
  )
}

export function NewBtn({
  kind,
  initial,
  label = '+ new',
  openForm,
}: {
  openForm: ResourceContext['openForm']
  kind: string
  initial?: string
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        openForm(kind, initial)
      }}
      className="text-[11px] text-emerald-300 hover:text-emerald-200"
    >
      {label}
    </button>
  )
}

const delKey = (kind: string, name: string) => `${kind}:${name}`

// Inline delete confirm: Delete → delete? yes / no.
function DelBtn({ kind, name, ctx }: { kind: string; name: string; ctx: ResourceContext }) {
  const { pendingDel, setPendingDel, del } = ctx
  const key = delKey(kind, name)
  if (pendingDel === key)
    return (
      <span className="flex items-center gap-1">
        <span className="text-[11px] text-red-300">delete?</span>
        <button type="button" onClick={() => del(kind, name)} className="text-[12px] px-2 py-1 rounded bg-red-500/30 text-red-200">
          yes
        </button>
        <button type="button" onClick={() => setPendingDel(null)} className="text-[12px] px-2 py-1 rounded bg-ink-600 text-zinc-300">
          no
        </button>
      </span>
    )
  return (
    <button
      type="button"
      onClick={() => setPendingDel(key)}
      className="text-[12px] px-3 py-1 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20"
      title="Delete"
    >
      Delete
    </button>
  )
}

export function ResourcePreview({ ctx }: { ctx: ResourceContext }) {
  const { data, sel, pendingDel, setPendingDel, openForm, isProject, del } = ctx

  if (!sel) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-6">
        Select an item to preview it, or use <span className="text-emerald-300">&nbsp;+ new&nbsp;</span> /{' '}
        <span className="text-sky-300">&nbsp;↓ install&nbsp;</span> to add configuration at {isProject ? 'project' : 'user'} scope.
      </div>
    )
  }
  if (sel.kind === 'agentsMd') {
    return (
      <>
        <PaneHead title={data.agentsMd?.name || 'AGENTS.md'} docs={DOCS.agentsMd}>
          <button
            type="button"
            onClick={() => openForm('agentsMd', data.agentsMd?.content || '')}
            className="text-[12px] px-3 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
          >
            {data.agentsMd ? 'Edit' : 'Create'}
          </button>
        </PaneHead>
        <div className="flex-1 overflow-y-auto p-4">
          {data.agentsMd ? <Markdown>{data.agentsMd.content}</Markdown> : <div className="text-zinc-600 text-sm">No AGENTS.md at this scope yet.</div>}
        </div>
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
              {Object.entries(data.summary).map(([k, v]) => (
                <Chip key={k} label={k} value={v} />
              ))}
              {Object.entries(data.agentLimits).map(([k, v]) => (
                <Chip key={k} label={`agents.${k}`} value={v} />
              ))}
              {Object.entries(data.features).map(([k, v]) => (
                <Chip key={k} label={`feat.${k}`} value={v} />
              ))}
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
        <PaneHead title="Hooks" docs={DOCS.hook}>
          <NewBtn openForm={openForm} kind="hook" />
        </PaneHead>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {data.hooks.length ? (
            <div className="flex flex-wrap gap-1.5">
              {data.hooks.map((h) => (
                <span
                  key={h}
                  className="text-[11px] font-mono px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 inline-flex items-center gap-1.5"
                >
                  {h}
                  {pendingDel === delKey('hook', h) ? (
                    <span className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => del('hook', h)} className="text-red-200 bg-red-500/30 rounded px-1.5" title="confirm">
                        delete? yes
                      </button>
                      <button type="button" onClick={() => setPendingDel(null)} className="text-zinc-300 bg-ink-600 rounded px-1.5" title="cancel">
                        no
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDel(delKey('hook', h))}
                      className="text-red-400/70 hover:text-red-300"
                      title={`remove all ${h} hooks`}
                    >
                      ✕
                    </button>
                  )}
                </span>
              ))}
            </div>
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
        <PaneHead title={`agents/${a.file}`} docs={DOCS.agent}>
          <DelBtn ctx={ctx} kind="agent" name={a.name} />
        </PaneHead>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[15px] font-medium text-violet-300">⤷ {a.name}</span>
            {a.model && <Chip label="model" value={a.model} />}
            {a.sandbox && <span className={`text-[12px] ${SANDBOX_COLOR[a.sandbox] || 'text-zinc-400'}`}>{a.sandbox}</span>}
            {a.effort && <Chip label="effort" value={a.effort} />}
          </div>
          {a.description && <p className="text-[13px] text-zinc-300">{a.description}</p>}
          <div className="text-[11px] text-zinc-600">
            defined in{' '}
            <span className="font-mono">
              {isProject ? '.codex/' : ''}agents/{a.file}
            </span>{' '}
            — edit it in your editor to change instructions.
          </div>
        </div>
      </>
    )
  }
  if (sel.kind === 'mcp') {
    const m = data.mcpServers.find((x) => x.id === sel.id)
    if (!m) return null
    return (
      <>
        <PaneHead title={`mcp_servers.${m.id}`} docs={DOCS.mcp}>
          <DelBtn ctx={ctx} kind="mcp" name={m.id} />
        </PaneHead>
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
        <PaneHead title={s.name} docs={DOCS.skill}>
          {s.system ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">system</span>
          ) : (
            <DelBtn ctx={ctx} kind="skill" name={s.name} />
          )}
        </PaneHead>
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
        <PaneHead title={r.name}>
          <DelBtn ctx={ctx} kind="rule" name={r.name} />
        </PaneHead>
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words">{r.content}</pre>
        </div>
      </>
    )
  }
  return null
}
