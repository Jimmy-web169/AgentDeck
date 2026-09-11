import { errorMessage } from '../../lib/errors.ts'
interface LinkProps {
  api: import('../../api/providerApi.ts').ProviderClient
  provider: string
  root: string
  cwd: string
  terminalKey: string
}
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { announceTerminal } from '../../lib/terminalTarget.ts'
import useEscToClose from '../../lib/useEscToClose.ts'
import { useRepairCandidates } from '../../api/index.ts'

function Dialog({ api, provider, root, cwd, terminalKey, onClose }: LinkProps & { onClose: () => void }) {
  const { data: sessions, isPending: loading, error: queryError } = useRepairCandidates(provider, root, cwd)
  const [busy, setBusy] = useState(false)
  const [actionError, setError] = useState<string | null>(null)
  const error = actionError || queryError?.message
  useEscToClose(onClose, !busy)
  const link = async (s: { id: string; slug?: string | null; title?: string | null }) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.terminal({ root, terminalKey, bindSessionId: s.id, slug: s.slug })
      announceTerminal(provider, { ...result, title: s.title })
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: Backdrop dismissal supplements the dialog Close button and Escape handler; the backdrop itself is not a keyboard control.
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (!busy) onClose()
        } else e.stopPropagation()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Match current conversation manually"
        className="w-[560px] max-w-[92vw] rounded-xl border border-zinc-700 bg-ink-800 p-4 text-zinc-200"
      >
        <div className="flex justify-between gap-3">
          <span className="text-sm font-semibold">Match current conversation manually</span>
          <button type="button" disabled={busy} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-xs text-zinc-400 my-3">
          Use only to repair automatic detection. Select the conversation already running in this terminal; this does not switch agents or load other history.
          If unsure, close this dialog and keep using the terminal.
        </p>
        <p className="text-xs text-zinc-500 break-all">Current folder: {cwd}</p>
        {error && (
          <p role="alert" className="text-red-300 text-xs mt-3">
            {error}
          </p>
        )}
        <div className="max-h-[50vh] overflow-y-auto mt-3">
          {loading ? (
            <p className="text-xs text-zinc-500">Finding conversations in the current folder…</p>
          ) : !sessions?.length ? (
            <p className="text-xs text-zinc-500">
              No matching conversations in this folder yet. Keep using the terminal while waiting for the record to be saved.
            </p>
          ) : (
            sessions.map((s) => (
              <button
                type="button"
                disabled={busy}
                key={s.id}
                onClick={() => link(s)}
                className="block w-full text-left p-2 rounded hover:bg-ink-700 disabled:opacity-50"
              >
                <span className="block text-sm truncate">{s.title || s.id}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{s.id}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function LinkConversationButton(props: LinkProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sky-300 hover:text-sky-200">
        Match current conversation manually
      </button>
      {open && <Dialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}
