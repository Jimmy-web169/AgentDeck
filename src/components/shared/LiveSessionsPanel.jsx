import { useState } from 'react'

// badge color comes from the provider's config (`accent`); unknown → zinc
function ProviderTag({ providers, id }) {
  if (!id) return null
  const accent = providers?.find((p) => p.id === id)?.accent || 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
  const label = providers?.find((p) => p.id === id)?.label || id
  return <span className={`shrink-0 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded border ${accent}`}>{label}</span>
}

// Unified Live manager — one place to enter/end every running terminal across
// every provider. `items` is the normalized cross-provider list of live tmux
// terminals — the single source of truth for what's live now.
export default function LiveSessionsPanel({ items = [], providers = [], onEnter, onClose, onClosePanel, title = 'Live sessions' }) {
  const [copied, setCopied] = useState(null)

  // copy `tmux attach -t <name>` so the session can be attached from any terminal
  const copyAttach = (name) => {
    navigator.clipboard
      ?.writeText(`tmux attach -t ${name}`)
      .then(() => {
        setCopied(name)
        setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500)
      })
      .catch(() => {})
  }

  const Row = ({ it, children }) => (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-700/70 bg-ink-700/40 px-3 py-2 mb-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <ProviderTag providers={providers} id={it.provider} />
          <span className="text-[13px] text-zinc-100 truncate">{it.title}</span>
        </div>
        {children}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={() => onEnter(it)} className="text-[12px] px-2.5 py-1 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30">Enter</button>
        <button onClick={() => onClose(it)} className="text-[12px] px-2.5 py-1 rounded bg-red-500/15 text-red-200 hover:bg-red-500/25">End</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-20" onClick={onClosePanel}>
      <div className="w-[560px] max-w-[92vw] max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-700 bg-ink-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <button onClick={onClosePanel} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>

        <div className="px-4 py-3">
          {items.length === 0 && <div className="text-[12px] text-zinc-600 mb-3">No running terminals right now.</div>}
          {items.map((it) => (
            <Row key={it.key} it={it}>
              <div className="text-[11px] text-zinc-500">{it.attached ? 'attached' : 'detached · running'}</div>
              {it.tmuxName && (
                <button
                  onClick={(e) => { e.stopPropagation(); copyAttach(it.tmuxName) }}
                  title="Copy — attach this session from any terminal"
                  className="mt-1 flex items-center gap-1 text-[10.5px] font-mono text-zinc-600 hover:text-sky-300 max-w-full"
                >
                  <span className="shrink-0">{copied === it.tmuxName ? '✓ copied' : '⧉'}</span>
                  <span className="truncate">tmux attach -t {it.tmuxName}</span>
                </button>
              )}
            </Row>
          ))}
        </div>
      </div>
    </div>
  )
}
