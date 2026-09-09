import { useEffect, useRef, useState } from 'react'
import { deckApi } from '../../lib/deckApi.js'
import { homeQuery } from '../../lib/homeScope.js'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import { shortPath } from '../../lib/paths.js'
import { fmtRelative, fmtTokens } from '../../lib/format.js'
import InsightsPage from './InsightsPage.jsx'

const button = 'px-3 py-1.5 rounded border border-zinc-700 bg-ink-700 text-xs text-zinc-200 hover:bg-ink-600 disabled:opacity-40'
const keyOf = (s) => JSON.stringify([s.provider, s.root])
const projectKey = (s) => JSON.stringify([s.provider, s.root, s.stats?.slug ?? s.slug])
const folderLabel = (f) => f.cwd ? shortPath(f.cwd) : 'Folder not recorded'
const link = 'text-sky-400 hover:underline text-left break-words'
function FolderCrumbs({ view, folder, source, providers, onSelect }) {
  return <><button className={link} onClick={() => onSelect({})}>{view === 'stats' ? 'Stats' : 'Insights'}</button>
    <span className="text-zinc-600">/</span><button className={source ? link : 'text-zinc-200 break-words'} onClick={() => onSelect({ folder: folder.id })}>{folderLabel(folder)}</button>
    {source && <><span className="text-zinc-600">/</span><HomeSourceLabel source={source} providers={providers} /></>}
  </>
}
function FolderRows({ folders, view, onSelect }) {
  return <div className="rounded-lg border border-zinc-800 bg-ink-900">{folders.map((f) => <button key={f.id} onClick={() => onSelect({ folder: f.id })} className="w-full min-w-0 text-left flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-ink-800 border-b border-zinc-800 last:border-0">
    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-zinc-200" title={f.cwd}>{folderLabel(f)}</span><span className="text-xs text-zinc-500">{f.sources?.length || 0} sources</span></span>
    <span className="text-xs text-zinc-500">{view === 'stats' ? f.sessions : f.activity?.totals.sessions} sessions</span><span className="text-zinc-600">›</span>
  </button>)}{!folders.length && <p className="p-4 text-sm text-zinc-500">No visible folders in this scope.</p>}</div>
}
export function HomeSourceLabel({ source, providers }) {
  return <span className={`text-xs ${providerColor(providers, source.provider).text}`}>{providerLabel(providers, source.provider)} <span className="text-zinc-500">/ {source.rootLabel || source.root}</span></span>
}
function Metric({ value, label, hint }) {
  return <div className="rounded-lg border border-zinc-800 bg-ink-900 p-3"><div className="text-2xl text-zinc-100 tabular-nums">{value ?? '—'}</div><div className="text-xs text-zinc-400 mt-1">{label}</div>{hint && <div className="text-[11px] text-zinc-500 mt-1">{hint}</div>}</div>
}
export function IntegratedStats({ data, providers, showUnavailable = false, selection = {}, onSelect, onOpen }) {
  const folders = (data.folders || []).filter((f) => f.resolved || showUnavailable)
  const folder = (data.folders || []).find((f) => f.id === selection.folder)
  // Count selected roots, not successful responses: an unreadable second root
  // must remain visible as partial coverage, not masquerade as a native scope.
  const soleRoot = !folder && data.scope?.sources.length === 1
    ? data.sources.find((s) => keyOf(s) === keyOf(data.scope.sources[0])) : null
  const RootPage = soleRoot && providers.find((p) => p.id === soleRoot.provider)?.homePages?.stats
  if (RootPage) return <RootPage key={keyOf(soleRoot)} embedded root={soleRoot.root}
    onOpen={(target) => onOpen(soleRoot.provider, { ...target, root: soleRoot.root, rootLabel: soleRoot.rootLabel })} />
  const selected = folder?.sources.find((s) => projectKey(s) === selection.source) || (folder?.sources.length === 1 ? folder.sources[0] : null)
  if (selected) {
    const Page = providers.find((p) => p.id === selected.provider)?.homePages?.stats
    const breadcrumb = <FolderCrumbs view="stats" folder={folder} source={selected} providers={providers} onSelect={onSelect} />
    return Page ? <Page key={projectKey(selected)} embedded root={selected.root} initialProject={selected.stats.slug} breadcrumbPrefix={breadcrumb}
      onOpen={(target) => onOpen(selected.provider, { ...target, root: selected.root, rootLabel: selected.rootLabel, slug: selected.stats.slug, cwd: selected.stats.cwd })} /> : <div className="space-y-4"><div className="flex flex-wrap gap-2 text-sm">{breadcrumb}</div><p role="status" className="text-sm text-zinc-500">This provider has no detailed Stats page.</p></div>
  }
  const totals = folder ? {
    ...Object.fromEntries(['sessions', 'subagentSessions', 'userTurns', 'toolCalls'].map((k) => [k, folder.sources.reduce((n, s) => n + (s.stats[k] || 0), 0)])),
    tokens: { total: folder.sources.some((s) => s.stats.tokens?.total != null) ? folder.sources.reduce((n, s) => n + (s.stats.tokens?.total || 0), 0) : null },
  } : data.totals
  const coverage = data.coverage.total
  const partial = data.errors.length > 0 || data.notices.length > 0 || (coverage && coverage.available < coverage.sources)
  return <div className="space-y-5">
    {folder && <div className="flex flex-wrap gap-2 text-sm"><FolderCrumbs view="stats" folder={folder} providers={providers} onSelect={onSelect} /></div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Metric value={totals.sessions} label="Main sessions" hint={`${totals.subagentSessions} independent subagent sessions`} />
      <Metric value={totals.userTurns} label="Recorded prompts" hint="Includes subagent turns where reported" />
      <Metric value={totals.toolCalls} label="Recorded tool calls" />
      <Metric value={totals.tokens.total == null ? '—' : fmtTokens(totals.tokens.total)} label={`Reported tokens${partial ? ' · partial' : ''}`} hint="Provider-reported accounting; not a cost estimate" />
    </div>
    <h3 className="text-xs uppercase tracking-wide text-zinc-500">{folder ? 'By source — click for full project stats' : 'By folder — click for source briefs'}</h3>
    {!folder ? <><p className="text-xs text-zinc-500">Hidden unavailable folders still contribute to the totals above.</p><FolderRows folders={folders} view="stats" onSelect={onSelect} /></> : <div className="space-y-3">{folder.sources.map((s) => <button key={projectKey(s)} onClick={() => onSelect({ folder: folder.id, source: projectKey(s) })} className="w-full text-left rounded-lg border border-zinc-800 bg-ink-900 hover:bg-ink-800 p-4">
        <HomeSourceLabel source={s} providers={providers} />
        <p className="text-xs text-zinc-400 mt-1">{s.stats.sessions} sessions · {s.stats.userTurns || 0} prompts · {s.stats.toolCalls || 0} tool calls · {s.stats.tokens?.total == null ? 'Tokens not reported' : fmtTokens(s.stats.tokens.total) + ' tokens'}</p>
        <p className="text-xs text-zinc-500 mt-1">Tools, models, token fields and session details ›</p>
        {s.note && <p className="text-xs text-zinc-500 mt-1">{s.note}</p>}
      </button>)}</div>}
  </div>
}
export function IntegratedInsights({ data }) {
  // The same complete rhythm report as Provider mode, without a second folder
  // dashboard. Needs attention remains part of the original report.
  return <InsightsPage embedded data={data.activity} />
}
export function IntegratedHistory({ data, providers }) {
  return <div className="space-y-2">{data.history.map((h) => <div key={h.key} className="rounded-lg border border-zinc-800 bg-ink-900 px-4 py-3">
    <p className="text-[13px] text-zinc-200 whitespace-pre-wrap break-words">{h.display}</p>
    <div className="flex flex-wrap items-center gap-3 mt-2"><HomeSourceLabel source={h} providers={providers} /><span className="text-xs text-zinc-500" title={h.cwd}>{h.cwd ? shortPath(h.cwd) : 'Folder not recorded'}</span><span className="text-xs text-zinc-500">{h.ts ? fmtRelative(h.ts) : 'Time not recorded'}</span>
    </div>
  </div>)}{!data.history.length && <p className="text-sm text-zinc-500 py-6">No recorded prompts match this scope and search.</p>}</div>
}
function ResourceGroup({ entry, source, providers, onSelect }) {
  return <details className="rounded-lg border border-zinc-800 bg-ink-900">
    <summary className="cursor-pointer px-4 py-3 text-sm"><HomeSourceLabel source={source} providers={providers} /><span className="text-xs text-zinc-500 ml-2">User scope · {entry.items.reduce((n, g) => n + g.names.length, 0)} resources</span></summary>
    <div className="px-4 pb-4 space-y-3">
      <p className="text-xs text-zinc-500 break-all">{entry.base}</p>
      {entry.items.filter((g) => g.names.length).map((g) => <div key={g.label}><h4 className="text-xs text-zinc-400 mb-1">{g.label} · {g.names.length}</h4><div className="flex flex-wrap gap-1.5">{g.names.map((name, i) => <span key={`${name}:${i}`} className="text-xs text-zinc-300 bg-ink-700 px-2 py-1 rounded break-all">{name}</span>)}</div></div>)}
      {!entry.items.some((g) => g.names.length) && <p className="text-xs text-zinc-500">No resources reported in this scope.</p>}
      <p className="text-xs text-zinc-500">User-level resources may affect other folders. Changes apply only to this source.</p>
      <button className={button} onClick={() => onSelect({ ownedSource: keyOf(source) })}>{entry.readOnly ? 'View' : 'Open'} user resources ›</button>
    </div>
  </details>
}
export function IntegratedResources({ data, providers, onSelect }) {
  return <div className="space-y-5">
    <p className="text-xs text-zinc-500">Inventory from disk, not proof of what a running session loaded. Resources are never merged or written across sources.</p>
    {['user'].map((scope) => <section key={scope} className="space-y-2"><h3 className="text-xs uppercase tracking-wide text-zinc-400">User resources · May affect other folders</h3>
      {data.sources.flatMap((s) => s.entries.filter((e) => e.scope === scope).map((e) => <ResourceGroup key={JSON.stringify([s.provider, s.root, scope, e.project?.slug])} entry={e} source={s} providers={providers} onSelect={onSelect} />))}
      {!data.sources.some((s) => s.entries.some((e) => e.scope === scope)) && <p className="text-xs text-zinc-500">No available {scope} resources in this scope.</p>}
    </section>)}
  </div>
}
export function IntegratedPlugins({ data, providers, onSelect }) {
  return <div className="space-y-3"><p className="text-xs text-zinc-500">Installed in associated sources. Installation and enabled state do not confirm that a running session loaded a plugin.</p>
    {data.sources.map((s) => <section key={keyOf(s)} className="rounded-lg border border-zinc-800 bg-ink-900 p-4"><HomeSourceLabel source={s} providers={providers} />
      {(s.data.installed || []).map((p, i) => <div key={`${p.name}:${i}`} className="mt-3 pt-3 border-t border-zinc-800"><div className="flex flex-wrap items-center gap-2 text-sm text-zinc-200"><span>{p.displayName || p.name}</span>{p.version && <span className="text-xs text-zinc-500">v{p.version}</span>}<span className="text-[11px] text-zinc-500">{p.enabled === true ? 'Enabled' : p.enabled === false ? 'Disabled' : 'Enabled state not reported'}</span></div>{p.description && <p className="text-xs text-zinc-500 mt-1">{p.description}</p>}<div className="text-xs text-zinc-500 mt-1">{[p.scope, p.marketplace, p.source].filter(Boolean).join(' · ')}</div></div>)}
      {!s.data.installed?.length && <p className="text-xs text-zinc-500 mt-3">No installed plugins reported.</p>}
      {s.data.marketplaces?.length > 0 && <p className="text-xs text-zinc-500 mt-3">Marketplaces: {s.data.marketplaces.map((m) => m.name).join(' · ')}</p>}
      <button className={`${button} mt-3`} onClick={() => onSelect({ ownedSource: keyOf(s) })}>View source plugins ›</button>
    </section>)}
  </div>
}

export default function IntegratedHomePage({ view, scope, showUnavailable, providers, visible, onOpen }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [revision, setRevision] = useState(0)
  const [navigation, setNavigation] = useState(null)
  const scrollRef = useRef(null)
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [moreBusy, setMoreBusy] = useState(false)
  const requestKey = homeQuery(view, scope, { showUnavailable, search: view === 'history' ? query : '' })
  const selection = navigation?.key === requestKey ? navigation : {}
  const onSelect = (next) => setNavigation({ ...next, key: requestKey })
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [requestKey, navigation])
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer) }, [search])
  useEffect(() => {
    if (!visible) return
    let stale = false
    setBusy(true); setError(''); setMoreBusy(false)
    deckApi(`home?${requestKey}${revision ? '&fresh=1' : ''}`).then((data) => { if (!stale) setResult({ key: requestKey, data }) }).catch((e) => { if (!stale) setError(e.message) }).finally(() => { if (!stale) setBusy(false) })
    return () => { stale = true }
  }, [requestKey, revision, visible])
  // Do not show old-scope content while its successor loads. Pagination is
  // cancelled logically by the effect token when scope/page changes.
  const data = result?.key === requestKey ? result.data : null
  useEffect(() => {
    let cancelled = false
    if (!moreBusy || !data?.nextCursor) return
    deckApi(`home?${requestKey}&cursor=${encodeURIComponent(data.nextCursor)}`).then((next) => {
      if (!cancelled) setResult((prev) => prev?.key === requestKey ? { key: requestKey, data: { ...next, history: [...prev.data.history, ...next.history] } } : prev)
    }).catch((e) => { if (!cancelled) setError(e.message) }).finally(() => { if (!cancelled) setMoreBusy(false) })
    return () => { cancelled = true }
  }, [moreBusy, requestKey])
  const refresh = () => { setResult(null); setRevision((n) => n + 1) }
  const owned = ['plugins', 'resources'].includes(view) && data?.sources.find((s) => keyOf(s) === selection.ownedSource)
  if (owned) {
    const Page = providers.find((p) => p.id === owned.provider)?.homePages?.[view]
    return <div className="h-full min-w-0 flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center gap-3 px-6 py-3 border-b border-zinc-800 text-sm"><button className={link} onClick={() => onSelect({})}>← {view === 'plugins' ? 'Plugins' : 'Resources'}</button><HomeSourceLabel source={owned} providers={providers} />{view === 'resources' && <span className="text-xs text-zinc-500">User scope · May affect other folders</span>}</div>
      <div className={`flex-1 min-h-0 min-w-0 ${view === 'plugins' ? 'overflow-y-auto' : ''}`}>
        {Page ? <Page key={`${view}|${keyOf(owned)}`} root={owned.root} onOpen={(target) => onOpen(owned.provider, { ...target, root: owned.root, rootLabel: owned.rootLabel })} /> : <p role="status" className="p-6 text-sm text-zinc-500">This provider has no detailed {view} page.</p>}
      </div>
    </div>
  }
  return <div ref={scrollRef} className="h-full min-w-0 overflow-y-auto px-6 py-5">
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3"><span className="ml-auto text-xs text-zinc-500">{data ? `${data.scope.sources.length} ${data.scope.sources.length === 1 ? 'source' : 'sources'} · captured ${fmtRelative(data.capturedAt)}` : 'Reading sources…'}</span><button className={button} disabled={busy || moreBusy} onClick={refresh}>Refresh</button></div>
      {view === 'history' && <input aria-label="Search scoped prompt history" placeholder="Search prompt history…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full px-3 py-2 bg-ink-700 border border-zinc-700 rounded text-sm text-zinc-200" />}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {busy && !data && <p role="status" className="text-sm text-zinc-500">Reading selected sources…</p>}
      {data && <>
        {(data.errors.length > 0 || data.notices.length > 0) && <details className="rounded border border-amber-600/30 px-3 py-2"><summary className="cursor-pointer text-xs text-amber-200">Partial coverage · {data.errors.length + data.notices.length} source notices</summary><div className="mt-2 space-y-2">{[...data.errors, ...data.notices].map((e, i) => <p key={i} className="text-xs text-zinc-400"><HomeSourceLabel source={e} providers={providers} /> · {e.folder ? `${e.folder}: ` : ''}{e.error || e.message}</p>)}</div></details>}
        {!data.scope.sources.length ? <p className="text-sm text-zinc-500 py-8">No sources in this scope. Include a provider to see its registered roots.</p> : data.sources?.length === 0 && data.errors.length > 0 ? <p className="text-sm text-zinc-500 py-8">No readable sources for this page. See the source notices above.</p> : <>
          {view === 'stats' && <IntegratedStats data={data} providers={providers} showUnavailable={showUnavailable} selection={selection} onSelect={onSelect} onOpen={onOpen} />}
          {view === 'history' && <><p className="text-xs text-zinc-500">{data.history.length} of {data.total} recorded prompts · Native prompt history; not the full transcript</p><IntegratedHistory data={data} providers={providers} onOpen={onOpen} />{data.nextCursor && <button className={button} disabled={moreBusy || busy} onClick={() => { setError(''); setMoreBusy(true) }}>{moreBusy ? 'Loading…' : 'Load more'}</button>}</>}
          {view === 'insights' && <>
            <p className="text-xs text-zinc-500">Main conversations only. Active days are counted once across sources; activity is attributed to each conversation’s last active day.</p>
            <IntegratedInsights data={data} />
          </>}
          {view === 'plugins' && <IntegratedPlugins data={data} providers={providers} onSelect={onSelect} />}
          {view === 'resources' && <IntegratedResources data={data} providers={providers} onSelect={onSelect} />}
        </>}
      </>}
    </div>
  </div>
}
