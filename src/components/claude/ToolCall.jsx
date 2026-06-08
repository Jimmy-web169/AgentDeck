import { useState } from 'react'

// Per-tool accent + how to preview the input on the collapsed header.
const TOOL_META = {
  Bash: { color: 'text-emerald-300', badge: 'bg-emerald-500/15', preview: (i) => i.command },
  Read: { color: 'text-sky-300', badge: 'bg-sky-500/15', preview: (i) => i.file_path },
  Edit: { color: 'text-amber-300', badge: 'bg-amber-500/15', preview: (i) => i.file_path },
  Write: { color: 'text-amber-300', badge: 'bg-amber-500/15', preview: (i) => i.file_path },
  Grep: { color: 'text-fuchsia-300', badge: 'bg-fuchsia-500/15', preview: (i) => i.pattern },
  Glob: { color: 'text-fuchsia-300', badge: 'bg-fuchsia-500/15', preview: (i) => i.pattern },
  Task: { color: 'text-violet-300', badge: 'bg-violet-500/15', preview: (i) => i.description },
  Agent: { color: 'text-violet-300', badge: 'bg-violet-500/15', preview: (i) => i.description },
  Workflow: { color: 'text-rose-300', badge: 'bg-rose-500/15', preview: (i) => i.name || 'inline script' },
  WebFetch: { color: 'text-cyan-300', badge: 'bg-cyan-500/15', preview: (i) => i.url },
  WebSearch: { color: 'text-cyan-300', badge: 'bg-cyan-500/15', preview: (i) => i.query },
}

function previewOf(name, input) {
  const m = TOOL_META[name]
  let s = ''
  try {
    s = m?.preview ? m.preview(input) : ''
  } catch {}
  if (!s && input) s = Object.values(input).find((v) => typeof v === 'string') || ''
  return (s || '').toString().replace(/\s+/g, ' ').slice(0, 120)
}

function Pre({ children }) {
  return (
    <pre className="bg-ink-900 rounded-md p-2.5 mt-1 overflow-x-auto text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-96">
      {children}
    </pre>
  )
}

export default function ToolCall({ part }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[part.name] || { color: 'text-zinc-300', badge: 'bg-zinc-500/15' }
  const result = part.result
  const err = result?.isError
  const inputStr = JSON.stringify(part.input ?? {}, null, 2)

  return (
    <div className={`rounded-lg border ${err ? 'border-red-500/40' : 'border-zinc-700/70'} bg-ink-700/60 my-2`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ink-600/40 rounded-lg"
      >
        <span className="text-zinc-500 text-xs w-3">{open ? '▾' : '▸'}</span>
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${meta.badge} ${meta.color}`}>
          {part.server ? '🌐 ' : ''}
          {part.name || 'tool'}
        </span>
        <span className="text-zinc-400 text-[12px] font-mono truncate flex-1">{previewOf(part.name, part.input)}</span>
        {err ? (
          <span className="text-[10px] text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded">error</span>
        ) : result ? (
          <span className="text-[10px] text-zinc-500">✓</span>
        ) : (
          <span className="text-[10px] text-zinc-600">no result</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 mt-1">input</div>
          <Pre>{inputStr}</Pre>
          {result && (
            <>
              <div className={`text-[11px] uppercase tracking-wide mt-2 ${err ? 'text-red-400' : 'text-zinc-500'}`}>
                output{err ? ' (error)' : ''}
              </div>
              <Pre>{typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2)}</Pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
