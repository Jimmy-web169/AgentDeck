import { useEffect, useState } from 'react'
import { fmtRelative } from '../../lib/format.js'
import { ActivityIcon } from './icons.jsx'
import useActiveSessions, { toManagerItems } from '../../lib/useActiveSessions.js'

// provider badge colors come from each provider's config (`accent`); unknown → zinc
const ZINC = 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
const accentOf = (providers, id) => providers?.find((p) => p.id === id)?.accent || ZINC

// last two path segments of a cwd/slug
function shortPath(p) {
  const parts = String(p || '').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || p || '(unknown)'
}

function ProviderBadge({ providers, id }) {
  const label = providers?.find((p) => p.id === id)?.label || id
  return (
    <span className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${accentOf(providers, id)}`}>
      {label}
    </span>
  )
}

// Cross-provider home page.
//  - "Live now"        = the running tmux sessions (terminal mode); they persist
//                        until you End them, so this is "what's actually going".
//  - "Recent projects" = every tracked project across providers, newest first.
const PAGE_SIZE = 20

export default function Dashboard({ providers = [], visible = true, onClose, onOpen }) {
  // ---- live now: running tmux terminals (cross-provider, persistent) ----
  const active = useActiveSessions(providers, { enabled: visible })
  const liveItems = toManagerItems(active)
  const [copied, setCopied] = useState(null)
  const [ended, setEnded] = useState(() => new Set()) // optimistic-hide until next poll
  const [page, setPage] = useState(0)

  const copyAttach = (name) => {
    navigator.clipboard
      ?.writeText(`tmux attach -t ${name}`)
      .then(() => {
        setCopied(name)
        setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500)
      })
      .catch(() => {})
  }

  // End: kill the tmux session (the next poll then drops the card)
  const endItem = (it) => {
    if (!it.key || !it.provider) return
    setEnded((prev) => new Set(prev).add(it.key))
    fetch(`/api/${it.provider}/terminal?key=${encodeURIComponent(it.key)}`, { method: 'DELETE' }).catch(() => {})
  }

  const shownLive = liveItems.filter((it) => !ended.has(it.key))

  // ---- recent projects + tracked CLI versions (cross-provider, on mount) ----
  const [recent, setRecent] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [versions, setVersions] = useState({}) // providerId -> version string | null

  useEffect(() => {
    if (!visible) return // refetch each time the dashboard is opened (picks up newly-added roots)
    let cancelled = false
    setLoadingRecent(true)
    ;(async () => {
      const out = []
      const vmap = {}
      await Promise.all(
        providers.map(async (p) => {
          try {
            const rootsRes = await fetch(`/api/${p.id}/roots`).then((r) => r.json())
            const roots = (rootsRes?.roots || []).filter((r) => r.exists !== false)
            // CLI version observed in the most recent tracked session
            if (roots[0]) {
              try {
                const v = await fetch(`/api/${p.id}/version?root=${encodeURIComponent(roots[0].id)}`).then((x) => x.json())
                vmap[p.id] = v?.version || null
              } catch {
                // version probe failed — leave it unknown
              }
            }
            await Promise.all(
              roots.map(async (r) => {
                try {
                  const pr = await fetch(`/api/${p.id}/projects?root=${encodeURIComponent(r.id)}`).then((x) => x.json())
                  for (const proj of pr?.projects || []) {
                    out.push({
                      provider: p.id,
                      root: r.id,
                      slug: proj.slug,
                      cwd: proj.cwd,
                      lastActivity: proj.lastActivity,
                    })
                  }
                } catch {
                  // skip this root
                }
              })
            )
          } catch {
            // skip this provider
          }
        })
      )
      if (cancelled) return
      out.sort((a, b) => (Number(b.lastActivity) || 0) - (Number(a.lastActivity) || 0))
      setRecent(out)
      setVersions(vmap)
      setLoadingRecent(false)
    })()
    return () => {
      cancelled = true
    }
  }, [providers, visible])

  // pagination for recent projects (20/page)
  const pageCount = Math.max(1, Math.ceil(recent.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pagedRecent = recent.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* header */}
        <div className="flex items-center gap-3 mb-8">
          <span className="text-emerald-400"><ActivityIcon className="w-6 h-6" /></span>
          <div className="flex items-baseline gap-2">
            <span className="text-[18px] font-semibold tracking-tight text-zinc-100">AgentDeck</span>
            <span className="text-[15px] text-zinc-500">Dashboard</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            title="Back"
            className="text-[13px] px-3 py-1.5 rounded-md bg-ink-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-ink-700"
          >
            ← back
          </button>
        </div>

        {/* tracked CLI versions — observed in the most recent session per provider */}
        <div className="flex flex-wrap items-center gap-2 mb-8 -mt-4 pl-9">
          <span className="text-[11px] uppercase tracking-wide text-zinc-600">tracked</span>
          {providers.map((p) => (
            <span
              key={p.id}
              title={versions[p.id] ? `${p.label} ${versions[p.id]} (from the latest tracked session)` : `${p.label} — no tracked session yet`}
              className={`text-[11px] px-2 py-0.5 rounded border ${p.accent || ZINC}`}
            >
              {p.label} {versions[p.id] ? `v${versions[p.id]}` : '—'}
            </span>
          ))}
        </div>

        {/* live now — running tmux terminals */}
        <div className="mb-9">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Live now</span>
            <span className="text-[11px] text-zinc-600">· {shownLive.length} running terminal{shownLive.length === 1 ? '' : 's'}</span>
          </div>
          {shownLive.length === 0 ? (
            <div className="text-[13px] text-zinc-600 bg-ink-900 border border-zinc-800 rounded-lg px-4 py-6 text-center">
              No running terminals. Open a session in <span className="text-zinc-400">Terminal</span> mode — it stays here until you End it.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {shownLive.map((it) => (
                <div key={it.key} className="bg-ink-900 border border-zinc-800 rounded-lg px-3 py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <ProviderBadge providers={providers} id={it.provider} />
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600">terminal</span>
                    <span className={`ml-auto w-1.5 h-1.5 rounded-full ${it.attached ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} title={it.attached ? 'attached' : 'detached (running in background)'} />
                    <span className="text-[10px] text-zinc-600">{it.attached ? 'attached' : 'detached'}</span>
                  </div>
                  <div className="text-[13px] text-zinc-200 truncate" title={it.cwd || it.slug || ''}>{it.title}</div>
                  {it.tmuxName && (
                    <button
                      onClick={() => copyAttach(it.tmuxName)}
                      title="Copy — attach this session from any terminal"
                      className="flex items-center gap-1 text-[10.5px] font-mono text-zinc-600 hover:text-sky-300 max-w-full"
                    >
                      <span className="shrink-0">{copied === it.tmuxName ? '✓ copied' : '⧉'}</span>
                      <span className="truncate">tmux attach -t {it.tmuxName}</span>
                    </button>
                  )}
                  <div className="flex gap-2 mt-auto pt-1">
                    <button
                      onClick={() => onOpen(it.provider, { root: it.root, slug: it.slug, id: it.id, kind: 'tmux', engine: 'terminal' })}
                      className="text-[12px] px-2.5 py-1 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => endItem(it)}
                      className="text-[12px] px-2.5 py-1 rounded bg-red-500/15 text-red-200 hover:bg-red-500/25"
                    >
                      End
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* recent projects */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">Recent projects</span>
            <span className="text-[11px] text-zinc-600">· {recent.length}</span>
            {loadingRecent && <span className="text-[11px] text-zinc-600">loading…</span>}
          </div>
          {!loadingRecent && recent.length === 0 ? (
            <div className="text-[13px] text-zinc-600 bg-ink-900 border border-zinc-800 rounded-lg px-4 py-6 text-center">
              No recent projects.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {pagedRecent.map((p) => (
                  <button
                    key={`${p.provider}:${p.root}:${p.slug}`}
                    onClick={() => onOpen(p.provider, { root: p.root, slug: p.slug })}
                    className="text-left bg-ink-900 border border-zinc-800 rounded-lg px-3 py-3 hover:border-zinc-600 hover:bg-ink-800 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <ProviderBadge providers={providers} id={p.provider} />
                      <span className="ml-auto text-[10.5px] text-zinc-600">{fmtRelative(p.lastActivity)}</span>
                    </div>
                    <div className="text-[13px] text-zinc-200 truncate" title={p.cwd || p.slug}>
                      {shortPath(p.cwd || p.slug)}
                    </div>
                  </button>
                ))}
              </div>
              {pageCount > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4 text-[12px]">
                  <button
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="px-2.5 py-1 rounded bg-ink-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ‹ Prev
                  </button>
                  <span className="text-zinc-500">{safePage + 1} / {pageCount}</span>
                  <button
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    className="px-2.5 py-1 rounded bg-ink-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
