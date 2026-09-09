import { useEffect, useState } from 'react'
import { deckApi, openDeckView, endDashboard } from '../../lib/deckApi.js'
import useConfirm from '../../lib/useConfirm.jsx'

export default function LiveDashboards({ onOpen, onCreate }) {
  const [confirmEl, confirm] = useConfirm()
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(0)
  useEffect(() => {
    let stale = false
    const refresh = () => deckApi('dashboards').then((r) => { if (!stale) { setData(r); setError('') } }).catch((e) => { if (!stale) setError(e.message) })
    refresh()
    const ended = (e) => { stale = true; setData((d) => d && ({ ...d, dashboards: d.dashboards.filter((x) => x.id !== e.detail.id) })); setTick((n) => n + 1) }
    window.addEventListener('agentdeck:dashboard-ended', ended)
    const timer = setInterval(refresh, 10000)
    return () => { stale = true; clearInterval(timer); window.removeEventListener('agentdeck:dashboard-ended', ended) }
  }, [tick])
  const end = async (id) => {
    if (!await confirm({ title: 'End this dashboard?', message: 'The dashboard and its tracking file will be removed. Original agent terminals keep running.', confirmLabel: 'End dashboard' })) return
    setBusy(true)
    try { await endDashboard(id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className="space-y-3">
    {confirmEl}
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-zinc-500">Existing tmux layouts · source agents stay running</span><button onClick={onCreate} className="text-xs text-sky-300">New dashboard</button></div>
    {error && <p role="alert" className="text-xs text-red-300">{error} <button onClick={() => setTick((n) => n + 1)}>Retry</button></p>}
    {!data && !error && <p role="status" className="text-xs text-zinc-500">Loading dashboards…</p>}
    {data?.capability?.reason && <p className="text-xs text-zinc-500">{data.capability.reason}</p>}
    {data && !data.dashboards.length && <p className="text-sm text-zinc-400 py-4">No dashboards yet. Select 2–4 live sessions to create one.</p>}
    {data?.dashboards.map((d) => <div key={d.id} className="flex gap-3 items-center border border-zinc-700 rounded-lg p-3">
      <button disabled={!d.running} className="flex-1 min-w-0 text-left disabled:opacity-50" onClick={() => { openDeckView({ kind: 'dashboard', dashboardId: d.id, title: d.title }); onOpen() }}>
        <span className="block text-sm text-zinc-200 truncate">{d.title}</span>
        <span className="block text-xs text-zinc-500">{d.sources.length} sessions · {d.running ? 'running' : 'ended / unavailable'}</span>
      </button>
      <button className="text-xs text-red-300" disabled={busy} onClick={() => end(d.id)}>End dashboard</button>
    </div>)}
  </div>
}
