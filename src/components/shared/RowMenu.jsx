import { useEffect, useRef, useState } from 'react'
import { addToWorkspace, createWorkspace, inWorkspace, removeFromWorkspace } from '../../lib/workspaces.js'
import { PlusIcon } from './shellIcons.jsx'

// The "⋯" menu of a sidebar row. Every row gets the same two hover controls —
// pin and ⋯ — and everything else lives in here: workspace membership toggles
// (for a project or a session), plus row-specific actions such as "Select
// sessions…" or "Move to trash" (with an inline confirm).
//
//   items: [{ label, onClick, danger, confirm, disabled }]   confirm → two-step
//   workspaceItem: the project / session to toggle in workspaces (optional)
export default function RowMenu({ open, onClose, items = [], workspaceItem, workspaces = [] }) {
  const ref = useRef(null)
  const [confirming, setConfirming] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open) return
    setConfirming(null)
    setCreating(false)
    setName('')
    const off = (e) => !ref.current?.contains(e.target) && onClose()
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', key)
    }
  }, [open, onClose])
  if (!open) return null

  const create = () => {
    if (!name.trim() || !workspaceItem) return
    createWorkspace(name, [workspaceItem])
    onClose()
  }
  const row = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-ink-600 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div ref={ref} onMouseDown={(e) => e.stopPropagation()} className="absolute right-2 top-full z-30 mt-0.5 w-60 rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl py-1">
      {items.map((it) =>
        it.confirm && confirming === it.label ? (
          <div key={it.label} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px]">
            <span className="text-red-300 flex-1 truncate">{it.confirm}</span>
            <button
              onClick={() => {
                it.onClick()
                onClose()
              }}
              className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200"
            >
              yes
            </button>
            <button onClick={() => setConfirming(null)} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
          </div>
        ) : (
          <button
            key={it.label}
            disabled={it.disabled}
            onClick={() => {
              if (it.confirm) return setConfirming(it.label)
              it.onClick()
              onClose()
            }}
            className={`${row} ${it.danger ? 'text-red-300 hover:text-red-200' : ''}`}
          >
            {it.label}
          </button>
        )
      )}
      {workspaceItem && (
        <>
          {items.length > 0 && <div className="my-1 border-t border-zinc-800" />}
          <div className="px-3 pt-1 pb-0.5 text-[10.5px] uppercase tracking-wider text-zinc-600">Workspaces</div>
          {workspaces.map((w) => {
            const member = inWorkspace(w, workspaceItem)
            return (
              <button key={w.id} onClick={() => (member ? removeFromWorkspace(w.id, workspaceItem) : addToWorkspace(w.id, workspaceItem))} className={row}>
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] shrink-0 ${member ? 'bg-sky-500/30 border-sky-400 text-sky-100' : 'border-zinc-600'}`}>{member ? '✓' : ''}</span>
                <span className="truncate">{w.name}</span>
                <span className="ml-auto text-zinc-600">{w.items.length}</span>
              </button>
            )
          })}
          {!workspaces.length && <div className="px-3 py-1 text-[12px] text-zinc-600">No workspaces yet.</div>}
          <div className="px-2 pt-1">
            {creating ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' ? create() : e.key === 'Escape' ? onClose() : null)}
                  placeholder="Workspace name"
                  className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 placeholder-zinc-600"
                />
                <button onClick={create} disabled={!name.trim()} className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-[12px] disabled:opacity-40">Add</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-1 py-1.5 text-left text-[12px] text-sky-300 hover:text-sky-200">
                <PlusIcon className="w-3.5 h-3.5" /> New workspace with this…
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
