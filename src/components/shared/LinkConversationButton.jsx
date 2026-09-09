import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { announceTerminal } from '../../lib/terminalTarget.js'
import useEscToClose from '../../lib/useEscToClose.js'

function Dialog({ api, provider, root, terminalKey, onClose }) {
  const [projects, setProjects] = useState([])
  const [slug, setSlug] = useState('')
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEscToClose(onClose)
  useEffect(() => {
    let cancelled = false
    api.projects(root).then((d) => {
      if (cancelled) return
      setProjects(d.projects)
      setSlug(d.projects[0]?.slug || '')
    }).catch((e) => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [api, root])
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setLoading(true)
    setSessions([])
    api.sessions(root, slug).then((d) => !cancelled && setSessions(d.sessions)).catch((e) => !cancelled && setError(e.message)).finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [api, root, slug])
  const link = async (s) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.terminal({ root, terminalKey, bindSessionId: s.id, slug })
      announceTerminal(provider, { ...result, title: s.title })
      onClose()
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Link saved conversation" className="w-[560px] max-w-[92vw] rounded-xl border border-zinc-700 bg-ink-800 p-4 text-zinc-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between gap-3"><span className="text-sm font-semibold">Link saved conversation</span><button onClick={onClose} aria-label="Close">✕</button></div>
        <p className="text-xs text-zinc-400 my-3">Choose the conversation currently running in this terminal. Linking keeps this terminal and its tab together.</p>
        <select aria-label="Project" value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full bg-ink-900 rounded border border-zinc-700 p-2 text-xs">
          {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name || p.cwd || p.slug}</option>)}
        </select>
        {error && <p role="alert" className="text-red-300 text-xs mt-3">{error}</p>}
        <div className="max-h-[50vh] overflow-y-auto mt-3">
          {loading ? <p className="text-xs text-zinc-500">Loading conversations…</p> : !sessions.length ? <p className="text-xs text-zinc-500">No saved conversations yet.</p> : sessions.map((s) => (
            <button disabled={busy} key={s.id} onClick={() => link(s)} className="block w-full text-left p-2 rounded hover:bg-ink-700 disabled:opacity-50"><span className="block text-sm truncate">{s.title || s.id}</span><span className="text-[10px] text-zinc-500 font-mono">{s.id}</span></button>
          ))}
        </div>
      </div>
    </div>, document.body)
}

export default function LinkConversationButton(props) {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)} className="text-sky-300 hover:text-sky-200">Link saved conversation</button>{open && <Dialog {...props} onClose={() => setOpen(false)} />}</>
}
