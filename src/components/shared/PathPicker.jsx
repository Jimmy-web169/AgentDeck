import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import useEscToClose from '../../lib/useEscToClose.js'

// Pop-up folder picker for "new project at a path". Browses the server's
// filesystem (OS-friendly via Node fs/path) — navigate folders or paste a path.
export default function PathPicker({ onPick, onClose }) {
  useEscToClose(onClose)
  const [cur, setCur] = useState(null) // { path, parent, home, dirs }
  const [input, setInput] = useState('')
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = (p) => {
    setLoading(true)
    setErr(null)
    api
      .browse(p)
      .then((d) => {
        setCur(d)
        setInput(d.path)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => load(), []) // start at home

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-16" onClick={onClose}>
      <div className="w-[620px] max-w-[94vw] max-h-[78vh] flex flex-col rounded-xl border border-zinc-700 bg-ink-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="text-sm font-semibold text-zinc-100">Choose a folder for the new conversation</div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>

        {/* path bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800">
          <button onClick={() => cur?.parent && load(cur.parent)} disabled={!cur?.parent} className="shrink-0 px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40 text-[12px]" title="Up one level">↑</button>
          <button onClick={() => cur?.home && load(cur.home)} className="shrink-0 px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 text-[12px]" title="Home">⌂</button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(input) }}
            placeholder="/absolute/path or ~/folder"
            className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] font-mono text-zinc-200 placeholder-zinc-600"
          />
          <button onClick={() => load(input)} className="shrink-0 px-2 py-1 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 text-[12px]">Go</button>
        </div>

        {/* folder list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
          {err && <div className="px-2 py-2 text-[12px] text-red-300">⚠ {err}</div>}
          {loading && <div className="px-2 py-2 text-[12px] text-zinc-600">loading…</div>}
          {!loading && cur?.dirs.map((d) => (
            <button key={d.path} onClick={() => load(d.path)} onDoubleClick={() => load(d.path)} className="w-full text-left px-2 py-1.5 rounded hover:bg-ink-700/60 flex items-center gap-2 text-[13px] text-zinc-200">
              <span className="text-zinc-500">📁</span>
              <span className="truncate">{d.name}</span>
            </button>
          ))}
          {!loading && cur && cur.dirs.length === 0 && <div className="px-2 py-2 text-[12px] text-zinc-600">(no sub-folders — you can still use this folder)</div>}
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-zinc-700">
          <div className="flex-1 min-w-0 text-[12px] text-zinc-400 font-mono truncate" title={cur?.path}>{cur?.path || '…'}</div>
          <button onClick={onClose} className="shrink-0 text-[12px] px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => cur && onPick(cur.path)} disabled={!cur} className="shrink-0 text-[13px] px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">Use this folder</button>
        </div>
      </div>
    </div>
  )
}
