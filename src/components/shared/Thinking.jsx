import { useState } from 'react'

// `label` lets a provider override the disclosure caption (claude: 'thinking',
// codex: 'reasoning'). Default preserves claude behavior.
export default function Thinking({ text, label = 'thinking' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-2 border-l-2 border-violet-500/40 pl-3">
      <button
        onClick={() => setOpen(!open)}
        className="text-[12px] text-violet-300/80 hover:text-violet-200 flex items-center gap-1"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span className="italic">{label}</span>
        {!open && <span className="text-zinc-600">({text.length} chars)</span>}
      </button>
      {open && (
        <div className="mt-1 text-[13px] leading-6 text-zinc-400 italic whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  )
}
