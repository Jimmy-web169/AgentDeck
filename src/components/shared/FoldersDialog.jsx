import { useMemo, useState } from 'react'
import { createApi } from '../../api.js'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import useConfirm from '../../lib/useConfirm.jsx'
import useEscToClose from '../../lib/useEscToClose.js'
import { CloseIcon, PencilIcon } from './shellIcons.jsx'

// Tracked folders of every provider as a centered dialog: one list (click a
// label to rename it, untrack behind a confirm) and one add form (pick the
// provider, type a path). Opened from the "+" next to the folder chips — in
// the sidebar and in Home's header. Esc / backdrop / the × close it.
//
// The body only mounts while open, so the form starts fresh each time and the
// Esc hook holds a stack slot only while the dialog is actually up.
export default function FoldersDialog({ open, onClose, providers = [], index }) {
  if (!open) return null
  return <Dialog onClose={onClose} providers={providers} index={index} />
}

function ProviderBadge({ providers, id }) {
  const c = providerColor(providers, id)
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-zinc-800 bg-ink-800 ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {providerLabel(providers, id)}
    </span>
  )
}

function Dialog({ onClose, providers, index }) {
  const apis = useMemo(() => Object.fromEntries(providers.map((p) => [p.id, createApi(p.id)])), [providers])
  const [prov, setProv] = useState(providers[0]?.id)
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null) // { provider, id, label }
  const [confirmEl, confirm] = useConfirm()
  // The untrack confirm listens for Esc itself (it is not on the useEscToClose
  // stack), so while it is up this dialog must ignore Esc — otherwise one key
  // press would close both layers.
  useEscToClose(onClose, !confirmEl)
  const cfg = providers.find((p) => p.id === prov)
  const rows = providers.flatMap((p) => (index.roots[p.id] || []).map((r) => ({ ...r, provider: p.id, statusField: p.rootStatusField || 'hasProjects' })))

  const run = async (fn) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await index.refresh(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const add = () =>
    path.trim() &&
    run(async () => {
      await apis[prov].addRoot(path.trim(), label.trim())
      setPath('')
      setLabel('')
    })
  const untrack = async (r) => {
    const ok = await confirm({
      title: `Stop tracking “${r.label}”?`,
      message: 'AgentDeck forgets this folder. Nothing on disk is touched.',
      detail: r.dir,
      confirmLabel: 'Untrack',
    })
    if (ok) run(() => apis[r.provider].removeRoot(r.id))
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4 qs-backdrop" onMouseDown={onClose}>
        {/* `!translate-x-0` pins the transform so the shared qs-pop keyframes (built for
            the left-50% quick switcher) fade this flex-centered panel in without shifting it. */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="folders-dialog-title"
          onMouseDown={(e) => e.stopPropagation()}
          className="w-[min(720px,100%)] max-h-[85vh] overflow-y-auto rounded-xl border border-zinc-700 bg-ink-900 shadow-2xl shadow-black/50 qs-panel !translate-x-0"
        >
          <div className="sticky top-0 z-[1] h-12 flex items-center gap-2 px-5 border-b border-zinc-800 bg-ink-900">
            <span id="folders-dialog-title" className="text-[14px] font-semibold text-zinc-100">Tracked folders</span>
            <span className="text-[11px] text-zinc-600">· {rows.length}</span>
            <span className="flex-1" />
            <button onClick={onClose} title="Close (Esc)" className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-ink-700">
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            <div className="rounded-lg border border-zinc-800 bg-ink-950/40 overflow-hidden divide-y divide-zinc-800/70">
              {rows.map((r) => (
                <div key={`${r.provider}|${r.id}`} className="flex items-center gap-3 px-3 py-2.5">
                  <ProviderBadge providers={providers} id={r.provider} />
                  <div className="min-w-0 flex-1">
                    {editing?.provider === r.provider && editing?.id === r.id ? (
                      <input
                        autoFocus
                        value={editing.label}
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') run(() => apis[r.provider].relabelRoot(r.id, editing.label)).then(() => setEditing(null))
                          else if (e.key === 'Escape') {
                            e.stopPropagation() // cancel the rename only — the dialog stays open
                            setEditing(null)
                          }
                        }}
                        placeholder="label (empty = default)"
                        className="w-full bg-ink-700 border border-zinc-700 rounded px-2 py-0.5 text-[13px] text-zinc-100 placeholder-zinc-600"
                      />
                    ) : (
                      <button onClick={() => setEditing({ provider: r.provider, id: r.id, label: r.label })} className="group flex items-center gap-1.5 max-w-full text-left" title="Rename this folder's label">
                        <span className="text-[13px] text-zinc-200 truncate">{r.label}</span>
                        <PencilIcon className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 shrink-0" />
                      </button>
                    )}
                    <div className="text-[11px] text-zinc-500 font-mono truncate">{r.dir}</div>
                  </div>
                  <div className="text-[10.5px] flex gap-2 shrink-0">
                    <span className={r.exists ? 'text-emerald-400' : 'text-red-400'}>{r.exists ? 'exists' : 'missing'}</span>
                    <span className={r[r.statusField] ? 'text-sky-400' : 'text-zinc-600'}>{r[r.statusField] ? 'has history' : 'config only'}</span>
                  </div>
                  <button onClick={() => untrack(r)} disabled={busy} title="Stop tracking this folder. Does NOT delete it from disk." className="text-[11px] px-2 py-1 rounded bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/25 disabled:opacity-40 shrink-0">
                    untrack
                  </button>
                </div>
              ))}
              {rows.length === 0 && <div className="px-3 py-4 text-[12px] text-zinc-600">No folders tracked yet — add one below.</div>}
            </div>

            <section>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2.5">Add a folder</div>
              <div className="rounded-lg border border-zinc-800 bg-ink-950/40 p-4 space-y-3">
                <div className="flex rounded-md bg-ink-800 border border-zinc-800 p-0.5 w-fit">
                  {providers.map((p) => {
                    const c = providerColor(providers, p.id)
                    const active = prov === p.id
                    return (
                      <button key={p.id} onClick={() => setProv(p.id)} className={`flex items-center gap-1.5 h-7 px-3 rounded text-[12px] transition-colors ${active ? 'bg-ink-600 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200 hover:bg-ink-700'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <input
                  autoFocus
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                  placeholder={cfg?.id === 'codex' ? '/path/to/.codex  or  ~/.codex' : '/path/to/.claude  or  ~/my-project'}
                  className="w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 font-mono placeholder-zinc-600"
                />
                <div className="flex gap-2">
                  <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="label (optional)" className="flex-1 bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600" />
                  <button onClick={add} disabled={busy || !path.trim()} className="px-4 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-[13px] disabled:opacity-40">
                    {busy ? '…' : 'Add'}
                  </button>
                </div>
                {err && <div className="text-[12px] text-red-300">{err}</div>}
                <div className="text-[11px] text-zinc-600">
                  A folder is a CLI home (<span className="font-mono">~/.claude</span>, <span className="font-mono">~/.codex</span>) or any directory with a <span className="font-mono">.claude/</span> config. Click a label above to rename it (a second account's home, say). <span className="text-zinc-400">untrack</span> only removes it from this list.
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      {/* Sibling of the backdrop, not a child of the panel: the panel is transformed
          (qs-panel), which would make it the containing block for this fixed
          overlay and clip it to the scroll area. As a sibling its z-[60] stacks
          above the dialog's z-40. */}
      {confirmEl}
    </>
  )
}
