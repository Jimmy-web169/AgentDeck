// The quiet line above the first rendered message of a long conversation:
// "↑ 120 earlier · show 40 more · show all". Scrolling to the top does the
// same as the first button (see lib/useEarlier.js). `topRef` is the sentinel
// the auto-load watches.
export default function EarlierBar({ startIdx, chunk, total, onMore, onAll, topRef }) {
  if (startIdx <= 0) return null
  const n = Math.min(chunk, startIdx)
  return (
    <div ref={topRef} className="flex items-center justify-center gap-2 py-1 text-[11px] text-zinc-500 select-none">
      <button data-earlier onClick={onMore} className="hover:text-zinc-300" title={`Show the previous ${n} — scrolling to the top does the same`}>
        ↑ {startIdx} earlier · show {n} more
      </button>
      <span className="text-zinc-700">·</span>
      <button data-earlier-all onClick={onAll} className="hover:text-zinc-300" title={`Show all ${total}`}>
        show all
      </button>
    </div>
  )
}
