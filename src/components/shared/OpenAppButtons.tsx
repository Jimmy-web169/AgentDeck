import { errorMessage } from '../../lib/errors.ts'
import { useState } from 'react'

// "Open VS Code" / "Open Terminal" — launches the local app at the session/project
// folder (server is localhost-only). Self-contained; used in both chat modes.
export default function OpenAppButtons({ onOpenTool, className = '' }: { onOpenTool?: (tool: 'vscode' | 'terminal') => unknown; className?: string }) {
  const [opening, setOpening] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (!onOpenTool) return null

  const openWith = (what: 'vscode' | 'terminal') => {
    if (opening) return
    setErr(null)
    setOpening(what)
    Promise.resolve(onOpenTool(what))
      .catch((e) => setErr(errorMessage(e) || 'failed to open'))
      .finally(() => setOpening(null))
  }

  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => openWith('vscode')}
        disabled={!!opening}
        title="Open this project in VS Code"
        className="text-[11px] px-2 py-0.5 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
      >
        {opening === 'vscode' ? 'opening…' : '⧉ VS Code'}
      </button>
      <button
        type="button"
        onClick={() => openWith('terminal')}
        disabled={!!opening}
        title="Open a terminal in this project"
        className="text-[11px] px-2 py-0.5 rounded bg-ink-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
      >
        {opening === 'terminal' ? 'opening…' : '❯_ Terminal'}
      </button>
      {err && <span className="text-[11px] text-red-300 truncate">⚠ {err}</span>}
    </span>
  )
}
