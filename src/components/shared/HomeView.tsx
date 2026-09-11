import type { ReactNode, MouseEvent } from 'react'
import type { Target } from '../../../shared/types.d.ts'
import type { NavIndex, NavProject, NavSession } from '../../api/useNavIndex.ts'
import type { Folder, FolderSource } from '../../api/models.ts'
import type { UIProvider } from '../../providers/views.ts'
import type { Scope } from '../../lib/useShellNavigation.ts'
type Open = (provider: string, target: Target, options?: { newTab?: boolean }) => void
type HomeSession = NavSession & { rootLabel?: string; project?: string; cwd?: string | null }
type ManagerItem = ReturnType<typeof toManagerItems>[number]
type ProjectSource = { provider: string; root: string; rootLabel: string; slug: string | null; cwd: string | null; name: string }
type FolderRow = Omit<Folder, 'sources'> & { key: string; sources: (FolderSource & { name: string })[] }
interface ActivityProps {
  providers: readonly UIProvider[]
  visible?: boolean
  index: NavIndex
  live?: { ids: Set<string> }
  termKeys?: Set<string>
  onOpen: Open
}
interface HomeProps extends ActivityProps {
  tabKey: string | null
  target: Target | null
  scope: Scope | null
  onNavigate?: (target: Target) => void
  onOpenHome?: (target: Target, options?: { newTab?: boolean }) => void
}
import { useProviderVersions, stopTerminal } from '../../api/index.ts'
import { scopedViewKey, sessionKey, sessionLocatorKey, homeProjectKey, colonProjectKey } from '../../../shared/identity.ts'
import { announceTerminalEnd } from '../../lib/terminalTarget.ts'
import { sessionPreviews } from '../../lib/sessionPreviews.ts'
import { liveTarget } from '../../lib/tabs.ts'
import { useMemo, useState } from 'react'
import { fmtRelative } from '../../lib/format.ts'
import { shortPath } from '../../lib/paths.ts'
import useFolderCatalog from '../../lib/useFolderCatalog.ts'
import { visibleFolderTree, resolveFolderPins } from '../../lib/folderTree.ts'
import { HOME_VIEWS, homeViewLabel, normalizeView } from '../../lib/tabs.ts'
import { providerColor, providerLabel, statusDot, statusText } from '../../lib/providerColors.ts'
import { liveSessionKey } from '../../../shared/identity.ts'
import { isPinned, togglePin, usePins, pinsForMode, isFolderPin, pinKey, revealPinnedFolder } from '../../lib/pins.ts'
import { FolderIcon } from './icons.tsx'
import useActiveSessions, { toManagerItems } from '../../lib/useActiveSessions.ts'
import { PinIcon, TerminalIcon } from './shellIcons.tsx'
import { usePrefs } from '../../lib/prefs.ts'
import { MOD_WORD } from './ShortcutHints.tsx'
import InsightsPage from './InsightsPage.tsx'
import IntegratedHomePage from './IntegratedHomePage.tsx'
import { resolveHomePresentation } from '../../lib/homeScope.ts'

// Provider mode follows the sidebar's native source. Only Folder mode uses
// cross-source reports; both paths keep the established detailed components.

const RECENT_PROJECTS_SCANNED = 10 // projects whose session lists feed "Latest sessions"
const LATEST_SESSIONS_MAX = 60 // how far the pager can go (the scan is 10 projects deep)

function ProviderBadge({ providers, id }: { providers: readonly UIProvider[]; id?: string | null }) {
  const c = providerColor(providers, id)
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-zinc-800 bg-ink-800 ${c.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {providerLabel(providers, id)}
    </span>
  )
}

// ‹ 1/3 › in a section header: the page size is the user’s (Preferences › Home),
// so a long list pages instead of stretching the screen
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null
  const btn =
    'w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-ink-700 disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <span className="flex items-center gap-0.5 text-[11px] text-zinc-500 whitespace-nowrap shrink-0">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} className={btn} title="Previous page">
        ‹
      </button>
      <span className="tabular-nums">
        {page + 1}/{pages}
      </span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} className={btn} title="Next page">
        ›
      </button>
    </span>
  )
}
function pageOf<T>(list: readonly T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(list.length / size))
  const p = Math.min(page, pages - 1)
  return { pages, page: p, items: list.slice(p * size, p * size + size) }
}

