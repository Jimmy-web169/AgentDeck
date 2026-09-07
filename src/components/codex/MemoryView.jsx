import { useEffect, useState } from 'react'
import { codexApi as api } from '../../api.js'
import Markdown from '../shared/Markdown.jsx'

// Codex auto-generated per-conversation memories (from memories_1.sqlite).
// Each memory belongs to a thread, and threads carry their cwd, so a project
// (cwd) can show just its own memories — `cwd` scopes the list; without it the
// whole home is shown. Read-only.
export default function MemoryView({ root, cwd }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!root) return
    setData(null)
    setError(null)
    api.memory(root).then(setData).catch((e) => setError(e.message))
  }, [root])

  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading memories…</div>
  const all = data.memories || []
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
  const mems = cwd ? all.filter((m) => norm(m.cwd) === norm(cwd)) : all

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-[15px] font-semibold text-zinc-100">Memory</h2>
        <span className="text-[11px] text-zinc-600">{mems.length}{cwd && all.length !== mems.length ? ` of ${all.length} in this home` : ''}</span>
      </div>
      <p className="text-[12px] text-zinc-500 mb-4">
        Codex auto-generates a memory per conversation thread (stored in <span className="font-mono">memories_1.sqlite</span>){cwd ? ' — showing the threads of this project' : ''}. Read-only.
      </p>
      {mems.length === 0 ? (
        <div className="text-center text-zinc-600 py-10">
          {data.source === 'error'
            ? 'Could not read memories — the sqlite3 CLI is not available on this machine.'
            : cwd
              ? 'No memories for this project yet — Codex generates these from its sessions.'
              : 'No memories yet — Codex generates these from your sessions.'}
        </div>
      ) : (
        mems.map((m) => (
          <div key={m.threadId} className="mb-4 rounded-lg border border-zinc-800 bg-ink-900/40 p-3">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-zinc-200 font-medium truncate">{m.title || m.threadId.slice(0, 8)}</span>
              {m.usageCount > 0 && <span className="text-zinc-600 shrink-0">· used {m.usageCount}×</span>}
              {m.selectedForPhase2 && <span className="text-emerald-400/80 shrink-0">· phase2 ✓</span>}
            </div>
            {!cwd && m.cwd && <div className="text-[10.5px] text-zinc-600 font-mono truncate">{m.cwd}</div>}
            {m.summary && <div className="text-[12px] text-zinc-500 mt-1">{m.summary}</div>}
            <div className="mt-2 text-[13px]">
              <Markdown>{m.content}</Markdown>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
