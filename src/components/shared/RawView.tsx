import { useMemo, useState } from 'react'

function Row({ rec, idx, label }: { rec: unknown; idx: number; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-zinc-800/60 font-mono text-[12px]">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-3 py-1.5 hover:bg-ink-700/40 flex gap-2">
        <span className="text-zinc-600 w-10 shrink-0">{idx}</span>
        <span className="text-amber-300 w-44 shrink-0 truncate">{label}</span>
        <span className="text-zinc-500 truncate flex-1">
          {(typeof rec === 'object' && rec !== null && 'timestamp' in rec ? String(rec.timestamp || '') : '') || ''}
        </span>
        <span className="text-zinc-600">{open ? '▾' : '▸'}</span>
      </button>
      {open && <pre className="px-3 pb-2 overflow-x-auto text-[11.5px] text-zinc-300 whitespace-pre-wrap break-words">{JSON.stringify(rec, null, 2)}</pre>}
    </div>
  )
}

// `typeOf` is the record-type discriminator used for the filter chips + row label.
// Default preserves claude behavior (`r.type`, falling back to '(no type)'); codex
// passes a richer discriminator that unwraps payload types.
export default function RawView({
  records,
  typeOf = (r: unknown) => (r && typeof r === 'object' && 'type' in r ? String(r.type || '(no type)') : '(no type)'),
}: {
  records: unknown[]
  typeOf?: (record: unknown) => string
}) {
  const [type, setType] = useState('')
  const types = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of records) m[typeOf(r)] = (m[typeOf(r)] || 0) + 1
    return m
  }, [records, typeOf])
  const filtered = type ? records.filter((r) => typeOf(r) === type) : records

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => setType('')}
          className={`text-[11px] px-2 py-1 rounded ${!type ? 'bg-sky-500/20 text-sky-200' : 'bg-ink-700 text-zinc-400'}`}
        >
          all ({records.length})
        </button>
        {Object.entries(types)
          .sort((a, b) => b[1] - a[1])
          .map(([t, n]) => (
            <button
              type="button"
              key={t}
              onClick={() => setType(t)}
              className={`text-[11px] px-2 py-1 rounded ${type === t ? 'bg-sky-500/20 text-sky-200' : 'bg-ink-700 text-zinc-400'}`}
            >
              {t} ({n})
            </button>
          ))}
      </div>
      <div className="rounded-lg border border-zinc-800 bg-ink-900/50">
        {filtered.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Raw transcript rows retain their append-only record ordinal; native records can lack IDs or repeat.
          <Row key={i} rec={r} idx={i} label={typeOf(r)} />
        ))}
      </div>
    </div>
  )
}