// Recent projects follows the navigation preference; canonical folder grouping
// and unavailable/provider filters match the sidebar, without a second switch.
function RecentProjects({ providers, index, onOpen }: Pick<ActivityProps, 'providers' | 'index' | 'onOpen'>) {
  const { sidebarMode: by, homeProjects: size, showUnavailableFolders, folderExcludedProviders, folderExcludedRoots } = usePrefs()
  const catalog = useFolderCatalog(by === 'folder')
  const [pageN, setPageN] = useState(0)
  const rows = useMemo<(NavProject | FolderRow)[]>(() => {
    if (by !== 'folder') return index.projects
    return visibleFolderTree(catalog.folders, {
      excludedProviders: folderExcludedProviders,
      excludedRoots: folderExcludedRoots,
      showUnavailable: showUnavailableFolders,
    })
      .map((f) => ({ ...f, key: f.id, name: shortPath(f.cwd || f.name), sources: f.sources.map((s) => ({ ...s, name: f.name })) }))
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0) || a.id.localeCompare(b.id))
  }, [by, index.projects, catalog.folders, folderExcludedProviders, folderExcludedRoots, showUnavailableFolders])
  const { pages, page, items: shown } = pageOf(rows, pageN, size || 5)
  const open = (p: ProjectSource, e: MouseEvent) =>
    onOpen(p.provider, { root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name }, { newTab: e.ctrlKey || e.metaKey })
  return (
    <Section title="Recent projects" count={shown.length} pager={<Pager page={page} pages={pages} onPage={setPageN} />}>
      {by === 'folder' && catalog.error && (
        <p role="alert" className="text-xs text-red-300 mb-2">
          {catalog.error}
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>{index.loading || (by === 'folder' && catalog.loading) ? 'Loading…' : 'No projects yet.'}</Empty>
      ) : (
        <Panel>
          {by === 'folder'
            ? shown.map(
                (g) =>
                  'sources' in g && (
                    <div
                      key={g.key}
                      className="min-w-0 flex flex-wrap items-center gap-2.5 px-3 py-2 hover:bg-ink-800 border-b border-zinc-800/60 last:border-0"
                    >
                      <button type="button" onClick={(e) => open(g.sources[0], e)} className="min-w-0 flex-[1_1_7rem] text-left" title={g.cwd || g.name}>
                        <span className="block text-[12.5px] text-zinc-200 truncate">{g.name}</span>
                        <span className="block text-[10.5px] text-zinc-600 truncate">
                          {g.sessionCount} sessions · {g.sources.length} sources
                        </span>
                      </button>
                      <span className="max-w-full flex flex-wrap items-center gap-1">
                        {g.sources.map((s) => (
                          <button
                            type="button"
                            key={homeProjectKey(s)}
                            onClick={(e) => open(s, e)}
                            title={`${providerLabel(providers, s.provider)} · ${s.rootLabel || s.root} · ${s.sessionCount} sessions`}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-ink-700"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${providerColor(providers, s.provider).dot}`} />
                            <span className="text-[10.5px] text-zinc-500">{s.sessionCount}</span>
                          </button>
                        ))}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-zinc-600 w-14 text-right">{fmtRelative(g.lastActivity)}</span>
                    </div>
                  )
              )
            : shown.map(
                (p) =>
                  !('sources' in p) && (
                    <button
                      type="button"
                      key={colonProjectKey(p)}
                      onClick={(e) => open(p, e)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-800 border-b border-zinc-800/60 last:border-0"
                      title={p.cwd || p.slug}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${providerColor(providers, p.provider).dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] text-zinc-200 truncate">{p.name}</span>
                        <span className="block text-[10.5px] text-zinc-600 truncate">
                          {p.rootLabel} · {p.sessionCount} session{p.sessionCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10.5px] text-zinc-600">{fmtRelative(p.lastActivity)}</span>
                    </button>
                  )
              )}
        </Panel>
      )}
    </Section>
  )
}

