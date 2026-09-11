import type { ComponentProps, CSSProperties } from 'react'
import type { Workspace, WorkspaceItem } from '../../lib/workspaces.ts'
export interface MenuItem {
  label: string
  onClick?: () => unknown
  danger?: boolean
  disabled?: boolean
  children?: MenuItem[]
  key?: string
  sub?: string
  dot?: string
  tag?: string
  title?: string
}
interface RowMenuProps {
  open: boolean
  onClose: () => void
  items?: MenuItem[]
  workspaceItem?: WorkspaceItem | null
  workspaces?: Workspace[]
  accent?: Omit<ComponentProps<typeof AccentField>, 'label'> | null
  icon?: ComponentProps<typeof IconField> | null
  bounded?: boolean
  onWorkspaceChange?: (id: string, added: boolean) => void
}
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addToWorkspace, createWorkspace, inWorkspace, removeFromWorkspace } from '../../lib/workspaces.ts'
import AccentField from './AccentPicker.tsx'
import { IconField } from './workspaceIcons.tsx'
import { ChevronRightIcon, PlusIcon } from './shellIcons.tsx'
const useMenuLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

// The "⋯" menu of a sidebar row. Every row gets the same two hover controls —
// pin and ⋯ — and everything else lives in here: workspace membership toggles
// (for a project or a session) and row-specific actions. Destructive actions
// confirm in the centered dialog (useConfirm), never inline.
//
//   items: [{ label, onClick, danger, disabled }]
//          or { label, children: [{ key, label, sub?, dot?, tag?, onClick }] } — a
//          group that unfolds in place (no fly-out: the menu is narrow and the
//          sidebar is the edge of the window); `dot` is a provider dot class,
//          `sub` the folder label, `tag` a short note on the right
//   workspaceItem: the project / session to toggle in workspaces (optional)
//   accent: { value, defaultValue?, onChange, onReset?, resetLabel? } — a colour picker (a workspace's colour)
//   icon:   { value, onPick, accentStyle? } — a glyph picker (a workspace's icon)
export default function RowMenu({
  open,
  onClose,
  items = [],
  workspaceItem,
  workspaces = [],
  accent = null,
  icon = null,
  bounded = false,
  onWorkspaceChange,
}: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const onCloseRef = useRef(onClose)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [unfolded, setUnfolded] = useState<string | null>(null) // label of the open group
  useMenuLayoutEffect(() => {
    if (!open || !bounded) return
    const place = () => {
      const row = anchor.current?.parentElement?.getBoundingClientRect(),
        menu = ref.current
      if (!row || !menu) return
      const width = Math.min(accent || icon ? 256 : 240, window.innerWidth - 16)
      const below = window.innerHeight - row.bottom - 10,
        above = row.top - 10
      const up = below < Math.min(menu.scrollHeight, 240) && above > below
      const height = Math.max(48, up ? above : below)
      setPosition({
        width,
        maxHeight: Math.min(height, window.innerHeight - 16),
        left: Math.max(8, Math.min(row.right - width - 8, window.innerWidth - width - 8)),
        ...(up ? { bottom: Math.max(8, window.innerHeight - row.top + 2) } : { top: Math.max(8, row.bottom + 2) }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, bounded, unfolded, creating, workspaces.length, accent, icon])
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    setCreating(false)
    setName('')
    setUnfolded(null)
    const off = (e: MouseEvent) => e.target instanceof Node && !ref.current?.contains(e.target) && onCloseRef.current()
    const key = (e: { key: string }) => e.key === 'Escape' && onCloseRef.current()
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
    const id = createWorkspace(name, [workspaceItem])
    onWorkspaceChange?.(id, true)
    onClose()
  }
  const row =
    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-ink-600 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent'

  const menu = (
    // biome-ignore lint/a11y/noStaticElementInteractions: This container only stops pointer bubbling; its child buttons own all actions.
    <div
      ref={ref}
      style={bounded ? position || { visibility: 'hidden' } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      className={`${bounded ? 'fixed z-50 overflow-y-auto overscroll-contain' : 'absolute right-2 top-full z-30 mt-0.5'} ${accent || icon ? 'w-64' : 'w-60'} rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl py-1`}
    >
      {items.map((it) =>
        it.children ? (
          <div key={it.label}>
            <button type="button" onClick={() => setUnfolded((u) => (u === it.label ? null : it.label))} className={row} aria-expanded={unfolded === it.label}>
              <span className="truncate">{it.label}</span>
              <ChevronRightIcon className={`w-3 h-3 ml-auto text-zinc-600 shrink-0 transition-transform ${unfolded === it.label ? 'rotate-90' : ''}`} />
            </button>
            {unfolded === it.label &&
              it.children.map((c) => (
                <button
                  type="button"
                  key={c.key || c.label}
                  onClick={() => {
                    onClose()
                    c.onClick?.()
                  }}
                  title={c.title}
                  className={`${row} pl-6 py-1`}
                >
                  {c.dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate">{c.label}</span>
                      {c.tag && <span className="ml-auto text-[10.5px] text-zinc-600 shrink-0">{c.tag}</span>}
                    </span>
                    {c.sub && <span className="block text-[10.5px] text-zinc-500 truncate">{c.sub}</span>}
                  </span>
                </button>
              ))}
          </div>
        ) : (
          <button
            type="button"
            key={it.label}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
            className={`${row} ${it.danger ? 'text-red-300 hover:text-red-200' : ''}`}
          >
            {it.label}
          </button>
        )
      )}
      {(icon || accent) && (
        <>
          {items.length > 0 && <div className="my-1 border-t border-zinc-800" />}
          <div className="px-3 pb-1">
            {icon && <IconField value={icon.value} onPick={icon.onPick} accentStyle={icon.accentStyle} />}
            {accent && (
              <AccentField
                label="Colour"
                value={accent.value}
                defaultValue={accent.defaultValue}
                onChange={accent.onChange}
                onReset={accent.onReset}
                resetLabel={accent.resetLabel || 'clear'}
              />
            )}
          </div>
        </>
      )}
      {workspaceItem && (
        <>
          {(items.length > 0 || accent || icon) && <div className="my-1 border-t border-zinc-800" />}
          <div className="px-3 pt-1 pb-0.5 text-[10.5px] uppercase tracking-wider text-zinc-600">Workspaces</div>
          {workspaces.map((w) => {
            const member = inWorkspace(w, workspaceItem)
            return (
              <button
                type="button"
                key={w.id}
                onClick={() => {
                  if (member) removeFromWorkspace(w.id, workspaceItem)
                  else addToWorkspace(w.id, workspaceItem)
                  onWorkspaceChange?.(w.id, !member)
                }}
                className={row}
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] shrink-0 ${member ? 'bg-sky-500/30 border-sky-400 text-sky-100' : 'border-zinc-600'}`}
                >
                  {member ? '✓' : ''}
                </span>
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
                  // biome-ignore lint/a11y/noAutofocus: Initial focus follows an explicit create, edit or handoff action.
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' ? create() : e.key === 'Escape' ? onClose() : null)}
                  placeholder="Workspace name"
                  className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 placeholder-zinc-600"
                />
                <button
                  type="button"
                  onClick={create}
                  disabled={!name.trim()}
                  className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-[12px] disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-1 py-1.5 text-left text-[12px] text-sky-300 hover:text-sky-200"
              >
                <PlusIcon className="w-3.5 h-3.5" /> New workspace with this…
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
  return bounded && typeof document !== 'undefined' ? (
    <>
      <span ref={anchor} className="hidden" />
      {createPortal(menu, document.body)}
    </>
  ) : (
    menu
  )
}
