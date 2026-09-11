import { useRef, useState } from 'react'

// A small circled-"i" affordance. Hover (or focus) to reveal a short tooltip
// explaining a piece of UI. `align` controls which edge the bubble hangs from
// so it never spills off-screen near the window edge.
// The bubble is position:fixed (anchored to the button's rect) rather than
// absolute: both headers that host an InfoDot are h-12 overflow-x-auto bars,
// where an absolute bubble overflows the container — the scrollbar it summons
// shifts the content, closes the tooltip, and the bar oscillates forever.
// Those bars are also `whitespace-nowrap`, which the bubble would inherit and
// render its text as one endless line off-screen — hence `whitespace-normal`.
export default function InfoDot({ text, align = 'right', className = '' }: { text: React.ReactNode; align?: string; className?: string }) {
  const [pos, setPos] = useState<React.CSSProperties | null>(null) // null = closed; {top,left,right} = open
  const btnRef = useRef<HTMLButtonElement>(null)

  // the bubble is 16rem wide; whichever edge it hangs from, it is clamped to
  // the viewport so a dot near the window edge (Preferences sits at the far
  // right) never has its text cut off
  const open = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const W = 256
    const M = 8
    const top = r.bottom + 6
    if (align === 'left') setPos({ top, left: Math.max(M, Math.min(r.left, window.innerWidth - W - M)) })
    else setPos({ top, right: Math.max(M, Math.min(window.innerWidth - r.right, window.innerWidth - W - M)) })
  }
  const close = () => setPos(null)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Hover extends the same tooltip exposed by the child button on keyboard focus.
    <span className={`relative inline-flex items-center ${className}`} onMouseEnter={open} onMouseLeave={close}>
      <button
        ref={btnRef}
        type="button"
        aria-label="More info"
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          e.preventDefault()
          pos ? close() : open()
        }}
        className="w-3.5 h-3.5 rounded-full border border-zinc-600 text-zinc-500 hover:text-zinc-200 hover:border-zinc-400 text-[9px] leading-none flex items-center justify-center font-serif italic"
      >
        i
      </button>
      {pos && (
        <span
          style={pos}
          className="fixed z-50 w-64 max-w-[calc(100vw-16px)] rounded-md border border-zinc-700 bg-ink-800 px-3 py-2 text-[11px] font-normal leading-relaxed text-zinc-300 shadow-xl normal-case tracking-normal whitespace-normal break-words text-left"
        >
          {text}
        </span>
      )}
    </span>
  )
}
