import { useRef, useState } from 'react'

// A small circled-"i" affordance. Hover (or focus) to reveal a short tooltip
// explaining a piece of UI. `align` controls which edge the bubble hangs from
// so it never spills off-screen near the window edge.
// The bubble is position:fixed (anchored to the button's rect) rather than
// absolute: both headers that host an InfoDot are h-12 overflow-x-auto bars,
// where an absolute bubble overflows the container — the scrollbar it summons
// shifts the content, closes the tooltip, and the bar oscillates forever.
export default function InfoDot({ text, align = 'right', className = '' }) {
  const [pos, setPos] = useState(null) // null = closed; {top,left,right} = open
  const btnRef = useRef(null)

  const open = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos(
      align === 'left'
        ? { top: r.bottom + 6, left: r.left }
        : { top: r.bottom + 6, right: window.innerWidth - r.right }
    )
  }
  const close = () => setPos(null)

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label="More info"
        onFocus={open}
        onBlur={close}
        onClick={(e) => { e.preventDefault(); pos ? close() : open() }}
        className="w-3.5 h-3.5 rounded-full border border-zinc-600 text-zinc-500 hover:text-zinc-200 hover:border-zinc-400 text-[9px] leading-none flex items-center justify-center font-serif italic"
      >
        i
      </button>
      {pos && (
        <span
          style={pos}
          className="fixed z-50 w-64 rounded-md border border-zinc-700 bg-ink-800 px-3 py-2 text-[11px] font-normal leading-relaxed text-zinc-300 shadow-xl normal-case tracking-normal"
        >
          {text}
        </span>
      )}
    </span>
  )
}
