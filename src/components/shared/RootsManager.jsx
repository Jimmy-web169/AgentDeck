import { useState } from 'react'
import { FolderIcon } from './icons.jsx'
import useEscToClose from '../../lib/useEscToClose.js'

// Tracked-folder editor. `RootsEditor` is the inline list + add form (used by
// Home › Folders, one per provider); the default export wraps it in a modal.
// Provider copy is parameterized; defaults preserve claude behavior.
// `rootStatusField` selects which boolean on a root marks "has history"
// (claude: hasProjects, codex: hasSessions).
export function RootsEditor({
  roots,
  apiClient,
  onChanged,
  rootStatusField = 'hasProjects',
  pathPlaceholder = '/path/to/.claude  or  ~/my-project',
  hasHistoryLabel = 'has history',
  noHistoryLabel = 'no history (config only)',
}) {
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const add = async () => {
    if (!path.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await apiClient.addRoot(path.trim(), label.trim())
      setPath('')
      setLabel('')
      await onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    setBusy(true)
    setErr(null)
    try {
      await apiClient.removeRoot(id)
      await onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="space-y-2">
        {roots.map((r) => (
          <div key={r.id} className="flex items-center gap-3 bg-ink-700/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-zinc-200 truncate">{r.label}</div>
              <div className="text-[11px] text-zinc-500 font-mono truncate">{r.dir}</div>
              <div className="text-[10.5px] mt-0.5 flex gap-2">
                <span className={r.exists ? 'text-emerald-400' : 'text-red-400'}>{r.exists ? 'exists' : 'missing'}</span>
                <span className={r[rootStatusField] ? 'text-sky-400' : 'text-zinc-600'}>{r[rootStatusField] ? hasHistoryLabel : noHistoryLabel}</span>
              </div>
            </div>
            <button
              onClick={() => remove(r.id)}
              disabled={busy}
              title="Stop tracking this folder. Does NOT delete it from disk."
              className="text-[11px] px-2 py-1 rounded bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/25 disabled:opacity-40"
            >
              untrack
            </button>
          </div>
        ))}
        {roots.length === 0 && <div className="text-[12px] text-zinc-600">No folders tracked yet — add one below.</div>}
      </div>

      <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">Add a folder (type a path)</div>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={pathPlaceholder}
          className="w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 font-mono placeholder-zinc-600"
        />
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="label (optional)"
            className="flex-1 bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600"
          />
          <button onClick={add} disabled={busy || !path.trim()} className="px-4 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-[13px] disabled:opacity-40">
            {busy ? '…' : 'Add'}
          </button>
        </div>
        {err && <div className="text-[12px] text-red-300">{err}</div>}
        <div className="text-[11px] text-zinc-600">
          <span className="text-zinc-400">untrack</span> only removes a folder from this list — it never deletes anything on disk.
        </div>
      </div>
    </div>
  )
}

export default function RootsManager({ onClose, title = 'Tracked folders', ...rest }) {
  useEscToClose(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[560px] max-w-[92vw] bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold">
            <FolderIcon /> {title}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <RootsEditor {...rest} />
        </div>
      </div>
    </div>
  )
}
