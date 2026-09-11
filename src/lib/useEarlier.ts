import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// A long transcript renders only its tail at first, so opening a conversation
// stays instant. Earlier messages come in chunks — a click, or simply
// scrolling to the top — and what the reader was looking at stays exactly where
// it was: the scroll container's scrollTop grows by the height that was
// prepended. (The first version jumped straight to the very beginning and
// showed a loud bar for it; the maintainer found both jarring.)
export const INITIAL_TAIL = 40
export const EARLIER_CHUNK = 40

export function scrollParentOf(el: HTMLElement | null) {
  let n = el?.parentElement
  while (n && n !== document.body) {
    const o = getComputedStyle(n).overflowY
    if (o === 'auto' || o === 'scroll') return n
    n = n.parentElement
  }
  return null
}

// how far back each conversation was expanded, so re-opening it (another tab,
// the sidebar) shows the same extent and a remembered scroll position lands right
const START_MEMO = new Map<string, number>()

// rootRef: the conversation's root element (to find the scroll container);
// memoKey: the conversation's id (optional) for the extent memo above
export function useEarlier<T>(
  timeline: T[],
  rootRef: React.RefObject<HTMLElement>,
  { tail = INITIAL_TAIL, chunk = EARLIER_CHUNK, memoKey = null }: { tail?: number; chunk?: number; memoKey?: string | null } = {}
) {
  const [startIdx, setStartIdx] = useState(() => {
    const base = Math.max(0, timeline.length - tail)
    const m = memoKey ? START_MEMO.get(memoKey) : undefined
    return m !== undefined ? Math.min(m, base) : base
  })
  useEffect(() => {
    if (memoKey) START_MEMO.set(memoKey, startIdx)
  }, [memoKey, startIdx])
  const anchor = useRef<{ sp: HTMLElement; height: number; top: number } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const showEarlier = useCallback(
    (all = false) => {
      const sp = scrollParentOf(rootRef.current)
      anchor.current = sp ? { sp, height: sp.scrollHeight, top: sp.scrollTop } : null
      setStartIdx((i) => (all ? 0 : Math.max(0, i - chunk)))
    },
    [rootRef, chunk]
  )

  // the prepended chunk changes scrollHeight before paint — compensate so nothing moves on screen
  // biome-ignore lint/correctness/useExhaustiveDependencies: startIdx commits the prepended DOM; only then can its new scrollHeight restore the anchor.
  useLayoutEffect(() => {
    const a = anchor.current
    if (!a) return
    anchor.current = null
    a.sp.scrollTop = a.top + (a.sp.scrollHeight - a.height)
  }, [startIdx])

  // reaching the top loads the next chunk by itself
  useEffect(() => {
    if (startIdx === 0 || !topRef.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) showEarlier(false)
      },
      { root: scrollParentOf(rootRef.current), rootMargin: '160px 0px 0px 0px' }
    )
    io.observe(topRef.current)
    return () => io.disconnect()
  }, [startIdx, rootRef, showEarlier])

  const visible = startIdx > 0 ? timeline.slice(startIdx) : timeline
  const reveal = (index: number) => {
    anchor.current = null
    setStartIdx((current) => Math.min(current, Math.max(0, index)))
  }
  return { startIdx, visible, showEarlier, topRef, chunk, reveal }
}
