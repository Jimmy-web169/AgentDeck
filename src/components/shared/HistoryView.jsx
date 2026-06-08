import { useState } from 'react'
import { fmtRelative } from '../../lib/format.js'

export default function HistoryView({ data }) {
  const [q, setQ] = useState('')
  if (!data) return <div className="p-8 text-zinc-600">Loading history…</div>
  const items = (data.history || []).filter((h) => !q || (h.display || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-3 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search prompt history…"
          className="flex-1 bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600"
        />
        <span className="text-[12px] text-zinc-600">{items.length} prompts</span>
      </div>
      <div className="space-y-1.5">
        {items.map((h, i) => (
          <div key={i} className="rounded-lg bg-ink-700/40 border border-zinc-800 px-3 py-2">
            <div className="text-[13px] text-zinc-200 whitespace-pre-wrap break-words line-clamp-3">{h.display}</div>
            <div className="mt-1 flex gap-3 text-[10.5px] text-zinc-600 font-mono">
              {h.ts && <span>{fmtRelative(h.ts)}</span>}
              {h.project && <span className="truncate">{h.project}</span>}
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-center text-zinc-600 py-10">No prompt history.</div>}
      </div>
    </div>
  )
}
