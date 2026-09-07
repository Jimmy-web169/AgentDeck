import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// A long transcript renders only its tail at first, so opening a conversation
// stays instant. Earlier messages come in chunks — a click, or simply
// scrolling to the top — and what the reader was looking at stays exactly where
// it was: the scroll container's scrollTop grows by the height that was
// prepended. (The first version jumped straight to the very beginning and
// showed a loud bar for it; the maintainer found both jarring.)
export const INITIAL_TAIL = 40
export const EARLIER_CHUNK = 40

function scrollParentOf(el) {
  let n = el?.parentElement
  while (n && n !== document.body) {
    const o = getComputedStyle(n).overflowY
    if (o === 'auto' || o === 'scroll') return n
    n = n.parentElement
  }
  return null
}

// rootRef: the conversation's root element (to find the scroll container)
export function useEarlier(timeline, rootRef, { tail = INITIAL_TAIL, chunk = EARLIER_CHUNK } = {}) {
  const [startIdx, setStartIdx] = useState(() => Math.max(0, timeline.length - tail))
  const anchor = useRef(null)
  const topRef = useRef(null)

  const showEarlier = (all = false) => {
    const sp = scrollParentOf(rootRef.current)
    anchor.current = sp ? { sp, height: sp.scrollHeight, top: sp.scrollTop } : null
    setStartIdx((i) => (all ? 0 : Math.max(0, i - chunk)))
  }

  // the prepended chunk changes scrollHeight before paint — compensate so nothing moves on screen
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIdx])

  const visible = startIdx > 0 ? timeline.slice(startIdx) : timeline
  return { startIdx, visible, showEarlier, topRef, chunk }
}
