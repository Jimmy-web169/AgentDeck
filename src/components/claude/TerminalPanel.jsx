import { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import ResizeHandle from '../shared/ResizeHandle.jsx'
import OpenAppButtons from '../shared/OpenAppButtons.jsx'

// Terminal chat mode: embeds the real `claude` TUI (served by ttyd) below the
// conversation. props: continue an existing session ({root,slug,id}) or start a
// new one ({root,cwd} new path · {root,slug} new under project). If a terminal is
// already running for this target (runningKeys), it auto-reattaches.
//
// "Pop out" opens the ttyd terminal in a new browser tab and collapses the
// embedded iframe to a one-line bar, so the monitoring page stays uncluttered.
// The tmux session keeps running either way; re-embed brings it back inline.
export default function TerminalPanel({ root, slug, id, cwd, isNew, title, contextUsed, onClose, onChange, runningKeys, onOpenTool }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(null)
  const [key, setKey] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [detached, setDetached] = useState(false) // popped out to its own browser tab
  const panelRef = useRef(null)
  const popoutRef = useRef(null)
  const autoKeyRef = useRef(null) // target key we've already auto-decided — attach once, never reopen after the user closes/pops out
  const [height, setHeight] = useState(() => {
    const v = Number(localStorage.getItem('cm_termH'))
    return v >= 160 ? v : 500
  })
  useEffect(() => localStorage.setItem('cm_termH', String(height)), [height])

  // the server-side key for this target (must match server's postTerminal logic)
  const myKey = id ? `${root}|${slug}|${id}` : cwd ? `${root}|new|${cwd}` : `${root}|new|${slug}`

  const start = () => {
    if (loading) return
    autoKeyRef.current = myKey // mark this target handled (manual or auto) so the auto-reattach effect won't double-fire or reopen
    setLoading(true)
    setErr(null)
    const body = id && slug ? { root, slug, id, title } : cwd ? { root, cwd, title } : { root, slug, title }
    api
      .terminal(body)
      .then((d) => {
        setUrl(d.url)
        setKey(d.key)
        setOpen(true)
        onChange && onChange()
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }

  // on target change: reset, then decide. If runningKeys already knows this
  // target is live, reattach now; otherwise the effect below catches it once the
  // live list finishes loading.
  useEffect(() => {
    setOpen(false)
    setUrl(null)
    setKey(null)
    setErr(null)
    setDetached(false)
    autoKeyRef.current = null
    if (runningKeys && runningKeys.has(myKey)) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, slug, id, cwd])

  // Late reattach: the live-tmux list (runningKeys) loads asynchronously, so
  // entering a session cold from the project list mounts BEFORE it's known —
  // unlike the Live panel, which has it preloaded. Re-check when it arrives, but
  // only once per target (autoKeyRef) and only while nothing is open yet, so it
  // never reopens after the user closed or popped the terminal out. This is what
  // keeps the same session from being opened as a second terminal.
  const isLive = !!(runningKeys && runningKeys.has(myKey))
  useEffect(() => {
    if (autoKeyRef.current === myKey || open || url || loading || detached) return
    if (isLive) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive])

  const close = () => {
    if (key) api.terminalStop(key).catch(() => {})
    try { popoutRef.current?.close?.() } catch {}
    setOpen(false)
    setUrl(null)
    setKey(null)
    setDetached(false)
    onChange && onChange()
    onClose && onClose()
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
      // blocked — fall back, keep it embedded
      window.open(url, '_blank', 'noopener')
    }
  }

  if (!open || !url) {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex items-center gap-3">
        <button onClick={start} disabled={loading} className="shrink-0 text-[13px] px-3 py-1.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
          {loading ? 'starting…' : isNew ? '▸ Open terminal here (new conversation)' : '▸ Open terminal (continue this session)'}
        </button>
        <OpenAppButtons onOpenTool={onOpenTool} />
        {err ? (
          <span className="text-[11px] text-red-300 truncate">⚠ {err}</span>
        ) : (
          <span className="flex-1 min-w-0 text-[11px] text-zinc-600 truncate">runs the real <span className="font-mono">claude</span> TUI here via ttyd — uses this folder’s account login</span>
        )}
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
        <button onClick={close} className="text-[12px] text-zinc-500 hover:text-red-300" title="End this terminal">End ✕</button>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="shrink-0 border-t border-zinc-800 flex flex-col" style={{ height }}>
      <ResizeHandle targetRef={panelRef} onHeight={setHeight} min={160} max={1200} title="Drag to resize the terminal" />
      <div className="h-7 shrink-0 flex items-center gap-2 px-3 text-[11px] bg-ink-900/70 border-b border-zinc-800">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
        <span className="text-zinc-400">terminal · real claude TUI{isNew ? ' · new' : ''}</span>
        <div className="flex-1" />
        {contextUsed != null && (
          <span className={`font-mono mr-1 ${contextUsed >= 90 ? 'text-red-300' : contextUsed >= 70 ? 'text-amber-300' : 'text-sky-300'}`} title="context window used for this session (from the status line)">
            ⛶ ctx {contextUsed}% used
          </span>
        )}
        <OpenAppButtons onOpenTool={onOpenTool} className="mr-1" />
        <button onClick={popOut} className="text-zinc-500 hover:text-sky-300" title="Open in a new browser tab and collapse this panel">⤢ pop out</button>
        <button onClick={() => setNonce((n) => n + 1)} className="text-zinc-500 hover:text-zinc-200">⟳ reload</button>
        <button onClick={close} className="text-zinc-500 hover:text-red-300 ml-1" title="End this terminal">close ✕</button>
      </div>
      <iframe key={nonce} src={url} title="claude terminal" className="flex-1 w-full border-0" style={{ background: '#000' }} />
    </div>
  )
}
