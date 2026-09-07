import { useEffect, useMemo, useState } from 'react'
import { createApi } from '../../api.js'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { HOME_VIEWS, homeViewLabel } from '../../lib/tabs.js'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { togglePin, usePins } from '../../lib/pins.js'
import useActiveSessions, { toManagerItems } from '../../lib/useActiveSessions.js'
import { ActivityIcon } from './icons.jsx'
import { PinIcon, SearchIcon, TerminalIcon } from './shellIcons.jsx'
import { ShortcutChips } from './ShortcutHints.jsx'
import ScopeMenu from './ScopeMenu.jsx'
import { RootsEditor } from './RootsManager.jsx'

// Home — the logo page. A left rail of pages:
//   Overview   cross-provider: live terminals, pinned items, recent projects
//   Stats / History / Memory / Plugins / Resources
//              per tracked folder; the scope menu (provider · folder) picks which
//   Folders    manage tracked folders for every provider
// The page + scope live on the tab's target ({ view, scope, focus }) so a Home
// tab remembers where it was, like any other tab.

const SCOPE_KEY = 'agentdeck_home_scope'
const PAGE_SIZE = 18

function ProviderBadge({ providers, id }) {
  const label = providerLabel(providers, id)
  const c = providerColor(providers, id)
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-zinc-800 bg-ink-800 ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {label}
    </span>
  )
}

function Section({ title, count, right, children }) {
  return (
    <div className="mb-9">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</span>
        {count != null && <span className="text-[11px] text-zinc-600">· {count}</span>}
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  )
}

function EmptyCard({ children }) {
  return <div className="text-[13px] text-zinc-600 bg-ink-900 border border-zinc-800 rounded-lg px-4 py-6 text-center">{children}</div>
}

