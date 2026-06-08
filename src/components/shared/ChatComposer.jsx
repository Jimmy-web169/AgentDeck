import { useEffect, useRef, useState } from 'react'
import ResizeHandle from './ResizeHandle.jsx'
import OpenAppButtons from './OpenAppButtons.jsx'

export const MODES = [
  { v: 'acceptEdits', label: 'Auto-accept edits' },
  { v: 'default', label: 'Ask me per tool' },
  { v: 'plan', label: 'Plan (no actions)' },
  { v: 'bypass', label: 'Bypass (danger)' },
]

// Composer row under the Conversation. The reply streams INTO the conversation
// above (the live store owns the chat state). `slice` is this session's live
// chat (null = not started). Starting a chat keeps it alive across navigation;
// the single Live button (top bar) is where all live sessions are managed —
// this row only drives THIS conversation (send / end).
//
// Provider differences via props (defaults preserve claude behavior):
// - `modes` is the permission/sandbox-mode list (default MODES).
// - `contextMeter` is an optional rendered node (e.g. codex's ContextMeter) shown
//   in the status row; default none. ChatComposer itself imports no provider code.
export default function ChatComposer({ slice, onOpen, onClose, mode, onMode, onSend, onOpenTool, modes = MODES, contextMeter = null }) {
  const [input, setInput] = useState('')
  const taRef = useRef(null)
  const [taH, setTaH] = useState(() => Number(localStorage.getItem('cm_composerH')) || 0) // 0 = compact/auto
  useEffect(() => localStorage.setItem('cm_composerH', String(taH)), [taH])
  const ready = slice?.ready
  const streaming = slice?.streaming

  const submit = () => {
    const t = input.trim()
    if (!t || streaming || !ready) return
    if (onSend(t)) setInput('')
  }

  if (!slice) {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex items-center gap-3">
        <button onClick={onOpen} className="shrink-0 text-[13px] px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30">
          ▸ Continue this conversation
        </button>
        <OpenAppButtons onOpenTool={onOpenTool} />
        <span className="flex-1 min-w-0 overflow-hidden">
          <span className="text-[11px] text-zinc-600 truncate">reply streams into the conversation above — stays live when you switch away</span>
        </span>
        {contextMeter}
      </div>
    )
  }

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-ink-900/40">
      <ResizeHandle targetRef={taRef} onHeight={setTaH} min={36} />
      <div className="h-7 flex items-center gap-2 px-3 text-[11px] border-b border-zinc-800/60">
        <span className={`w-1.5 h-1.5 rounded-full ${streaming ? 'bg-emerald-400 animate-pulse' : ready ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <span className="shrink-0 text-zinc-400">{ready ? `live${slice.account ? ` · ${slice.account}` : ''}${streaming ? ' · replying…' : ''}` : 'connecting…'}</span>
        {slice.error && <span className="shrink-0 text-red-300 truncate" title={slice.error}>⚠ {slice.error}</span>}
        <div className="flex-1" />
        {contextMeter}
        <OpenAppButtons onOpenTool={onOpenTool} className="mr-1" />
        <button onClick={onClose} className="text-zinc-500 hover:text-red-300 ml-2" title="End this live conversation">End ✕</button>
      </div>

      <div className="p-2 flex items-end gap-2">
        <select value={mode} onChange={(e) => onMode(e.target.value)} className="shrink-0 bg-ink-700 border border-zinc-700 rounded px-1.5 py-1.5 text-[11px] text-zinc-300" title="permission mode">
          {modes.map((mm) => (
            <option key={mm.v} value={mm.v}>{mm.label}</option>
          ))}
        </select>
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          disabled={!ready || streaming}
          placeholder={streaming ? 'replying above…' : 'Continue the conversation… (Shift+Enter to send · Enter = newline)'}
          style={taH ? { height: taH } : undefined}
          className="flex-1 min-w-0 resize-none bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[14px] text-zinc-100 placeholder-zinc-600 disabled:opacity-50"
        />
        <button onClick={submit} disabled={!ready || streaming || !input.trim()} className="shrink-0 text-[13px] px-3.5 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
