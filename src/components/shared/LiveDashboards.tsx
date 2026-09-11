import { errorMessage } from '../../lib/errors.ts'
import { useState } from 'react'
import { useDashboards } from '../../api/index.ts'
import { useDashboardActions } from '../../lib/useDashboardActions.ts'
import useConfirm from '../../lib/useConfirm.tsx'

export default function LiveDashboards({ onOpen, onCreate }: { onOpen: () => void; onCreate: () => void }) {
  const { openDeckView, endDashboard } = useDashboardActions()
  const [confirmEl, confirm] = useConfirm()
  const { data, error: queryError, refetch } = useDashboards()
  const [actionError, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const error = actionError || queryError?.message || ''
  const end = async (id: string) => {
    if (
      !(await confirm({
        title: 'End this dashboard?',
        message: 'The dashboard and its tracking file will be removed. Original agent terminals keep running.',
        confirmLabel: 'End dashboard',
      }))
    )
      return
    setBusy(true)
    try {
      await endDashboard(id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      {confirmEl}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-500">Existing tmux layouts · source agents stay running</span>
        <button type="button" onClick={onCreate} className="text-xs text-sky-300">
          New dashboard
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null)
              refetch()
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!data && !error && (
        <p role="status" className="text-xs text-zinc-500">
          Loading dashboards…
        </p>
      )}
      {data?.capability?.reason && <p className="text-xs text-zinc-500">{data.capability.reason}</p>}
      {data && !data.dashboards.length && <p className="text-sm text-zinc-400 py-4">No dashboards yet. Select 2–4 live sessions to create one.</p>}
      {data?.dashboards.map((d) => (
        <div key={d.id} className="flex gap-3 items-center border border-zinc-700 rounded-lg p-3">
          <button
            type="button"
            disabled={!d.running}
            className="flex-1 min-w-0 text-left disabled:opacity-50"
            onClick={() => {
              openDeckView({ kind: 'dashboard', dashboardId: d.id, title: d.title })
              onOpen()
            }}
          >
            <span className="block text-sm text-zinc-200 truncate">{d.title}</span>
            <span className="block text-xs text-zinc-500">
              {d.sources.length} sessions · {d.running ? 'running' : 'ended / unavailable'}
            </span>
          </button>
          <button type="button" className="text-xs text-red-300" disabled={busy} onClick={() => end(d.id)}>
            End dashboard
          </button>
        </div>
      ))}
    </div>
  )
}
