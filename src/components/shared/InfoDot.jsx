import { useState } from 'react'

// A small circled-"i" affordance. Hover (or focus) to reveal a short tooltip
// explaining a piece of UI. `align` controls which edge the bubble hangs from
// so it never spills off-screen near the window edge.
export default function InfoDot({ text, align = 'right', className = '' }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o) }}
        className="w-3.5 h-3.5 rounded-full border border-zinc-600 text-zinc-500 hover:text-zinc-200 hover:border-zinc-400 text-[9px] leading-none flex items-center justify-center font-serif italic"
      >
        i
      </button>
      {open && (
        <span
          className={`absolute top-5 z-50 w-64 rounded-md border border-zinc-700 bg-ink-800 px-3 py-2 text-[11px] font-normal leading-relaxed text-zinc-300 shadow-xl normal-case tracking-normal ${align === 'left' ? 'left-0' : 'right-0'}`}
        >
          {text}
        </span>
      )}
    </span>
  )
}
