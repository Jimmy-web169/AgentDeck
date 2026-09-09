import { useEffect, useState } from 'react'
import { deckApi, endDashboard, announceDashboardEnd } from '../../lib/deckApi.js'
import { liveTarget } from '../../lib/tabs.js'
import useConfirm from '../../lib/useConfirm.jsx'

const btn = 'px-3 py-1.5 rounded bg-ink-600 hover:bg-ink-500 text-xs text-zinc-200 disabled:opacity-40'
export default function DashboardView({ dashboardId, onOpen }) {
  const [confirmEl, confirm] = useConfirm()
  const [data, setData] = useState(null), [url, setUrl] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(0)
  useEffect(() => {
    let stale = false
    setBusy(true); setError(''); setData(null); setUrl(null)
    const request = deckApi('dashboard/attach', { id: dashboardId })
    request.then((r) => { if (!stale) { setData(r.dashboard || r); setUrl(r.url || null) } }).catch((e) => { if (!stale) setError(e.message) }).finally(() => { if (!stale) setBusy(false) })
    return () => { stale = true } // tab closure detaches the viewer; it never Ends the dashboard
  }, [dashboardId, tick])
  const control = async (key) => {
    setBusy(true); setError('')
    try { setData(await deckApi('dashboard/control', { id: dashboardId, key })) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const end = async (id) => {
    if (!await confirm({ title: 'End this dashboard?', message: 'The dashboard and its tracking file will be removed. Original agent terminals keep running.', confirmLabel: 'End dashboard' })) return
    setBusy(true); setError('')
    try { await endDashboard(id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const remove = async (key) => {
    if (!await confirm({ title: 'Remove this viewer?', message: 'Its original agent keeps running. Removing the last viewer also removes the dashboard and its tracking file.', confirmLabel: 'Remove viewer' })) return
    setBusy(true); setError('')
    try { const next = await deckApi('dashboard/remove', { id: dashboardId, key }); if (next.endedAt) announceDashboardEnd(dashboardId); else setData(next) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className="h-full flex flex-col text-zinc-200">
    {confirmEl}
    <div className="shrink-0 border-b border-zinc-800 p-3 space-y-2">
      <div className="flex items-center gap-3"><h1 className="text-sm font-semibold flex-1">{data?.title || 'Live dashboards'} <span className="font-normal text-amber-300 text-xs">experimental</span></h1>
        <button className={btn} disabled={busy} onClick={() => setTick((n) => n + 1)}>Reconnect / refresh</button>
        {dashboardId && data && !data.endedAt && <button className={btn} disabled={busy} onClick={() => end(dashboardId)}>End dashboard only</button>}
      </div>
      <p className="text-xs text-zinc-500">Outer tmux prefix: Ctrl+A. Views ignore source resize; large source windows may be cropped. Closing this tab keeps the dashboard and agents running. Only one selected viewer can type; other external tmux clients are not locked.</p>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      {data?.error && <p role="status" className="text-xs text-amber-300">Container setup issue: {data.error}. End this container before creating a replacement.</p>}
      {busy && !data && <p role="status" className="text-xs text-zinc-400">Connecting to dashboard…</p>}
      {dashboardId && data?.sources && <div className="flex flex-wrap gap-2"><button className={btn} disabled={busy || !!data.endedAt} onClick={() => control(null)}>All read-only</button>{data.sources.map((s, i) => <div key={s.key} className="flex gap-1">
        <button className={`${btn} ${data.control === s.key ? 'ring-1 ring-sky-400' : ''}`} disabled={busy || !!data.endedAt} onClick={() => control(s.key)}>Control {i + 1} · {s.provider}</button>
        <button className={btn} onClick={() => onOpen(liveTarget(s))} title="Open original terminal, or focus its existing tab">↗</button>
        <button className={btn} disabled={busy || !!data.endedAt} onClick={() => remove(s.key)} title="Remove viewer only; keep source agent running">×</button>
      </div>)}</div>}
    </div>
    {dashboardId && url && !data?.endedAt && <iframe className="w-full flex-1 min-h-0 border-0" src={url} title="Live tmux dashboard" allow="clipboard-read; clipboard-write" />}
    {dashboardId && data?.endedAt && <div className="p-5 text-sm text-zinc-500">Dashboard ended. Source agents were not ended.</div>}
  </div>
}
