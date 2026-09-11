import type { UIProvider } from '../../providers/views.ts'
import type {
  HomeSource,
  HomeResourcesReport,
  HomePluginsReport,
  HomeHistoryReport,
  HomeInsightsReport,
  HomeStatsReport,
  ResourceGroup as ResourceEntry,
} from '../../api/models.ts'
export interface HomeSelection {
  key?: string
  folder?: string
  source?: string
  ownedSource?: string
}
export type HomeSelect = (next: HomeSelection) => void
export type HomeOpen = (provider: string, target: import('../../../shared/types.d.ts').Target) => void
import { errorMessage } from '../../lib/errors.ts'
import { IntegratedStats } from './IntegratedStats.tsx'
import { HomeSourceLabel, homeSourceLinkClass as link } from './HomeSourceLabel.tsx'
import { homeViewKey, homeSourceKey, resourceEntryKey } from '../../../shared/identity.ts'
import { useEffect, useRef, useState } from 'react'
import { useHomeReport } from '../../api/index.ts'
import { homeQuery } from '../../lib/homeScope.ts'
import { shortPath } from '../../lib/paths.ts'
import { fmtRelative } from '../../lib/format.ts'
import InsightsPage from './InsightsPage.tsx'

const button = 'px-3 py-1.5 rounded border border-zinc-700 bg-ink-700 text-xs text-zinc-200 hover:bg-ink-600 disabled:opacity-40'
export function IntegratedInsights({ data }: { data: HomeInsightsReport; providers?: readonly UIProvider[] }) {
  // The same complete rhythm report as Provider mode, without a second folder
  // dashboard. Needs attention remains part of the original report.
  return <InsightsPage embedded data={data.activity} />
}
export function IntegratedHistory({ data, providers }: { data: HomeHistoryReport; providers: readonly UIProvider[] }) {
  return (
    <div className="space-y-2">
      {data.history.map((h) => (
        <div key={h.key} className="rounded-lg border border-zinc-800 bg-ink-900 px-4 py-3">
          <p className="text-[13px] text-zinc-200 whitespace-pre-wrap break-words">{h.display}</p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <HomeSourceLabel source={h} providers={providers} />
            <span className="text-xs text-zinc-500" title={h.cwd || undefined}>
              {h.cwd ? shortPath(h.cwd) : 'Folder not recorded'}
            </span>
            <span className="text-xs text-zinc-500">{h.ts ? fmtRelative(h.ts) : 'Time not recorded'}</span>
          </div>
        </div>
      ))}
      {!data.history.length && <p className="text-sm text-zinc-500 py-6">No recorded prompts match this scope and search.</p>}
    </div>
  )
}
function ResourceGroup({
  entry,
  source,
  providers,
  onSelect,
}: {
  entry: ResourceEntry
  source: HomeSource
  providers: readonly UIProvider[]
  onSelect: HomeSelect
}) {
  return (
    <details className="rounded-lg border border-zinc-800 bg-ink-900">
      <summary className="cursor-pointer px-4 py-3 text-sm">
        <HomeSourceLabel source={source} providers={providers} />
        <span className="text-xs text-zinc-500 ml-2">User scope · {entry.items.reduce((n, g) => n + g.names.length, 0)} resources</span>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-xs text-zinc-500 break-all">{entry.base}</p>
        {entry.items
          .filter((g) => g.names.length)
          .map((g) => (
            <div key={g.label}>
              <h4 className="text-xs text-zinc-400 mb-1">
                {g.label} · {g.names.length}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {g.names.map((name, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Provider resource names may repeat; these are stateless labels in a complete snapshot.
                  <span key={`${name}:${i}`} className="text-xs text-zinc-300 bg-ink-700 px-2 py-1 rounded break-all">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        {!entry.items.some((g) => g.names.length) && <p className="text-xs text-zinc-500">No resources reported in this scope.</p>}
        <p className="text-xs text-zinc-500">User-level resources may affect other folders. Changes apply only to this source.</p>
        <button type="button" className={button} onClick={() => onSelect({ ownedSource: homeSourceKey(source) })}>
          {entry.readOnly ? 'View' : 'Open'} user resources ›
        </button>
      </div>
    </details>
  )
}
export function IntegratedResources({ data, providers, onSelect }: { data: HomeResourcesReport; providers: readonly UIProvider[]; onSelect: HomeSelect }) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">
        Inventory from disk, not proof of what a running session loaded. Resources are never merged or written across sources.
      </p>
      {['user'].map((scope) => (
        <section key={scope} className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-zinc-400">User resources · May affect other folders</h3>
          {data.sources.flatMap((s) =>
            s.entries
              .filter((e: { scope: string }) => e.scope === scope)
              .map((e) => <ResourceGroup key={resourceEntryKey(s, scope, e.project?.slug)} entry={e} source={s} providers={providers} onSelect={onSelect} />)
          )}
          {!data.sources.some((s: { entries: { scope: string }[] }) => s.entries.some((e: { scope: string }) => e.scope === scope)) && (
            <p className="text-xs text-zinc-500">No available {scope} resources in this scope.</p>
          )}
        </section>
      ))}
    </div>
  )
}
export function IntegratedPlugins({ data, providers, onSelect }: { data: HomePluginsReport; providers: readonly UIProvider[]; onSelect: HomeSelect }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Installed in associated sources. Installation and enabled state do not confirm that a running session loaded a plugin.
      </p>
      {data.sources.map((s) => (
        <section key={homeSourceKey(s)} className="rounded-lg border border-zinc-800 bg-ink-900 p-4">
          <HomeSourceLabel source={s} providers={providers} />
          {(s.data.installed || []).map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Providers may report duplicate plugin names without installation IDs; cards have no local state.
            <div key={`${p.name}:${i}`} className="mt-3 pt-3 border-t border-zinc-800">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">
                <span>{p.displayName || p.name}</span>
                {p.version && <span className="text-xs text-zinc-500">v{p.version}</span>}
                <span className="text-[11px] text-zinc-500">
                  {p.enabled === true ? 'Enabled' : p.enabled === false ? 'Disabled' : 'Enabled state not reported'}
                </span>
              </div>
              {p.description && <p className="text-xs text-zinc-500 mt-1">{p.description}</p>}
              <div className="text-xs text-zinc-500 mt-1">{[p.scope, p.marketplace, p.source].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
          {!s.data.installed?.length && <p className="text-xs text-zinc-500 mt-3">No installed plugins reported.</p>}
          {s.data.marketplaces?.length > 0 && <p className="text-xs text-zinc-500 mt-3">Marketplaces: {s.data.marketplaces.map((m) => m.name).join(' · ')}</p>}
          <button type="button" className={`${button} mt-3`} onClick={() => onSelect({ ownedSource: homeSourceKey(s) })}>
            View source plugins ›
          </button>
        </section>
      ))}
    </div>
  )
}

export default function IntegratedHomePage({
  view,
  scope,
  showUnavailable,
  providers,
  visible,
  onOpen,
}: {
  view: string
  scope: unknown
  showUnavailable?: boolean
  providers: readonly UIProvider[]
  visible?: boolean
  onOpen: HomeOpen
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('')
  const [navigation, setNavigation] = useState<HomeSelection | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestKey = homeQuery(view, scope, { search: view === 'history' ? query : '' })
  const selection = navigation?.key === requestKey ? navigation : {}
  const onSelect = (next: HomeSelection) => setNavigation({ ...next, key: requestKey })
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scope or in-page navigation changes intentionally reset scroll, even without reading either value.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [requestKey, navigation])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250)
    return () => clearTimeout(timer)
  }, [search])
  const { data, error, busy, moreBusy, refresh, loadMore } = useHomeReport(view, scope, { enabled: visible, search: view === 'history' ? query : '' })
  const owned = ['plugins', 'resources'].includes(view) && data?.sources.find((s) => homeSourceKey(s) === selection.ownedSource)
  if (owned) {
    const Page = providers.find((p: { id: string }) => p.id === owned.provider)?.homePages?.[view]
    return (
      <div className="h-full min-w-0 flex flex-col">
        <div className="shrink-0 flex flex-wrap items-center gap-3 px-6 py-3 border-b border-zinc-800 text-sm">
          <button type="button" className={link} onClick={() => onSelect({})}>
            ← {view === 'plugins' ? 'Plugins' : 'Resources'}
          </button>
          <HomeSourceLabel source={owned} providers={providers} />
          {view === 'resources' && <span className="text-xs text-zinc-500">User scope · May affect other folders</span>}
        </div>
        <div className={`flex-1 min-h-0 min-w-0 ${view === 'plugins' ? 'overflow-y-auto' : ''}`}>
          {Page ? (
            <Page
              key={homeViewKey(view, homeSourceKey(owned))}
              root={owned.root}
              onOpen={(target) => onOpen(owned.provider, { ...target, root: owned.root, rootLabel: owned.rootLabel })}
            />
          ) : (
            <p role="status" className="p-6 text-sm text-zinc-500">
              This provider has no detailed {view} page.
            </p>
          )}
        </div>
      </div>
    )
  }
  return (
    <div ref={scrollRef} className="h-full min-w-0 overflow-y-auto px-6 py-5">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="ml-auto text-xs text-zinc-500">
            {data
              ? `${data.scope.sources.length} ${data.scope.sources.length === 1 ? 'source' : 'sources'} · captured ${fmtRelative(data.capturedAt)}`
              : 'Reading sources…'}
          </span>
          <button type="button" className={button} disabled={busy || moreBusy} onClick={refresh}>
            Refresh
          </button>
        </div>
        {view === 'history' && (
          <input
            aria-label="Search scoped prompt history"
            placeholder="Search prompt history…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 bg-ink-700 border border-zinc-700 rounded text-sm text-zinc-200"
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {busy && !data && (
          <p role="status" className="text-sm text-zinc-500">
            Reading selected sources…
          </p>
        )}
        {data && (
          <>
            {(data.errors.length > 0 || data.notices.length > 0) && (
              <details className="rounded border border-amber-600/30 px-3 py-2">
                <summary className="cursor-pointer text-xs text-amber-200">
                  Partial coverage · {data.errors.length + data.notices.length} source notices
                </summary>
                <div className="mt-2 space-y-2">
                  {[...data.errors, ...data.notices].map((e, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Notices are stateless snapshot text and can contain identical messages.
                    <p key={i} className="text-xs text-zinc-400">
                      <HomeSourceLabel source={e} providers={providers} /> · {'folder' in e && e.folder ? `${e.folder}: ` : ''}
                      {'error' in e ? e.error : errorMessage(e)}
                    </p>
                  ))}
                </div>
              </details>
            )}
            {!data.scope.sources.length ? (
              <p className="text-sm text-zinc-500 py-8">No sources in this scope. Include a provider to see its registered roots.</p>
            ) : data.sources?.length === 0 && data.errors.length > 0 ? (
              <p className="text-sm text-zinc-500 py-8">No readable sources for this page. See the source notices above.</p>
            ) : (
              <>
                {view === 'stats' && (
                  <IntegratedStats
                    data={data as HomeStatsReport}
                    providers={providers}
                    showUnavailable={showUnavailable}
                    selection={selection}
                    onSelect={onSelect}
                    onOpen={onOpen}
                  />
                )}
                {view === 'history' && (
                  <>
                    <p className="text-xs text-zinc-500">
                      {data.history.length} of {(data as HomeHistoryReport).total} recorded prompts · Native prompt history; not the full transcript
                    </p>
                    <IntegratedHistory data={data as HomeHistoryReport} providers={providers} />
                    {data.nextCursor && (
                      <button
                        type="button"
                        className={button}
                        disabled={moreBusy || busy}
                        onClick={() => {
                          loadMore()
                        }}
                      >
                        {moreBusy ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </>
                )}
                {view === 'insights' && (
                  <>
                    <p className="text-xs text-zinc-500">
                      Main conversations only. Active days are counted once across sources; activity is attributed to each conversation’s last active day.
                    </p>
                    <IntegratedInsights data={data as HomeInsightsReport} />
                  </>
                )}
                {view === 'plugins' && <IntegratedPlugins data={data as HomePluginsReport} providers={providers} onSelect={onSelect} />}
                {view === 'resources' && <IntegratedResources data={data as HomeResourcesReport} providers={providers} onSelect={onSelect} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
