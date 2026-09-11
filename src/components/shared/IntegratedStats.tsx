import type { UIProvider } from '../../providers/views.ts'
import type { HomeStatsReport, HomeStatsSource, HomeStatsFolder, HomeStatsTotals } from '../../api/models.ts'
import type { HomeSelect, HomeSelection, HomeOpen } from './IntegratedHomePage.tsx'
import { homeProjectKey, homeSourceKey } from '../../../shared/identity.ts'
import { shortPath } from '../../lib/paths.ts'
import { fmtTokens } from '../../lib/format.ts'
import { HomeSourceLabel, homeSourceLinkClass as link } from './HomeSourceLabel.tsx'

const statsProjectKey = (s: HomeStatsSource) => homeProjectKey({ ...s, slug: s.stats?.slug ?? s.slug })
const folderLabel = (f: { cwd: string | null }) => (f.cwd ? shortPath(f.cwd) : 'Folder not recorded')
function FolderCrumbs({
  view,
  folder,
  source,
  providers,
  onSelect,
}: {
  view: string
  folder: HomeStatsFolder
  source?: HomeStatsSource | null
  providers: readonly UIProvider[]
  onSelect: HomeSelect
}) {
  return (
    <>
      <button type="button" className={link} onClick={() => onSelect({})}>
        {view === 'stats' ? 'Stats' : 'Insights'}
      </button>
      <span className="text-zinc-600">/</span>
      <button type="button" className={source ? link : 'text-zinc-200 break-words'} onClick={() => onSelect({ folder: folder.id })}>
        {folderLabel(folder)}
      </button>
      {source && (
        <>
          <span className="text-zinc-600">/</span>
          <HomeSourceLabel source={source} providers={providers} />
        </>
      )}
    </>
  )
}
function FolderRows({ folders, onSelect }: { folders: HomeStatsFolder[]; onSelect: HomeSelect }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-ink-900">
      {folders.map((f) => (
        <button
          type="button"
          key={f.id}
          onClick={() => onSelect({ folder: f.id })}
          className="w-full min-w-0 text-left flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-ink-800 border-b border-zinc-800 last:border-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-zinc-200" title={f.cwd || undefined}>
              {folderLabel(f)}
            </span>
            <span className="text-xs text-zinc-500">{f.sources?.length || 0} sources</span>
          </span>
          <span className="text-xs text-zinc-500">{f.sessions} sessions</span>
          <span className="text-zinc-600">›</span>
        </button>
      ))}
      {!folders.length && <p className="p-4 text-sm text-zinc-500">No visible folders in this scope.</p>}
    </div>
  )
}
function Metric({ value, label, hint }: { value?: React.ReactNode; label: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-ink-900 p-3">
      <div className="text-2xl text-zinc-100 tabular-nums">{value ?? '—'}</div>
      <div className="text-xs text-zinc-400 mt-1">{label}</div>
      {hint && <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>}
    </div>
  )
}
export function IntegratedStats({
  data,
  providers,
  showUnavailable = false,
  selection = {},
  onSelect,
  onOpen,
}: {
  data: HomeStatsReport
  providers: readonly UIProvider[]
  showUnavailable?: boolean
  selection?: HomeSelection
  onSelect: HomeSelect
  onOpen: HomeOpen
}) {
  const folders = (data.folders || []).filter((f) => f.resolved || showUnavailable)
  const folder = (data.folders || []).find((f) => f.id === selection.folder)
  // Count selected roots, not successful responses: an unreadable second root
  // must remain visible as partial coverage, not masquerade as a native scope.
  const soleRoot =
    !folder && data.scope?.sources.length === 1
      ? data.sources.find((s: { provider: string; root: string }) => homeSourceKey(s) === homeSourceKey(data.scope.sources[0]))
      : null
  const RootPage = soleRoot && providers.find((p) => p.id === soleRoot.provider)?.homePages?.stats
  if (RootPage && soleRoot)
    return (
      <RootPage
        key={homeSourceKey(soleRoot)}
        embedded
        root={soleRoot.root}
        onOpen={(target) => onOpen(soleRoot.provider, { ...target, root: soleRoot.root, rootLabel: soleRoot.rootLabel })}
      />
    )
  const selected = folder?.sources.find((s) => statsProjectKey(s) === selection.source) || (folder?.sources.length === 1 ? folder.sources[0] : null)
  if (selected && folder) {
    const Page = providers.find((p) => p.id === selected.provider)?.homePages?.stats
    const breadcrumb = <FolderCrumbs view="stats" folder={folder} source={selected} providers={providers} onSelect={onSelect} />
    return Page ? (
      <Page
        key={statsProjectKey(selected)}
        embedded
        root={selected.root}
        initialProject={selected.stats.slug}
        breadcrumbPrefix={breadcrumb}
        onOpen={(target) =>
          onOpen(selected.provider, { ...target, root: selected.root, rootLabel: selected.rootLabel, slug: selected.stats.slug, cwd: selected.stats.cwd })
        }
      />
    ) : (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">{breadcrumb}</div>
        <p role="status" className="text-sm text-zinc-500">
          This provider has no detailed Stats page.
        </p>
      </div>
    )
  }
  const totals: HomeStatsTotals = folder
    ? {
        ...(Object.fromEntries(
          (['sessions', 'subagentSessions', 'userTurns', 'toolCalls'] as const).map((k) => [k, folder.sources.reduce((n, s) => n + (s.stats[k] || 0), 0)])
        ) as Pick<HomeStatsTotals, 'sessions' | 'subagentSessions' | 'userTurns' | 'toolCalls'>),
        tokens: {
          total: folder.sources.some((s) => s.stats.tokens?.total != null) ? folder.sources.reduce((n, s) => n + (s.stats.tokens?.total || 0), 0) : null,
        },
      }
    : data.totals
  const coverage = data.coverage.total
  const partial = data.errors.length > 0 || data.notices.length > 0 || (coverage && coverage.available < coverage.sources)
  return (
    <div className="space-y-5">
      {folder && (
        <div className="flex flex-wrap gap-2 text-sm">
          <FolderCrumbs view="stats" folder={folder} providers={providers} onSelect={onSelect} />
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric value={totals.sessions} label="Main sessions" hint={`${totals.subagentSessions} independent subagent sessions`} />
        <Metric value={totals.userTurns} label="Recorded prompts" hint="Includes subagent turns where reported" />
        <Metric value={totals.toolCalls} label="Recorded tool calls" />
        <Metric
          value={totals.tokens.total == null ? '—' : fmtTokens(totals.tokens.total)}
          label={`Reported tokens${partial ? ' · partial' : ''}`}
          hint="Provider-reported accounting; not a cost estimate"
        />
      </div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500">
        {folder ? 'By source — click for full project stats' : 'By folder — click for source briefs'}
      </h3>
      {!folder ? (
        <>
          <p className="text-xs text-zinc-500">Hidden unavailable folders still contribute to the totals above.</p>
          <FolderRows folders={folders} onSelect={onSelect} />
        </>
      ) : (
        <div className="space-y-3">
          {folder.sources.map((s) => (
            <button
              type="button"
              key={statsProjectKey(s)}
              onClick={() => onSelect({ folder: folder.id, source: statsProjectKey(s) })}
              className="w-full text-left rounded-lg border border-zinc-800 bg-ink-900 hover:bg-ink-800 p-4"
            >
              <HomeSourceLabel source={s} providers={providers} />
              <p className="text-xs text-zinc-400 mt-1">
                {s.stats.sessions} sessions · {s.stats.userTurns || 0} prompts · {s.stats.toolCalls || 0} tool calls ·{' '}
                {s.stats.tokens?.total == null ? 'Tokens not reported' : fmtTokens(s.stats.tokens.total) + ' tokens'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">Tools, models, token fields and session details ›</p>
              {s.note && <p className="text-xs text-zinc-500 mt-1">{s.note}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
