import type { AntigravityResources, ResourceSelection } from '../../api/models.ts'
export type ResourceContext = {
  data: AntigravityResources
  sel: ResourceSelection | null
  isProject: boolean
  trustedList: string[]
  skills: AntigravityResources['skills']
  plugins: AntigravityResources['plugins']
  hooks: AntigravityResources['hooks']
  rules: AntigravityResources['rules']
  mcp: AntigravityResources['mcpServers']
}
import Markdown from '../shared/Markdown.tsx'

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

export const WHY =
  'agy writes these itself — `agy mcp …`, `agy plugin …`, the /config overlay and the files under .agents/ or ~/.gemini/config. AgentDeck reads them and never edits them.'

const SOURCE_LABEL: Record<string, string> = {
  builtin: 'built-in',
  cli: 'agy home',
  shared: '~/.gemini/config',
  legacy: '~/.gemini/skills',
  workspace: 'workspace',
}

export const sourceLabel = (s: string | null | undefined) => SOURCE_LABEL[s || ''] || (s?.startsWith('plugin:') ? `plugin · ${s.slice(7)}` : s || '')

// ---- the same building blocks the Codex view uses ----
export function GroupHead({ label, count, docs }: React.PropsWithChildren<{ label: string; count?: number; docs?: string }>) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
        {label}
        {count != null && (
          <span className={`text-[10px] normal-case px-1 rounded ${count ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-600'}`}>{count}</span>
        )}
        {docs && (
          <a
            href={docs}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-zinc-600 hover:text-sky-400 normal-case"
            title="Antigravity docs"
          >
            ↗
          </a>
        )}
      </span>
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
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 mt-1.5" />}
      <span className="min-w-0">
        <span className="block text-[12.5px] text-zinc-200 truncate font-mono">{title}</span>
        {subtitle && <span className="block text-[10.5px] text-zinc-500 truncate">{subtitle}</span>}
      </span>
    </button>
  )
}

export function Chip({ label, value }: { label: string; value?: unknown }) {
  if (value == null || value === '') return null
  return (
    <span className="inline-flex items-center gap-1 text-[12px] rounded bg-ink-700 border border-zinc-700 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-200 break-all">{String(value)}</span>
    </span>
  )
}

function PaneHead({ title, docs, children }: React.PropsWithChildren<{ title: string; docs?: string }>) {
  return (
    <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800">
      <span className="text-[13px] font-mono text-zinc-200 truncate">{title}</span>
      {docs && (
        <a href={docs} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400" title="Antigravity docs">
          docs ↗
        </a>
      )}
      <div className="flex-1" />
      {children}
    </div>
  )
}

export const Pre = ({ children }: React.PropsWithChildren) => (
  <pre className="text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words bg-ink-900 rounded-lg p-3">{children}</pre>
)

export const Json = ({ value }: { value?: unknown }) =>
  value == null ? <div className="text-zinc-600 text-sm">Not present at this scope.</div> : <Pre>{JSON.stringify(value, null, 2)}</Pre>

export const Empty = ({ children }: React.PropsWithChildren) => <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">{children}</div>

export const Where = ({ path: p }: { path?: string | null }) => (
  <div className="text-[11px] text-zinc-600">
    on disk: <span className="font-mono break-all">{p}</span>
  </div>
)

export function ResourcePreview({ ctx }: { ctx: ResourceContext }) {
  const { data, sel, isProject, skills, plugins, hooks, rules, mcp, trustedList } = ctx

  if (!sel) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-6">
        Select an item to preview it. This is what agy reads at {isProject ? 'workspace' : 'user'} scope; change it with agy's own commands or by editing the
        files.
      </div>
    )
  }
  if (sel.kind === 'geminiMd' || sel.kind === 'agentsMd') {
    const text = sel.kind === 'geminiMd' ? data.geminiMd : data.agentsMd
    const name = sel.kind === 'geminiMd' ? 'GEMINI.md' : 'AGENTS.md'
    return (
      <>
        <PaneHead title={name} docs={DOCS.rules} />
        <div className="flex-1 overflow-y-auto p-4">
          {text ? <Markdown>{text}</Markdown> : <div className="text-zinc-600 text-sm">No {name} at this scope.</div>}
        </div>
      </>
    )
  }
  if (sel.kind === 'skill') {
    const s = skills.find((x) => x.dir === sel.id)
    if (!s) return null
    return (
      <>
        <PaneHead title={s.name} docs={DOCS.skill}>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(s.source)}</span>
        </PaneHead>
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
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>
            {p.enabled ? 'enabled' : 'disabled'}
          </span>
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
          <div className="text-[11px] text-zinc-600">
            Its skills, MCP servers and rules are listed in their own groups tagged <span className="font-mono">plugin · {p.name}</span>.
          </div>
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
        <PaneHead title="hooks.json" docs={DOCS.hooks}>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(h.scope)}</span>
        </PaneHead>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {h.events.length ? (
            <div className="flex flex-wrap gap-1.5">
              {h.events.map((e) => (
                <span key={e.event} className="text-[11px] font-mono px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300">
                  {e.event} <span className="text-zinc-500">· {e.handlers}</span>
                </span>
              ))}
            </div>
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
        <PaneHead title={r.name} docs={DOCS.rules}>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(r.scope)}</span>
        </PaneHead>
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
        <PaneHead title={`mcpServers.${m.name}`} docs={DOCS.mcp}>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{sourceLabel(m.scope)}</span>
        </PaneHead>
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
              <div className="text-[11px] text-zinc-500">
                shared · <span className="font-mono">~/.gemini/config/settings.json</span>
              </div>
              <Json value={data.sharedSettings} />
              <div className="text-[11px] text-zinc-500">
                CLI · <span className="font-mono">{data.base}/settings.json</span> (sparse — only what differs from the defaults)
              </div>
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
        <div className="flex-1 overflow-y-auto p-4">
          <Json value={data.keybindings} />
        </div>
      </>
    )
  }
  if (sel.kind === 'permissions') {
    return (
      <>
        <PaneHead title="Permission grants" docs={DOCS.permissions} />
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-[12px] text-zinc-500">
            What agy may do without asking, as granted in its permission prompts (<span className="font-mono">~/.gemini/config/config.json</span>).
          </div>
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
          <div className="text-[12px] text-zinc-500">
            Folders agy may work in without the trust prompt; a print-mode run elsewhere records no workspace and lands under “(no workspace)”.
          </div>
          {trustedList.length ? (
            trustedList.map((w) => (
              <div key={w} className="text-[12.5px] font-mono text-zinc-300 break-all">
                {w}
              </div>
            ))
          ) : (
            <div className="text-zinc-600 text-sm">None yet — agy asks on first use of a folder.</div>
          )}
        </div>
      </>
    )
  }
  return null
}
