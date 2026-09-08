import { useEffect, useMemo, useState } from 'react'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { HOME_VIEWS, homeViewLabel, normalizeView } from '../../lib/tabs.js'
import { providerColor, providerLabel, statusDot, statusText } from '../../lib/providerColors.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { isPinned, togglePin, usePins } from '../../lib/pins.js'
import useActiveSessions, { toManagerItems } from '../../lib/useActiveSessions.js'
import { PinIcon, SearchIcon, TerminalIcon } from './shellIcons.jsx'
import InsightsPage from './InsightsPage.jsx'
import { usePrefs } from '../../lib/prefs.js'
import { ShortcutChips } from './ShortcutHints.jsx'

// Home pages — the main area when a tab points at Home. The page switch is in
// this header (these pages are about the whole deck, not a session, so they
// don't belong in the session sidebar); the provider · folder scope for the
// per-folder pages comes from the shell's sidebar.
//   Activity   what is going on across every provider: running terminals,
//              the latest sessions, pinned items, recent projects, shortcuts
//   Stats / Insights / History / Plugins / Resources   for the sidebar's scope
// Tracked folders are managed in FoldersDialog (the "+" next to the folder
// chips), not on a page of their own.

const RECENT_PROJECTS_SCANNED = 10 // projects whose session lists feed "Latest sessions"
const LATEST_SESSIONS = 14

function ProviderBadge({ providers, id }) {
  const c = providerColor(providers, id)
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-zinc-800 bg-ink-800 ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {providerLabel(providers, id)}
    </span>
  )
}

function Section({ title, count, right, children, className = '' }) {
  return (
    <section className={className}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">{title}</span>
        {count != null && <span className="text-[11px] text-zinc-600">· {count}</span>}
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }) => <div className="text-[12.5px] text-zinc-600 bg-ink-900 border border-zinc-800 rounded-lg px-4 py-5 text-center">{children}</div>
const Panel = ({ children, className = '' }) => <div className={`rounded-lg border border-zinc-800 bg-ink-900 ${className}`}>{children}</div>

// a session row: dot (terminal red › writing yellow › provider), title, first
// prompt, project · folder, time, pin
function SessionRow({ s, providers, live, termKeys, onOpen, showPrompt = true }) {
  const k = liveSessionKey(s.provider, s.root, s.id)
  const term = termKeys?.has(k)
  const writing = live?.ids?.has(k)
  const c = providerColor(providers, s.provider)
  const pinT = { provider: s.provider, root: s.root, rootLabel: s.rootLabel, slug: s.slug, id: s.id, title: s.title, project: s.project, cwd: s.cwd }
  const pinned = isPinned(pinT)
  return (
    <div className="group flex items-start gap-2.5 px-3 py-2 hover:bg-ink-800 border-b border-zinc-800/60 last:border-0">
      <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${term ? statusDot('terminal') : writing ? statusDot('writing') : c.dot}`} />
      <button
        onClick={(e) => onOpen(s.provider, pinT, { newTab: e.ctrlKey || e.metaKey })}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && onOpen(s.provider, pinT, { newTab: true })}
        className="min-w-0 flex-1 text-left"
        title="Open here · Ctrl+click or middle-click opens in a new tab"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] text-zinc-200 truncate">{s.title}</span>
          {term && <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-red-300">terminal</span>}
          <span className="ml-auto shrink-0 text-[10.5px] text-zinc-600">{fmtRelative(s.lastTs)}</span>
        </div>
        {showPrompt && s.firstPrompt && s.firstPrompt !== s.title && <div className="text-[11.5px] text-zinc-500 truncate">{s.firstPrompt}</div>}
        <div className="text-[10.5px] text-zinc-600 truncate">
          <span className={c.text}>{providerLabel(providers, s.provider)}</span> · {s.project} · {s.rootLabel}
        </div>
      </button>
      <button onClick={() => togglePin(pinT)} title={pinned ? 'Unpin' : 'Pin'} className={`shrink-0 mt-0.5 w-6 h-6 rounded flex items-center justify-center hover:bg-ink-700 ${pinned ? 'text-amber-300' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}>
        <PinIcon className="w-3.5 h-3.5" filled={pinned} />
      </button>
    </div>
  )
}

