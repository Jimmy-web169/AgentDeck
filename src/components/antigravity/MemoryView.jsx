import { useEffect, useState } from 'react'
import { useProviderApi } from '../../lib/providerApi.js'
import Markdown from '../shared/Markdown.jsx'
import { fmtRelative } from '../../lib/format.js'
import ReadOnlyNote from '../shared/ReadOnlyNote.jsx'

// Antigravity has no memory store; the closest thing is the Markdown
// artifacts a conversation writes into its brain folder (task plans, walk-
// throughs, notes). `cwd` scopes the list to one project's conversations;
// without it the whole home is shown. Read-only.
export default function MemoryView({ root, cwd }) {
  const api = useProviderApi()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    if (!root) return
    setData(null)
    setError(null)
    api.memory(root).then(setData).catch((e) => setError(e.message))
  }, [root])

  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading artifacts…</div>
  const all = data.memories || []
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
  const mems = cwd ? all.filter((m) => !m.cwd || norm(m.cwd) === norm(cwd)) : all

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-[15px] font-semibold text-zinc-100">Artifacts</h2>
        <span className="text-[11px] text-zinc-600">{mems.length}{cwd && all.length !== mems.length ? ` of ${all.length} in this home` : ''}</span>
        <ReadOnlyNote why="agy writes these while it works (task plans, walkthroughs, notes) into brain/<id>/. AgentDeck shows them; review or edit them in agy itself (/artifact)." />
      </div>
      <p className="text-[12px] text-zinc-500 mb-4">
        Antigravity keeps no memory store; these are the Markdown artifacts its conversations wrote (<span className="font-mono">brain/&lt;id&gt;/*.md</span>).{' '}
        <a href="https://antigravity.google/docs/cli/artifacts" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">Reviewing artifacts ↗</a>
      </p>
      {mems.length === 0 ? (
        <div className="text-center text-zinc-600 py-10">No artifacts yet — agy writes these while it works on a task.</div>
      ) : (
        mems.map((m) => (
          <div key={m.id} className="mb-3 rounded-lg border border-zinc-800 bg-ink-900/40">
            <button onClick={() => setOpen((o) => (o === m.id ? null : m.id))} className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-ink-700/40">
              <span className="text-[12.5px] text-zinc-200 font-medium truncate">{m.title}</span>
              {m.kind && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 shrink-0">{m.kind}</span>}
              <span className="flex-1" />
              {m.updatedAt && <span className="text-[10.5px] text-zinc-600 shrink-0">{fmtRelative(m.updatedAt)}</span>}
              <span className="text-[10.5px] text-zinc-600 font-mono shrink-0">{m.sessionId?.slice(0, 8)}</span>
            </button>
            {m.summary && open !== m.id && <div className="px-3 pb-2.5 text-[12px] text-zinc-500 -mt-1">{m.summary}</div>}
            {open === m.id && (
              <div className="px-3 pb-3 text-[13px] border-t border-zinc-800/60 pt-2">
                <Markdown>{m.body || ''}</Markdown>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