function Overview({ providers, visible, index, live, onOpen }) {
  const active = useActiveSessions(providers, { enabled: visible })
  const liveItems = toManagerItems(active)
  const pins = usePins()
  const [ended, setEnded] = useState(() => new Set())
  const [copied, setCopied] = useState(null)
  const [page, setPage] = useState(0)
  const [versions, setVersions] = useState({})

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    ;(async () => {
      const vmap = {}
      await Promise.all(
        providers.map(async (p) => {
          const root = (index.roots[p.id] || []).find((r) => r.exists !== false)
          if (!root) return
          try {
            const v = await fetch(`/api/${p.id}/version?root=${encodeURIComponent(root.id)}`).then((x) => x.json())
            vmap[p.id] = v?.version || null
          } catch {}
        })
      )
      if (!cancelled) setVersions(vmap)
    })()
    return () => {
      cancelled = true
    }
  }, [providers, visible, index.roots])

  const copyAttach = (name) => {
    navigator.clipboard
      ?.writeText(`tmux attach -t ${name}`)
      .then(() => {
        setCopied(name)
        setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500)
      })
      .catch(() => {})
  }
  const endItem = (it) => {
    if (!it.key || !it.provider) return
    setEnded((prev) => new Set(prev).add(it.key))
    fetch(`/api/${it.provider}/terminal?key=${encodeURIComponent(it.key)}`, { method: 'DELETE' }).catch(() => {})
  }
  const shownLive = liveItems.filter((it) => !ended.has(it.key))

  const recent = index.projects
  const pageCount = Math.max(1, Math.ceil(recent.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = recent.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-[11px] uppercase tracking-wide text-zinc-600">tracked</span>
        {providers.map((p) => (
          <span key={p.id} title={versions[p.id] ? `${p.label} ${versions[p.id]} (from the latest tracked session)` : `${p.label} — no tracked session yet`} className={`text-[11px] px-2 py-0.5 rounded border ${p.accent}`}>
            {p.label} {versions[p.id] ? `v${versions[p.id]}` : '—'}
          </span>
        ))}
        <span className="flex-1" />
        <ShortcutChips />
      </div>

      <Section title="Live now" count={`${shownLive.length} running terminal${shownLive.length === 1 ? '' : 's'}`}>
        {shownLive.length === 0 ? (
          <EmptyCard>
            No running terminals. Open a session and press <span className="text-zinc-400">Open terminal</span> — it stays here until you End it or close its tab.
          </EmptyCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shownLive.map((it) => (
              <div key={it.key} className="bg-ink-900 border border-zinc-800 rounded-lg px-3 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <ProviderBadge providers={providers} id={it.provider} />
                  <TerminalIcon className="w-3.5 h-3.5 text-zinc-600" />
                  <span className={`ml-auto w-1.5 h-1.5 rounded-full ${it.attached ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} title={it.attached ? 'attached' : 'detached (running in background)'} />
                  <span className="text-[10px] text-zinc-600">{it.attached ? 'attached' : 'detached'}</span>
                </div>
                <div className="text-[13px] text-zinc-200 truncate" title={it.cwd || it.slug || ''}>{it.title}</div>
                {it.tmuxName && (
                  <button onClick={() => copyAttach(it.tmuxName)} title="Copy — attach this session from any terminal" className="flex items-center gap-1 text-[10.5px] font-mono text-zinc-600 hover:text-sky-300 max-w-full">
                    <span className="shrink-0">{copied === it.tmuxName ? '✓ copied' : '⧉'}</span>
                    <span className="truncate">tmux attach -t {it.tmuxName}</span>
                  </button>
                )}
                <div className="flex gap-2 mt-auto pt-1">
                  <button onClick={() => onOpen(it.provider, { root: it.root, slug: it.slug, id: it.id, cwd: it.cwd, title: it.title, kind: 'tmux', draft: !it.id })} className="text-[12px] px-2.5 py-1 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30">
                    Open
                  </button>
                  <button onClick={() => endItem(it)} className="text-[12px] px-2.5 py-1 rounded bg-red-500/15 text-red-200 hover:bg-red-500/25">
                    End
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Pinned" count={pins.length}>
        {pins.length === 0 ? (
          <EmptyCard>
            Nothing pinned yet. Hover a project or session in the sidebar (or a row in Ctrl+K) and press the pin.
          </EmptyCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pins.map((p) => {
              const isLive = p.id && live?.ids?.has(liveSessionKey(p.provider, p.root, p.id))
              return (
                <div key={`${p.provider}|${p.root}|${p.slug}|${p.id || ''}`} className="group text-left bg-ink-900 border border-zinc-800 rounded-lg px-3 py-3 hover:border-zinc-600 hover:bg-ink-800 transition-colors relative">
                  <button onClick={() => onOpen(p.provider, { root: p.root, rootLabel: p.rootLabel, slug: p.slug, id: p.id, title: p.title, project: p.project, cwd: p.cwd })} className="w-full text-left">
                    <div className="flex items-center gap-2 mb-1.5">
                      <ProviderBadge providers={providers} id={p.provider} />
                      {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                      <span className="ml-auto text-[10.5px] text-zinc-600">{p.rootLabel}</span>
                    </div>
                    <div className="text-[13px] text-zinc-200 truncate">{p.id ? p.title || p.id.slice(0, 8) : p.project || p.slug}</div>
                    <div className="text-[11px] text-zinc-500 truncate">{p.id ? p.project || '' : shortPath(p.cwd || p.slug)}</div>
                  </button>
                  <button onClick={() => togglePin(p)} title="Unpin" className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center text-amber-300 opacity-0 group-hover:opacity-100 hover:bg-ink-700">
                    <PinIcon className="w-3.5 h-3.5" filled />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Recent projects" count={recent.length} right={index.loading ? <span className="text-[11px] text-zinc-600">refreshing…</span> : null}>
        {recent.length === 0 ? (
          <EmptyCard>{index.loading ? 'Loading…' : 'No projects yet. Track a folder under Folders.'}</EmptyCard>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {paged.map((p) => (
                <button
                  key={`${p.provider}:${p.root}:${p.slug}`}
                  onClick={() => onOpen(p.provider, { root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name })}
                  className="text-left bg-ink-900 border border-zinc-800 rounded-lg px-3 py-3 hover:border-zinc-600 hover:bg-ink-800 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <ProviderBadge providers={providers} id={p.provider} />
                    <span className="ml-auto text-[10.5px] text-zinc-600">{fmtRelative(p.lastActivity)}</span>
                  </div>
                  <div className="text-[13px] text-zinc-200 truncate" title={p.cwd || p.slug}>{p.name}</div>
                  <div className="text-[11px] text-zinc-500 truncate">{p.rootLabel} · {p.path}</div>
                </button>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 text-[12px]">
                <button disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="px-2.5 py-1 rounded bg-ink-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed">‹ Prev</button>
                <span className="text-zinc-500">{safePage + 1} / {pageCount}</span>
                <button disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="px-2.5 py-1 rounded bg-ink-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed">Next ›</button>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  )
}

function Folders({ providers, index }) {
  const apis = useMemo(() => Object.fromEntries(providers.map((p) => [p.id, createApi(p.id)])), [providers])
  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-8">
      {providers.map((p) => (
        <div key={p.id}>
          <div className="flex items-center gap-2 mb-3">
            <ProviderBadge providers={providers} id={p.id} />
            <span className="text-[13px] text-zinc-300">tracked folders</span>
          </div>
          <RootsEditor
            roots={index.roots[p.id] || []}
            apiClient={apis[p.id]}
            rootStatusField={p.rootStatusField || 'hasProjects'}
            pathPlaceholder={p.id === 'codex' ? '/path/to/.codex  or  ~/.codex' : '/path/to/.claude  or  ~/my-project'}
            onChanged={() => index.refresh(true)}
          />
        </div>
      ))}
    </div>
  )
}

export default function HomeView({ providers = [], visible = true, target, index, live, onOpen, onNavigate, onSearch }) {
  const view = target?.view || 'overview'
  const scopes = index.scopes
  // scope: the tab's, else the last one used, else the first tracked folder
  const scope = useMemo(() => {
    const pick = (s) => s && scopes.find((x) => x.provider === s.provider && x.root === s.root)
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null')
    } catch {}
    return pick(target?.scope) || pick(saved) || scopes[0] || null
  }, [target?.scope, scopes])

  const setScope = (s) => {
    try {
      localStorage.setItem(SCOPE_KEY, JSON.stringify({ provider: s.provider, root: s.root }))
    } catch {}
    onNavigate({ scope: { provider: s.provider, root: s.root }, focus: null })
  }

  const providerCfg = scope ? providers.find((p) => p.id === scope.provider) : null
  const Page = providerCfg?.homePages?.[view]
  const scoped = view !== 'overview' && view !== 'folders'

  return (
    <div className="h-full flex bg-ink-950">
      <nav className="w-44 shrink-0 border-r border-zinc-800 bg-ink-900 flex flex-col">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-800">
          <span className="text-emerald-400"><ActivityIcon className="w-5 h-5" /></span>
          <span className="text-[14px] font-semibold tracking-tight text-zinc-100">AgentDeck</span>
        </div>
        <div className="p-2 flex flex-col gap-0.5">
          {HOME_VIEWS.map((v) => (
            <button
              key={v.k}
              onClick={() => onNavigate({ view: v.k, focus: null })}
              className={`text-left px-3 py-1.5 rounded-md text-[13px] ${view === v.k ? 'bg-ink-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-800'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="mt-auto p-3 text-[10.5px] text-zinc-600">v2 · terminal mode</div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800 bg-ink-900/70">
          <span className="text-[13px] font-medium text-zinc-100">{homeViewLabel(view)}</span>
          {scoped && scope && <span className="text-[12px] text-zinc-600">· {providerLabel(providers, scope.provider)} · {scope.rootLabel}</span>}
          <span className="flex-1" />
          {scoped && <ScopeMenu compact align="right" className="w-[280px]" scopes={scopes} providers={providers} value={scope} onChange={setScope} onManage={() => onNavigate({ view: 'folders' })} />}
          <button onClick={onSearch} title="Search projects & sessions  (Ctrl+K)" className="flex items-center gap-2 h-8 px-3 rounded-md bg-ink-800 border border-zinc-700 text-[12px] text-zinc-300 hover:text-zinc-100 hover:bg-ink-700">
            <SearchIcon className="w-3.5 h-3.5" />
            Jump to…
            <kbd className="text-[10px] px-1 py-px rounded bg-ink-700 text-zinc-500 border border-zinc-800">Ctrl K</kbd>
          </button>
        </div>

        {view === 'overview' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Overview providers={providers} visible={visible} index={index} live={live} onOpen={onOpen} />
          </div>
        )}
        {view === 'folders' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Folders providers={providers} index={index} />
          </div>
        )}
        {scoped && !scope && (
          <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">No tracked folders yet — add one under Folders.</div>
        )}
        {scoped && scope && Page && (
          <div key={`${view}|${scope.provider}|${scope.root}`} className={view === 'resources' ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-y-auto'}>
            <Page root={scope.root} focus={target?.focus || null} onOpen={(t) => onOpen(scope.provider, { rootLabel: scope.rootLabel, ...t })} />
          </div>
        )}
        {scoped && scope && !Page && <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">This provider has no {homeViewLabel(view)} page.</div>}
      </div>
    </div>
  )
}