function Activity({ providers, visible, index, live, termKeys, onOpen }) {
  const active = useActiveSessions(providers, { enabled: visible })
  const liveItems = toManagerItems(active)
  const pins = usePins()
  const prefs = usePrefs()
  const [ended, setEnded] = useState(() => new Set())
  const [copied, setCopied] = useState(null)
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

  // latest sessions across providers: the session lists of the most recently
  // active projects, merged and sorted (lists load lazily; rows fill in)
  const scanned = index.projects.slice(0, RECENT_PROJECTS_SCANNED)
  const latest = useMemo(() => {
    if (!visible) return []
    const out = []
    for (const p of scanned) {
      const list = index.sessionsFor(p.provider, p.root, p.slug)
      if (!list) continue
      for (const s of list) out.push({ ...s, rootLabel: p.rootLabel, project: p.name, cwd: p.cwd })
    }
    out.sort((a, b) => String(b.lastTs || '').localeCompare(String(a.lastTs || '')))
    return out.slice(0, LATEST_SESSIONS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index, scanned.map((p) => `${p.provider}|${p.root}|${p.slug}`).join('|')])
  const loadingLatest = visible && scanned.some((p) => index.sessionsFor(p.provider, p.root, p.slug) === null)

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
  const today = Date.now() - 24 * 3600 * 1000
  const activeToday = latest.filter((s) => s.lastTs && new Date(s.lastTs).getTime() > today).length

  return (
    <div className="max-w-6xl mx-auto px-6 py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5 px-3 py-2 rounded-lg border border-zinc-800 bg-ink-900/60">
        <span className="text-[10.5px] uppercase tracking-wide text-zinc-500">Keyboard</span>
        <ShortcutChips />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-7">
        <Section title="Live now" count={`${shownLive.length} running terminal${shownLive.length === 1 ? '' : 's'}`}>
          {shownLive.length === 0 ? (
            <Empty>
              No running terminals. Open a session and press <span className="text-zinc-400">Open terminal</span> — it stays here until you End it or close its tab.
            </Empty>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {shownLive.map((it) => (
                <Panel key={it.key} className="px-3 py-3 flex flex-col gap-2 border-red-500/30">
                  <div className="flex items-center gap-2">
                    <ProviderBadge providers={providers} id={it.provider} />
                    <TerminalIcon className={`w-3.5 h-3.5 ${statusText('terminal')}`} />
                    <span className={`ml-auto w-1.5 h-1.5 rounded-full ${statusDot('terminal')}`} />
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
                    <button onClick={() => onOpen(it.provider, { root: it.root, slug: it.slug, id: it.id, cwd: it.cwd, title: it.title, kind: 'tmux', draft: !it.id })} className="text-[12px] px-2.5 py-1 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30">Open</button>
                    <button onClick={() => endItem(it)} className="text-[12px] px-2.5 py-1 rounded bg-red-500/15 text-red-200 hover:bg-red-500/25">End</button>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </Section>

        <Section title="Latest sessions" count={loadingLatest ? 'loading…' : `${activeToday} active in the last 24h`}>
          {latest.length === 0 ? (
            <Empty>{loadingLatest ? 'Loading…' : 'No sessions yet. Track a folder with the + next to the folder chips.'}</Empty>
          ) : (
            <Panel>
              {latest.map((s) => (
                <SessionRow key={`${s.provider}|${s.root}|${s.id}`} s={s} providers={providers} live={live} termKeys={termKeys} onOpen={onOpen} showPrompt={prefs.showFirstPrompt} />
              ))}
            </Panel>
          )}
        </Section>
      </div>

      <div className="min-w-0 space-y-7">
        <Section title="Pinned" count={pins.length}>
          {pins.length === 0 ? (
            <Empty>Hover a project or session and press the pin.</Empty>
          ) : (
            <Panel>
              {pins.map((p) => {
                const k = p.id ? liveSessionKey(p.provider, p.root, p.id) : null
                const c = providerColor(providers, p.provider)
                const dot = k && termKeys?.has(k) ? statusDot('terminal') : k && live?.ids?.has(k) ? statusDot('writing') : c.dot
                return (
                  <div key={`${p.provider}|${p.root}|${p.slug}|${p.id || ''}`} className="group flex items-center gap-2.5 px-3 py-2 hover:bg-ink-800 border-b border-zinc-800/60 last:border-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                    <button onClick={(e) => onOpen(p.provider, { root: p.root, rootLabel: p.rootLabel, slug: p.slug, id: p.id, title: p.title, project: p.project, cwd: p.cwd }, { newTab: e.ctrlKey || e.metaKey })} className="min-w-0 flex-1 text-left">
                      <div className="text-[12.5px] text-zinc-200 truncate">{p.id ? p.title || p.id.slice(0, 8) : p.project || p.slug}</div>
                      <div className="text-[10.5px] text-zinc-600 truncate">{p.id ? p.project : shortPath(p.cwd || p.slug)} · {index.labelOf(p.provider, p.root, p.rootLabel)}</div>
                    </button>
                    <button onClick={() => togglePin(p)} title="Unpin" className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-amber-300 opacity-0 group-hover:opacity-100 hover:bg-ink-700">
                      <PinIcon className="w-3.5 h-3.5" filled />
                    </button>
                  </div>
                )
              })}
            </Panel>
          )}
        </Section>

        <Section title="Recent projects" count={index.projects.length}>
          {index.projects.length === 0 ? (
            <Empty>{index.loading ? 'Loading…' : 'No projects yet.'}</Empty>
          ) : (
            <Panel>
              {index.projects.slice(0, 8).map((p) => (
                <button
                  key={`${p.provider}:${p.root}:${p.slug}`}
                  onClick={(e) => onOpen(p.provider, { root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name }, { newTab: e.ctrlKey || e.metaKey })}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-800 border-b border-zinc-800/60 last:border-0"
                  title={p.cwd || p.slug}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${providerColor(providers, p.provider).dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] text-zinc-200 truncate">{p.name}</span>
                    <span className="block text-[10.5px] text-zinc-600 truncate">{p.rootLabel} · {p.sessionCount} session{p.sessionCount === 1 ? '' : 's'}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-zinc-600">{fmtRelative(p.lastActivity)}</span>
                </button>
              ))}
            </Panel>
          )}
        </Section>

        <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-600">
          <span className="uppercase tracking-wide">tracked</span>
          {providers.map((p) => (
            <span key={p.id} title={versions[p.id] ? `${p.label} ${versions[p.id]} (from the latest tracked session)` : `${p.label} — no tracked session yet`} className={`px-1.5 py-0.5 rounded border ${p.accent}`}>
              {p.label} {versions[p.id] ? `v${versions[p.id]}` : '—'}
            </span>
          ))}
        </div>
      </div>
      </div>
    </div>
  )
}

export default function HomeView({ providers = [], visible = true, target, scope, onScope, index, live, termKeys, onOpen, onNavigate, onOpenHome, onManageFolders, onSearch }) {
  const view = normalizeView(target?.view)
  const scopeInfo = scope ? index.scopes.find((s) => s.provider === scope.provider && s.root === scope.root) : null
  const providerCfg = scope ? providers.find((p) => p.id === scope.provider) : null
  const Page = providerCfg?.homePages?.[view]
  const scoped = view !== 'activity'

  return (
    <div className="h-full flex flex-col bg-ink-950">
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800 bg-ink-900/70">
        <div className="flex items-center gap-0.5 rounded-md bg-ink-800 border border-zinc-800 p-0.5">
          {HOME_VIEWS.map((v) => (
            <button
              key={v.k}
              onClick={(e) => (e.ctrlKey || e.metaKey ? onOpenHome?.({ view: v.k }, { newTab: true }) : onNavigate?.({ view: v.k, focus: null }))}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && onOpenHome?.({ view: v.k }, { newTab: true })}
              title={`${v.label} · Ctrl+click opens in a new tab`}
              className={`h-7 px-3 rounded text-[12.5px] transition-colors ${view === v.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {/* the folder is chosen once, in the sidebar's chips — the pages follow that scope */}
        <span className="flex-1" />
        <button onClick={onSearch} title="Search projects & sessions  (Ctrl+K)" className="flex items-center gap-2 h-8 px-3 rounded-md bg-ink-800 border border-zinc-700 text-[12px] text-zinc-300 hover:text-zinc-100 hover:bg-ink-700">
          <SearchIcon className="w-3.5 h-3.5" />
          Jump to…
          <kbd className="text-[10px] px-1 py-px rounded bg-ink-700 text-zinc-500 border border-zinc-800">Ctrl K</kbd>
        </button>
      </div>

      {view === 'activity' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Activity providers={providers} visible={visible} index={index} live={live} termKeys={termKeys} onOpen={onOpen} />
        </div>
      )}
      {scoped && !scope && <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">No tracked folders yet — add one with the + next to the folder chips.</div>}
      {scoped && scope && view === 'insights' && (
        <div key={`insights|${scope.provider}|${scope.root}`} className="flex-1 min-h-0 overflow-y-auto">
          <InsightsPage provider={scope.provider} root={scope.root} rootLabel={scopeInfo?.rootLabel || ''} providerLabel={providerLabel(providers, scope.provider)} onOpen={(t) => onOpen(scope.provider, { rootLabel: scopeInfo?.rootLabel, ...t })} />
        </div>
      )}
      {scoped && scope && view !== 'insights' && Page && (
        <div key={`${view}|${scope.provider}|${scope.root}`} className={view === 'resources' ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-y-auto'}>
          <Page root={scope.root} focus={target?.focus || null} onOpen={(t) => onOpen(scope.provider, { rootLabel: scopeInfo?.rootLabel, ...t })} />
        </div>
      )}
      {scoped && scope && view !== 'insights' && !Page && <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">This provider has no {homeViewLabel(view)} page.</div>}
    </div>
  )
}
