import { useEffect, useRef, useState } from 'react'
import { api } from '../../api.js'
import ResizeHandle from '../shared/ResizeHandle.jsx'
import OpenAppButtons from '../shared/OpenAppButtons.jsx'

// Terminal chat mode: embeds the real `claude` TUI (served by ttyd) below the
// conversation. props: continue an existing session ({root,slug,id}) or start a
// new one ({root,cwd} new path · {root,slug} new under project). If a terminal is
// already running for this target (runningKeys), it auto-reattaches.
//
// "Pop out" opens the ttyd terminal in its own browser window and collapses the
// embedded iframe to a one-line bar, so the monitoring page stays uncluttered.
// The tmux session keeps running either way; re-embed brings it back inline.
export default function TerminalPanel({ root, slug, id, cwd, isNew, title, contextUsed, onClose, onChange, runningKeys, onOpenTool }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(null)
  const [key, setKey] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [detached, setDetached] = useState(false) // popped out to its own window
  const panelRef = useRef(null)
  const popoutRef = useRef(null)
  const [height, setHeight] = useState(() => {
    const v = Number(localStorage.getItem('cm_termH'))
    return v >= 160 ? v : 500
  })
  useEffect(() => localStorage.setItem('cm_termH', String(height)), [height])

  // the server-side key for this target (must match server's postTerminal logic)
  const myKey = id ? `${root}|${slug}|${id}` : cwd ? `${root}|new|${cwd}` : `${root}|new|${slug}`

  const start = () => {
    if (loading) return
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

  // on target change: reset; auto-reattach if a terminal is already running for it
  useEffect(() => {
    setOpen(false)
    setUrl(null)
    setKey(null)
    setErr(null)
    setDetached(false)
    if (runningKeys && runningKeys.has(myKey)) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, slug, id, cwd])

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

  // open the ttyd terminal in its own window and collapse the embedded iframe
  const popOut = () => {
    const w = window.open(url, `agentdeck-term-${key || myKey}`, 'popup,width=960,height=640')
    if (w) {
      popoutRef.current = w
      setDetached(true)
    } else {
      // popup blocked — fall back to a new tab, keep it embedded
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
        <span className="text-[12px] text-zinc-400 shrink-0">Terminal running in a separate window</span>
        <span className="flex-1" />
        <button onClick={() => { try { popoutRef.current?.focus?.() } catch {} }} className="text-[12px] text-sky-300/90 hover:text-sky-200">focus window</button>
        <button onClick={() => setDetached(false)} className="text-[12px] text-zinc-400 hover:text-zinc-200">⧉ re-embed</button>
        <button onClick={close} className="text-[12px] text-zinc-500 hover:text-red-300" title="End this terminal">End ✕</button>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="shrink-0 border-t border-zinc-800 flex flex-col" style={{ height }}>
      <ResizeHandle targetRef={panelRef} onHeight={setHeight} min={160} />
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
        <button onClick={popOut} className="text-zinc-500 hover:text-sky-300" title="Open in a separate window and collapse this panel">⤢ pop out</button>
        <button onClick={() => setNonce((n) => n + 1)} className="text-zinc-500 hover:text-zinc-200">⟳ reload</button>
        <button onClick={close} className="text-zinc-500 hover:text-red-300 ml-1" title="End this terminal">close ✕</button>
      </div>
      <iframe key={nonce} src={url} title="claude terminal" className="flex-1 w-full border-0" style={{ background: '#000' }} />
    </div>
  )
}