function Section({
  title,
  count,
  right,
  pager,
  children,
  className = '',
}: {
  title: string
  count?: ReactNode
  right?: ReactNode
  pager?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="flex flex-wrap items-center gap-2 mb-2.5 min-w-0">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500 whitespace-nowrap">{title}</span>
        {count != null && <span className="text-[11px] text-zinc-600 whitespace-nowrap shrink-0">· {count}</span>}
        <span className="flex-1" />
        {right}
        {pager}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="text-[12.5px] text-zinc-600 bg-ink-900 border border-zinc-800 rounded-lg px-4 py-5 text-center">{children}</div>
)
const Panel = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`min-w-0 rounded-lg border border-zinc-800 bg-ink-900 ${className}`}>{children}</div>
)

// A session row: status dot, title, optional question previews, source, time, pin.
export function SessionRow({
  s,
  providers,
  live,
  termKeys,
  onOpen,
  showLatestPrompt = true,
}: Pick<ActivityProps, 'providers' | 'live' | 'termKeys' | 'onOpen'> & { s: HomeSession; showLatestPrompt?: boolean }) {
  const previews = sessionPreviews(s, { showLatestPrompt })
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
        type="button"
        onClick={(e) => onOpen(s.provider, pinT, { newTab: e.ctrlKey || e.metaKey })}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && onOpen(s.provider, pinT, { newTab: true })}
        className="min-w-0 flex-1 text-left"
        title={`Open here · ${MOD_WORD}+click or middle-click opens in a new tab`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] text-zinc-200 truncate">{s.title}</span>
          {term && <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-red-300">terminal</span>}
          <span className="ml-auto shrink-0 text-[10.5px] text-zinc-600">{fmtRelative(s.lastTs)}</span>
        </div>
        {previews.length > 0 && (
          <div className="my-1.5 space-y-1 border-l border-zinc-700/60 pl-2.5">
            {previews.map((preview) => (
              <div
                key={preview.kind}
                data-question-preview={preview.kind}
                className="min-w-0 truncate text-[12px] leading-4 text-zinc-500"
                title={preview.text}
              >
                {preview.text}
              </div>
            ))}
          </div>
        )}
        <div className="text-[10.5px] text-zinc-600 truncate">
          <span className={c.text}>{providerLabel(providers, s.provider)}</span> · {s.project} · {s.rootLabel}
        </div>
      </button>
      <button
        type="button"
        onClick={() => togglePin(pinT)}
        title={pinned ? 'Unpin' : 'Pin'}
        className={`shrink-0 mt-0.5 w-6 h-6 rounded flex items-center justify-center hover:bg-ink-700 ${pinned ? 'text-amber-300' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}
      >
        <PinIcon className="w-3.5 h-3.5" filled={pinned} />
      </button>
    </div>
  )
}

function Activity({ providers, visible, index, live, termKeys, onOpen }: ActivityProps) {
  const active = useActiveSessions(providers, { enabled: visible })
  const liveItems = toManagerItems(active)
  const allPins = usePins()
  const prefs = usePrefs()
  const pins = pinsForMode(allPins, prefs.sidebarMode)
  const pinCatalog = useFolderCatalog(prefs.sidebarMode === 'folder' && pins.some(isFolderPin))
  const pinnedFolders = resolveFolderPins(pins, pinCatalog.folders, {
    excludedProviders: prefs.folderExcludedProviders,
    excludedRoots: prefs.folderExcludedRoots,
    showUnavailable: prefs.showUnavailableFolders,
  })
  const [latestPage, setLatestPage] = useState(0)
  const latestLimit = prefs.homeSessions || 10
  const [ended, setEnded] = useState(() => new Set<string>())
  const [copied, setCopied] = useState<string | null>(null)
  const versions = useProviderVersions(providers, index.roots || {}, { enabled: visible })
  const [endError, setEndError] = useState<string | null>(null)

  // latest sessions across providers: the session lists of the most recently
  // active projects, merged and sorted (lists load lazily; rows fill in)
  const scanned = useMemo(() => index.projects.slice(0, RECENT_PROJECTS_SCANNED), [index.projects])
  const latest = useMemo(() => {
    if (!visible) return []
    const out: HomeSession[] = []
    for (const p of scanned) {
      const list = index.sessionsFor(p.provider, p.root, p.slug)
      if (!list) continue
      for (const s of list) out.push({ ...s, rootLabel: p.rootLabel, project: p.name, cwd: p.cwd })
    }
    out.sort((a, b) => String(b.lastTs || '').localeCompare(String(a.lastTs || '')))
    return out.slice(0, LATEST_SESSIONS_MAX)
  }, [visible, index, scanned])
  const loadingLatest = visible && scanned.some((p) => index.sessionsFor(p.provider, p.root, p.slug) === null)

  const copyAttach = (name: string) => {
    navigator.clipboard
      ?.writeText(`tmux attach -t ${name}`)
      .then(() => {
        setCopied(name)
        setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500)
      })
      .catch(() => {})
  }
  const endItem = (it: ManagerItem) => {
    if (!it.key || !it.provider) return
    const provider = it.provider
    setEnded((prev) => new Set(prev).add(it.key))
    setEndError(null)
    stopTerminal(it.provider, it.key)
      .then(() => announceTerminalEnd(provider, it.key))
      .catch((error) => {
        setEnded((previous) => {
          const next = new Set(previous)
          next.delete(it.key)
          return next
        })
        setEndError(error.message)
      })
  }
  const shownLive = liveItems.filter((it) => !ended.has(it.key))
  const today = Date.now() - 24 * 3600 * 1000
  const activeToday = latest.filter((s) => s.lastTs && new Date(s.lastTs).getTime() > today).length
  const latestPaged = pageOf(latest, latestPage, latestLimit)
  const shownLatest = latestPaged.items

  return (
    <div className="activity-layout w-full min-w-0 max-w-6xl mx-auto px-6 py-5">
      {endError && (
        <div role="alert" className="mb-3 text-sm text-red-300">
          {endError}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-7">
          <Section title="Live now" count={`${shownLive.length} running terminal${shownLive.length === 1 ? '' : 's'}`}>
            {shownLive.length === 0 ? (
              <Empty>
                No running terminals. Open a session and press <span className="text-zinc-400">Open terminal</span> — it stays here until you End it.
              </Empty>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {shownLive.map((it) => (
                  <Panel key={it.key} className="px-3 py-3 flex flex-col gap-2 border-red-500/30">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProviderBadge providers={providers} id={it.provider} />
                      <TerminalIcon className={`w-3.5 h-3.5 ${statusText('terminal')}`} />
                      <span className={`ml-auto w-1.5 h-1.5 rounded-full ${statusDot('terminal')}`} />
                      <span className="text-[10px] text-zinc-600">{it.attached ? 'attached' : 'detached'}</span>
                    </div>
                    <div className="text-[13px] text-zinc-200 truncate" title={it.cwd || it.slug || ''}>
                      {it.title}
                    </div>
                    {it.tmuxName && (
                      <button
                        type="button"
                        onClick={() => it.tmuxName && copyAttach(it.tmuxName)}
                        title="Copy — attach this session from any terminal"
                        className="flex items-center gap-1 text-[10.5px] font-mono text-zinc-600 hover:text-sky-300 max-w-full"
                      >
                        <span className="shrink-0">{copied === it.tmuxName ? '✓ copied' : '⧉'}</span>
                        <span className="truncate">tmux attach -t {it.tmuxName}</span>
                      </button>
                    )}
                    <div className="flex gap-2 mt-auto pt-1">
                      <button
                        type="button"
                        onClick={() => onOpen(it.provider || '', liveTarget(it), { newTab: true })}
                        className="text-[12px] px-2.5 py-1 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => endItem(it)}
                        className="text-[12px] px-2.5 py-1 rounded bg-red-500/15 text-red-200 hover:bg-red-500/25"
                      >
                        End
                      </button>
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Latest sessions"
            count={loadingLatest ? 'loading…' : `${shownLatest.length} · ${activeToday} active in the last 24h`}
            pager={<Pager page={latestPaged.page} pages={latestPaged.pages} onPage={setLatestPage} />}
          >
            {latest.length === 0 ? (
              <Empty>{loadingLatest ? 'Loading…' : 'No sessions yet. Track a folder with the + next to the folder chips.'}</Empty>
            ) : (
              <Panel>
                {shownLatest.map((s) => (
                  <SessionRow
                    key={sessionKey(s.provider, s.root, s.id)}
                    s={s}
                    providers={providers}
                    live={live}
                    termKeys={termKeys}
                    onOpen={onOpen}
                    showLatestPrompt={prefs.showLatestPrompt}
                  />
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
                  if (isFolderPin(p)) {
                    const folder = pinnedFolders.find((f: { id: string | undefined }) => f.id === p.folderId)
                    return (
                      <div key={pinKey(p)} className="group flex items-center gap-2.5 px-3 py-2 hover:bg-ink-800 border-b border-zinc-800/60 last:border-0">
                        <FolderIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <button type="button" onClick={() => revealPinnedFolder(p)} title="Show pinned folder in sidebar" className="min-w-0 flex-1 text-left">
                          <div className="text-[12.5px] text-zinc-200 truncate">{shortPath(p.cwd)}</div>
                          <div className="text-[10.5px] text-zinc-600 truncate">
                            {pinCatalog.loading ? 'Loading sources…' : folder?.pinStatus || `${folder?.sources.length || 0} sources · Show in sidebar`}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => togglePin(p)}
                          title="Unpin folder"
                          className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-amber-300 hover:bg-ink-700"
                        >
                          <PinIcon className="w-3.5 h-3.5" filled />
                        </button>
                      </div>
                    )
                  }
                  const k = p.id ? liveSessionKey(p.provider || '', p.root || '', p.id) : null
                  const c = providerColor(providers, p.provider)
                  const dot = k && termKeys?.has(k) ? statusDot('terminal') : k && live?.ids?.has(k) ? statusDot('writing') : c.dot
                  return (
                    <div
                      key={sessionLocatorKey(p.provider || '', p.root || '', p.slug || '', p.id || '')}
                      className="group flex items-center gap-2.5 px-3 py-2 hover:bg-ink-800 border-b border-zinc-800/60 last:border-0"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                      <button
                        type="button"
                        onClick={(e) =>
                          onOpen(
                            p.provider || '',
                            { root: p.root, rootLabel: p.rootLabel, slug: p.slug, id: p.id, title: p.title, project: p.project, cwd: p.cwd },
                            { newTab: e.ctrlKey || e.metaKey }
                          )
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="text-[12.5px] text-zinc-200 truncate">{p.id ? p.title || p.id.slice(0, 8) : p.project || p.slug}</div>
                        <div className="text-[10.5px] text-zinc-600 truncate">
                          {p.id ? p.project : shortPath(p.cwd || p.slug)} · {index.labelOf(p.provider || '', p.root || '', p.rootLabel || '')}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePin(p)}
                        title="Unpin"
                        className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-amber-300 opacity-0 group-hover:opacity-100 hover:bg-ink-700"
                      >
                        <PinIcon className="w-3.5 h-3.5" filled />
                      </button>
                    </div>
                  )
                })}
              </Panel>
            )}
          </Section>

          <RecentProjects providers={providers} index={index} onOpen={onOpen} />

          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-600">
            <span className="uppercase tracking-wide">tracked</span>
            {providers.map((p) => (
              <span
                key={p.id}
                title={versions[p.id] ? `${p.label} ${versions[p.id]} (from the latest tracked session)` : `${p.label} — no tracked session yet`}
                className={`px-1.5 py-0.5 rounded border ${p.accent}`}
              >
                {p.label} {versions[p.id] ? `v${versions[p.id]}` : '—'}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function HomeView({
  tabKey,
  providers = [],
  visible = true,
  target,
  scope: sidebarScope,
  index,
  live,
  termKeys,
  onOpen,
  onNavigate,
  onOpenHome,
}: HomeProps) {
  const view = normalizeView(target?.view)
  const prefs = usePrefs()
  const { explicitSource, integrated, homeScope, scope } = resolveHomePresentation(prefs, target, sidebarScope)
  const pageTarget = (page: string) => ({ view: page })
  const scopeInfo = scope ? index.scopes.find((s: { provider: string; root: string }) => s.provider === scope.provider && s.root === scope.root) : null
  const providerCfg = scope ? providers.find((p) => p.id === scope.provider) : null
  const Page = providerCfg?.homePages?.[view]
  const scoped = view !== 'activity'

  return (
    <div className="h-full min-w-0 flex flex-col bg-ink-950">
      <div className="min-h-12 shrink-0 flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-ink-900/70">
        <div className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-md bg-ink-800 border border-zinc-800 p-0.5">
          {HOME_VIEWS.map((v) => (
            <button
              type="button"
              key={v.k}
              onClick={(e) =>
                e.ctrlKey || e.metaKey ? onOpenHome?.(pageTarget(v.k), { newTab: true }) : onNavigate?.({ view: v.k, focus: null, homeSource: null })
              }
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && onOpenHome?.(pageTarget(v.k), { newTab: true })}
              title={`${v.label} · ${MOD_WORD}+click opens in a new tab`}
              className={`h-7 px-3 rounded text-[12.5px] transition-colors ${view === v.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
      </div>

      {scoped && explicitSource && scope && (
        <div className="shrink-0 px-4 py-2 border-b border-zinc-800 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <button type="button" className="text-sky-300" onClick={() => onNavigate?.({ homeSource: null })}>
            ← {homeViewLabel(view)}
          </button>
          <span>
            {providerLabel(providers, scope.provider)} / {scopeInfo?.rootLabel || explicitSource.rootLabel || scope.root}
          </span>
          {view === 'resources' && <span>User-level source · May affect other folders</span>}
        </div>
      )}

      {view === 'activity' && (
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <Activity providers={providers} visible={visible} index={index} live={live} termKeys={termKeys} onOpen={onOpen} />
        </div>
      )}
      {scoped && integrated && (
        <div className="flex-1 min-h-0">
          <IntegratedHomePage
            key={tabKey}
            view={view}
            scope={homeScope}
            showUnavailable={prefs.showUnavailableFolders}
            providers={providers}
            visible={visible}
            onOpen={onOpen}
          />
        </div>
      )}
      {scoped && !integrated && !scope && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">
          No tracked folders yet — add one with the + next to the folder chips.
        </div>
      )}

      {scoped && !integrated && scope && view === 'insights' && (
        <div key={scopedViewKey('insights', scope.provider, scope.root)} className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <InsightsPage
            provider={scope.provider}
            root={scope.root}
            rootLabel={scopeInfo?.rootLabel || ''}
            providerLabel={providerLabel(providers, scope.provider)}
            onOpen={(t) => onOpen(scope.provider, { rootLabel: scopeInfo?.rootLabel, ...t })}
          />
        </div>
      )}
      {scoped && !integrated && scope && view !== 'insights' && Page && (
        <div
          key={scopedViewKey(view, scope.provider, scope.root)}
          className={view === 'resources' ? 'flex-1 min-h-0' : 'flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden'}
        >
          <Page root={scope.root} focus={target?.focus || null} onOpen={(t) => onOpen(scope.provider, { rootLabel: scopeInfo?.rootLabel, ...t })} />
        </div>
      )}
      {scoped && !integrated && scope && view !== 'insights' && !Page && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">This provider has no {homeViewLabel(view)} page.</div>
      )}
    </div>
  )
}
