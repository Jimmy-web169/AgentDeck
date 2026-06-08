import { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import OpenAppButtons from '../shared/OpenAppButtons.jsx'
import ResizeHandle from '../shared/ResizeHandle.jsx'
import ContextMeter from './ContextMeter.jsx'

// Terminal chat mode: embeds the real `codex` TUI (served by ttyd) below the
// conversation. Continuing a session runs `codex resume <id>`; a new one runs
// `codex`. The terminal lives server-side keyed by target, so it SURVIVES
// navigation: on target change we reset and, if a terminal is already running
// for the new target (runningKeys), auto-reattach to it instead of killing it.
// It is only stopped by the explicit "stop ✕" or the Live-manager End.
export default function TerminalPanel({ root, slug, cwd, id, title, isNew, contextSummary, runningKeys, onClose, onChange, onOpenTool }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(null)
  const [key, setKey] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [detached, setDetached] = useState(false) // popped out to its own browser tab
  const wrapRef = useRef(null)
  const popoutRef = useRef(null)
  const [h, setH] = useState(() => {
    const v = Number(localStorage.getItem('cxm_termH'))
    if (v >= 160 && v <= 1200) return v
    return Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.52)
  })
  useEffect(() => localStorage.setItem('cxm_termH', String(h)), [h])

  // server-side key for this target — must match server postTerminal()
  const myKey = id ? `${root}|${id}` : cwd ? `${root}|new|${cwd}` : `${root}|new|${slug}`

  const start = () => {
    if (loading) return
    setLoading(true)
    setErr(null)
    const body = { root, title }
    if (id) body.id = id
    else if (cwd) body.cwd = cwd
    else if (slug) body.slug = slug
    api
      .terminal(body)
      .then((d) => {
        setUrl(d.url)
        setKey(d.key)
        setOpen(true)
        onChange?.()
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }

  // on target change: reset; auto-reattach if a terminal is already running for it
  useEffect(() => {
    setOpen(false)
    setUrl(null)
    setKey(null)
    setErr(null)
    setDetached(false)
    if (runningKeys && runningKeys.has(myKey)) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, slug, cwd, id])

  // explicit end — kills the server-side ttyd
  const stop = () => {
    if (key) api.terminalStop(key).then(() => onChange?.()).catch(() => {})
    try { popoutRef.current?.close?.() } catch {}
    setOpen(false)
    setUrl(null)
    setKey(null)
    setDetached(false)
    onChange?.()
    onClose?.()
  }

  // open the ttyd terminal in a new browser tab (not a separate window) and collapse the embedded iframe
  const popOut = () => {
    // named (not _blank) so re-opening reuses the same tab; no window features = a tab, not a popup window
    const w = window.open(url, `agentdeck-term-${key || myKey}`)
    if (w) {
      popoutRef.current = w
      setDetached(true)
      try { w.focus() } catch {}
    } else {
      window.open(url, '_blank', 'noopener')
    }
  }

  // collapsed: just a button — never auto-POSTs except the reattach above
  if (!open || !url) {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex items-center gap-3">
        <button onClick={start} disabled={loading} className="shrink-0 text-[13px] px-3 py-1.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
          {loading ? 'starting…' : isNew ? '▸ Open terminal here (new conversation)' : '▸ Continue in a terminal'}
        </button>
        <OpenAppButtons onOpenTool={onOpenTool} />
        {err ? (
          <span className="text-[11px] text-red-300 truncate">⚠ {err}</span>
        ) : (
          <span className="flex-1 min-w-0 text-[11px] text-zinc-600 truncate">runs the real <span className="font-mono">codex resume</span> in an embedded terminal — stays alive when you switch away</span>
        )}
        <ContextMeter summary={contextSummary} label="ctx" />
      </div>
    )
  }

  // popped out: collapse to a slim bar so the monitoring page stays clean
  if (detached) {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" />
        <span className="text-[12px] text-zinc-400 shrink-0">Terminal running in a separate tab</span>
        <span className="flex-1" />
        <button onClick={() => { try { popoutRef.current?.focus?.() } catch {} }} className="text-[12px] text-sky-300/90 hover:text-sky-200">focus tab</button>
        <button onClick={() => setDetached(false)} className="text-[12px] text-zinc-400 hover:text-zinc-200">⧉ re-embed</button>
        <button onClick={stop} className="text-[12px] text-zinc-500 hover:text-red-300" title="Stop this terminal">stop ✕</button>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="shrink-0 border-t border-zinc-800 bg-ink-900 flex flex-col" style={{ height: h }}>
      <ResizeHandle targetRef={wrapRef} onHeight={setH} min={160} max={1200} title="Drag to resize the terminal" />
      <div className="h-8 shrink-0 flex items-center gap-2 px-3 text-[11px] border-b border-zinc-800/60">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
        <span className="text-zinc-400">{isNew ? 'new conversation' : `codex resume ${id ? id.slice(0, 8) : ''}`} — embedded terminal</span>
        {err && <span className="text-red-300 truncate" title={err}>⚠ {err}</span>}
        <div className="flex-1" />
        <ContextMeter summary={contextSummary} label="ctx" />
        <OpenAppButtons onOpenTool={onOpenTool} className="mr-1" />
        <button onClick={popOut} className="text-zinc-500 hover:text-sky-300" title="Open in a new browser tab and collapse this panel">⤢ pop out</button>
        <button onClick={() => setNonce((n) => n + 1)} className="text-zinc-500 hover:text-zinc-200 ml-1" title="reload">⟳</button>
        <button onClick={stop} className="text-zinc-500 hover:text-red-300 ml-1" title="Stop this terminal">stop ✕</button>
      </div>
      <div className="flex-1 min-h-0 bg-black">
        <iframe key={nonce} src={url} title="codex terminal" className="w-full h-full border-0" />
      </div>
    </div>
  )
}
