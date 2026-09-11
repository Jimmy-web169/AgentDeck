export interface ConfirmOptions {
  title?: string
  message?: React.ReactNode
  detail?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
import { useCallback, useEffect, useRef, useState } from 'react'

// One centered confirmation dialog for every destructive action (trash a
// session, trash several, delete a workspace, untrack a folder).
//
//   const [confirmEl, confirm] = useConfirm()
//   if (await confirm({ title, message, confirmLabel, danger })) doIt()
//   … {confirmEl}
//
// Enter confirms, Esc / backdrop cancels; focus starts on the safe button.
export default function useConfirm() {
  const [req, setReq] = useState<{ opts: ConfirmOptions; resolve: (value: boolean) => void } | null>(null) // { opts, resolve }
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setReq({ opts, resolve })), [])
  const settle = (v: boolean) => {
    req?.resolve(v)
    setReq(null)
  }
  const el = req ? <ConfirmDialog {...req.opts} onConfirm={() => settle(true)} onCancel={() => settle(false)} /> : null
  return [el, confirm] as const
}

export function ConfirmDialog({
  title = 'Are you sure?',
  message,
  detail,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const key = (e: { key: string; preventDefault: () => void }) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onConfirm, onCancel])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Backdrop dismissal supplements the dialog Close button and Escape handler; the backdrop itself is not a keyboard control.
    <div
      role="presentation"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 qs-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
        else e.stopPropagation()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-[420px] max-w-[92vw] rounded-xl border border-zinc-700 bg-ink-800 shadow-2xl shadow-black/50 p-5 qs-panel !translate-x-0"
      >
        <div className="text-[14px] font-semibold text-zinc-100">{title}</div>
        {message && <div className="mt-1.5 text-[13px] text-zinc-300 break-words">{message}</div>}
        {detail && <div className="mt-1 text-[12px] text-zinc-500 break-words">{detail}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md bg-ink-700 border border-zinc-700 text-[13px] text-zinc-200 hover:bg-ink-600"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-md text-[13px] ${danger ? 'bg-red-500/25 text-red-100 hover:bg-red-500/40 border border-red-500/40' : 'bg-sky-500/25 text-sky-100 hover:bg-sky-500/40 border border-sky-500/40'}`}
          >
            {confirmLabel}
          </button>
        </div>
        <div className="mt-3 text-[10.5px] text-zinc-600">Enter confirms · Esc cancels</div>
      </div>
    </div>
  )
}
