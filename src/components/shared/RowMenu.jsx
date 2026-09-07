import { useEffect, useRef, useState } from 'react'
import { addToWorkspace, createWorkspace, inWorkspace, removeFromWorkspace } from '../../lib/workspaces.js'
import { ACCENTS, accentClasses } from '../../lib/providerColors.js'
import { PlusIcon } from './shellIcons.jsx'

// The "⋯" menu of a sidebar row. Every row gets the same two hover controls —
// pin and ⋯ — and everything else lives in here: workspace membership toggles
// (for a project or a session) and row-specific actions. Destructive actions
// confirm in the centered dialog (useConfirm), never inline.
//
//   items: [{ label, onClick, danger, disabled }]
//   workspaceItem: the project / session to toggle in workspaces (optional)
//   swatches: { value, onPick } — a row of accent swatches (a workspace's colour)
export default function RowMenu({ open, onClose, items = [], workspaceItem, workspaces = [], swatches = null }) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => void (onCloseRef.current = onClose), [onClose])

  useEffect(() => {
    if (!open) return
    setCreating(false)
    setName('')
    const off = (e) => !ref.current?.contains(e.target) && onCloseRef.current()
    const key = (e) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  if (!open) return null

  const create = () => {
    if (!name.trim() || !workspaceItem) return
    createWorkspace(name, [workspaceItem])
    onClose()
  }
  const row = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-ink-600 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div ref={ref} onMouseDown={(e) => e.stopPropagation()} className="absolute right-2 top-full z-30 mt-0.5 w-60 rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl py-1">
      {items.map((it) => (
        <button
          key={it.label}
          disabled={it.disabled}
          onClick={() => {
            onClose()
            it.onClick()
          }}
          className={`${row} ${it.danger ? 'text-red-300 hover:text-red-200' : ''}`}
        >
          {it.label}
        </button>
      ))}
      {swatches && (
        <>
          {items.length > 0 && <div className="my-1 border-t border-zinc-800" />}
          <div className="px-3 pt-1 pb-0.5 text-[10.5px] uppercase tracking-wider text-zinc-600">Colour</div>
          <div className="flex items-center gap-1.5 px-3 pb-1.5">
            {ACCENTS.map((a) => {
              const on = swatches.value === a.k
              return (
                <button
                  key={a.k}
                  onClick={() => {
                    swatches.onPick(on ? null : a.k)
                    onClose()
                  }}
                  title={on ? `${a.label} — click to clear` : a.label}
                  className={`w-4 h-4 rounded-full ${accentClasses(a.k).dot} ${on ? 'ring-2 ring-zinc-100 ring-offset-1 ring-offset-ink-800' : 'opacity-70 hover:opacity-100'}`}
                />
              )
            })}
          </div>
        </>
      )}
      {workspaceItem && (
        <>
          {(items.length > 0 || swatches) && <div className="my-1 border-t border-zinc-800" />}
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
