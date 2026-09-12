import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationEvent } from '../../api/models.ts'
import { scrollParentOf } from '../../lib/useEarlier.ts'

// The rail is a fixed 30px column: two 26px buttons with 4px margins bracket
// the tick strip. CSS receives the shared sizes through custom properties.
const RAIL_WIDTH = 30
const BUTTON_SIZE = 26
const BUTTON_GAP = 4
const CHROME = 2 * (BUTTON_SIZE + 2 * BUTTON_GAP)
// Ticks keep a comfortable pitch. A short conversation groups at a capped
// pitch instead of stretching across the rail; a long one keeps the pitch and
// glides behind a reading mark that sweeps the whole rail.
const PITCH = 24
const MAX_PITCH = 32
const INSET = 8
const EDGE_FADE = 26
// A message column that fills its pane is inset by its own right padding so
// text and bubbles end this far before the rail; a column with a gutter keeps
// the stylesheet's 1rem padding.
const RAIL_CLEARANCE = 4
const COLUMN_PADDING = 16
// Holding an arrow runs to the edge; an early release is one ordinary step,
// so fast repeated clicks can never be misread as a jump.
const HOLD_MS = 420
// The label beside a hovered tick is one short line: as wide as the gutter
// beside the messages allows, never narrower than a few words nor wider than
// a glance, and never wrapped or unfolded.
const LABEL_MIN = 120
const LABEL_MAX = 260
// A wheel-browsed strip drifts back to the reading position this long after
// the pointer leaves the rail.
const BROWSE_RESET_MS = 1200

const round = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

// Overlay the nearest viewport without consuming transcript width. Parent and
// child conversations each control their own pane and tick strip.
export default function ConversationNavigator({
  timeline,
  rootRef,
  onJump,
}: {
  timeline: ConversationEvent[]
  rootRef: RefObject<HTMLElement>
  onJump: (index: number | 'top' | 'bottom') => void
}) {
  const prompts = useMemo(
    () => timeline.flatMap((event, index) => (event.kind === 'user' ? [{ index, text: event.text?.trim() || '(attachment)' }] : [])),
    [timeline]
  )
  const [viewport, setViewport] = useState({ top: 0, right: 0, height: 0, current: -1, progress: 0, gutter: 0, pane: 0 })
  const [hot, setHot] = useState<number | null>(null)
  const [clipped, setClipped] = useState(false)
  const [browse, setBrowse] = useState(0)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const dotsRef = useRef<HTMLFieldSetElement>(null)
  const resetTimer = useRef(0)
  // Render-time geometry the native wheel listener reads without re-binding.
  const geometry = useRef({ offset: 0, pitch: PITCH, usable: 1, windowed: false, count: 0, progress: 0, browse: 0 })
  const selectedPrompt = useRef<{ order: number; scrollTop: number | null } | null>(null)
  useEffect(() => {
    const root = rootRef.current,
      pane = scrollParentOf(root)
    if (!root || !pane) return
    // Dialog transcripts belong to their dialog's stacking context, while the
    // ordinary session rail stays below dialogs opened over the application.
    let host = pane
    while (host !== document.body && getComputedStyle(host).position !== 'fixed') host = host.parentElement || document.body
    setPortalHost(host)
    let frame = 0
    const measure = () => {
      const rect = pane.getBoundingClientRect()
      const top = Math.max(0, rect.top) + 4
      const height = Math.max(0, Math.min(window.innerHeight, rect.bottom) - top - 4)
      const line = rect.top + 24
      let current = -1
      const orders = new Map(prompts.map((prompt, order) => [prompt.index, order]))
      const tops = new Map<number, number>()
      for (const element of root.querySelectorAll<HTMLElement>('[data-conversation-index]')) {
        if (element.closest('.conversation-content') !== root) continue
        const order = orders.get(Number(element.dataset.conversationIndex))
        if (order === undefined) continue
        const elementTop = element.getBoundingClientRect().top
        tops.set(order, elementTop)
        if (elementTop <= line) current = order
      }
      if (pane.scrollHeight > pane.clientHeight && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4) current = prompts.length - 1
      // Several final questions can share the same clamped scroll position.
      // Keep an explicit jump selected until the reader actually scrolls away.
      let held = false
      const selected = selectedPrompt.current
      if (selected && prompts[selected.order]) {
        selected.scrollTop ??= pane.scrollTop
        if (Math.abs(selected.scrollTop - pane.scrollTop) < 1) {
          current = selected.order
          held = true
        } else selectedPrompt.current = null
      }
      // The reading position is fractional between questions, so the strip
      // glides instead of snapping; a held selection sits exactly on its tick.
      let progress = Math.max(0, current)
      const here = tops.get(current)
      if (!held && current >= 0 && here !== undefined) {
        const after = tops.get(current + 1)
        const span = after === undefined ? pane.clientHeight : after - here
        if (span > 0) progress = Math.min(prompts.length - 1, current + Math.max(0, Math.min(1, (line - here) / span)))
      }
      const scrollbar = pane.offsetWidth - pane.clientWidth
      // The empty gutter between the message column and the rail sizes the
      // label; a short label keeps to the pane's edge even without a gutter.
      const beyond = rect.right - scrollbar - root.getBoundingClientRect().right
      const gutter = Math.max(0, Math.round(beyond - RAIL_WIDTH - 6))
      const inset = Math.round(RAIL_WIDTH + RAIL_CLEARANCE - beyond)
      root.style.paddingRight = inset > COLUMN_PADDING ? `${inset}px` : ''
      const next = { top, right: Math.max(0, window.innerWidth - rect.right + scrollbar), height, current, progress, gutter, pane: pane.clientWidth }
      setViewport((old) => (Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // Scrolling only re-measures. A live transcript's bottom-follow scrolls
    // constantly, and a reader pointing at a tick must not lose its label;
    // when ticks glide under a still pointer the browser fires enter/leave.
    measure()
    pane.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(pane)
    observer?.observe(root)
    return () => {
      cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
      root.style.paddingRight = ''
    }
  }, [prompts, rootRef])
  useEffect(() => {
    if (hot === null) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setHot(null)
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [hot])
  // A label wider than its room fades at the rail; a short one ends there
  // whole. Measured before paint so the fade never flashes on or off.
  useLayoutEffect(() => {
    const text = hot === null ? null : navRef.current?.querySelector<HTMLElement>('.conversation-navigation-dot.is-hover .conversation-navigation-text')
    setClipped(!!text && text.scrollWidth > text.clientWidth + 1)
  }, [hot])
  // Wheeling over a long conversation's rail browses the strip instead of the
  // transcript, so a question can be found before jumping to it. React binds
  // wheel passively, so the listener that must preventDefault is native.
  useEffect(() => {
    const dots = dotsRef.current
    if (!dots) return
    const wheel = (event: WheelEvent) => {
      const g = geometry.current
      if (!g.windowed || g.count < 2) return
      event.preventDefault()
      const pixels = event.deltaMode === 1 ? event.deltaY * g.pitch : event.deltaMode === 2 ? event.deltaY * g.pitch * 8 : event.deltaY
      const next = clamp(g.browse + pixels / g.pitch, -g.progress, g.count - 1 - g.progress)
      if (next === g.browse) return
      g.browse = next
      setBrowse(next)
      // The strip moves under a still pointer; light the tick that arrives there.
      const centre = clamp(g.progress + next, 0, g.count - 1)
      const offset = INSET + (centre / (g.count - 1)) * g.usable - (centre * g.pitch + g.pitch / 2)
      const y = event.clientY - dots.getBoundingClientRect().top
      setHot(clamp(Math.round((y - offset - g.pitch / 2) / g.pitch), 0, g.count - 1))
    }
    dots.addEventListener('wheel', wheel, { passive: false })
    return () => {
      dots.removeEventListener('wheel', wheel)
      window.clearTimeout(resetTimer.current)
    }
  }, [])

  const count = prompts.length
  const dotsHeight = Math.max(0, viewport.height - CHROME)
  const usable = Math.max(1, dotsHeight - 2 * INSET)
  const windowed = count * PITCH > usable
  const pitch = windowed ? PITCH : Math.min(MAX_PITCH, usable / Math.max(1, count))
  const centre = clamp(viewport.progress + browse, 0, Math.max(0, count - 1))
  // Sliding a uniform strip by exactly one pitch puts every tick where its
  // neighbour was and changes no pixels; the mark sweeping the whole rail is the
  // motion a reader can actually see, so the strip's shift per step is
  // deliberately not a whole pitch.
  const offset = windowed ? INSET + (count > 1 ? centre / (count - 1) : 0) * usable - (centre * pitch + pitch / 2) : INSET + (usable - count * pitch) / 2
  geometry.current = { offset, pitch, usable, windowed, count, progress: viewport.progress, browse }
  const label = clamp(viewport.gutter - 6, LABEL_MIN, LABEL_MAX)
  const previous = viewport.current - 1,
    next = viewport.current + 1
  const settle = () => {
    setHot(null)
    setBrowse(0)
    window.clearTimeout(resetTimer.current)
  }
  const jumpPrompt = (order: number) => {
    if (prompts[order]) {
      selectedPrompt.current = { order, scrollTop: null }
      onJump(prompts[order].index)
    }
    settle()
  }
  const jumpEdge = (edge: 'top' | 'bottom') => {
    selectedPrompt.current = null
    onJump(edge)
    settle()
  }
  const leaveRail = () => {
    setHot(null)
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setBrowse(0), BROWSE_RESET_MS)
  }
  // Above the first rendered question, with earlier history still unloaded, the
  // previous arrow leads to the first message so that edge is never unreachable.
  const up = useHoldToEdge(
    () => (previous >= 0 ? jumpPrompt(previous) : jumpEdge('top')),
    () => jumpEdge('top')
  )
  const down = useHoldToEdge(
    () => jumpPrompt(next),
    () => jumpEdge('bottom')
  )
  // Keep the transcript's existing sibling structure; only the controls move
  // into the viewport portal. This empty mount consumes no message space.
  return (
    <div>
      {createPortal(
        <nav
          ref={navRef}
          aria-label="Conversation navigation"
          className="conversation-navigation text-zinc-300"
          style={
            {
              top: viewport.top,
              right: viewport.right,
              height: viewport.height,
              '--conversation-button-size': `${BUTTON_SIZE}px`,
              '--conversation-gutter': `${viewport.gutter}px`,
              '--conversation-pane': `${viewport.pane}px`,
              '--conversation-label': `${label}px`,
            } as CSSProperties
          }
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHot(null)
          }}
          onKeyDown={(event) => {
            if (hot !== null && event.key === 'Escape') {
              setHot(null)
              event.stopPropagation()
            }
          }}
        >
          <button
            type="button"
            aria-label="Previous user prompt"
            title="Previous question · hold, or Shift-click, for the first message"
            disabled={count === 0 || viewport.current === 0}
            className={`conversation-navigation-button${up.holding ? ' is-holding' : ''}`}
            {...up.handlers}
          >
            <span className="conversation-navigation-charge" aria-hidden="true" />
            <Arrow up />
          </button>
          <fieldset
            ref={dotsRef}
            aria-label="User prompts"
            className={`conversation-navigation-dots${hot !== null ? ' is-focus' : ''}`}
            onMouseEnter={() => window.clearTimeout(resetTimer.current)}
            onMouseLeave={leaveRail}
          >
            <div className="conversation-navigation-strip" style={{ transform: `translateY(${round(offset)}px)` }}>
              {prompts.map((prompt, order) => {
                const y = order * pitch + pitch / 2 + offset
                const edge = !windowed ? 1 : y < 0 || y > dotsHeight ? 0 : Math.max(0, Math.min(1, Math.min(y, dotsHeight - y) / EDGE_FADE))
                const off = edge <= 0.05
                const state = `${hot === order ? ` is-hover${clipped ? ' is-clipped' : ''}` : ''}${off ? ' is-off' : ''}`
                return (
                  <button
                    type="button"
                    key={prompt.index}
                    aria-label={`Question ${order + 1}: ${prompt.text}`}
                    aria-current={order === viewport.current ? 'step' : undefined}
                    aria-hidden={off || undefined}
                    tabIndex={off ? -1 : undefined}
                    className={`conversation-navigation-dot${state}`}
                    style={{ top: round(order * pitch), height: round(pitch), '--conversation-edge': round(edge) } as CSSProperties}
                    onMouseEnter={() => setHot(order)}
                    onFocus={() => setHot(order)}
                    onClick={() => jumpPrompt(order)}
                  >
                    <span className="conversation-navigation-tick" />
                    <span className="conversation-navigation-text">{prompt.text}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>
          <button
            type="button"
            aria-label="Next user prompt"
            title="Next question · hold, or Shift-click, for the latest message"
            disabled={count === 0 || next >= count}
            className={`conversation-navigation-button${down.holding ? ' is-holding' : ''}`}
            {...down.handlers}
          >
            <span className="conversation-navigation-charge" aria-hidden="true" />
            <Arrow />
          </button>
        </nav>,
        portalHost || document.body
      )}
    </div>
  )
}

// A press that outlasts HOLD_MS commits the edge jump; the click that follows a
// completed hold is swallowed, and an earlier release lets that click step as
// usual. Shift and the keyboard reach the edge without a press-and-hold.
function useHoldToEdge(step: () => void, edge: () => void) {
  const [holding, setHolding] = useState(false)
  const timer = useRef(0)
  const fired = useRef(false)
  const cancel = () => {
    window.clearTimeout(timer.current)
    timer.current = 0
    setHolding(false)
  }
  const start = () => {
    fired.current = false
    setHolding(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      fired.current = true
      setHolding(false)
      edge()
    }, HOLD_MS)
  }
  return {
    holding,
    handlers: {
      onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (event.button === 0 && !event.shiftKey) start()
      },
      onTouchStart: start,
      onMouseUp: cancel,
      onMouseLeave: cancel,
      onTouchEnd: cancel,
      onTouchCancel: cancel,
      onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (fired.current) {
          fired.current = false
          return
        }
        if (event.shiftKey) edge()
        else step()
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (event.shiftKey) edge()
        else step()
      },
    },
  }
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-4 h-4 ${up ? 'rotate-180' : ''}`}>
      <path d="M10 4v12m-5-5 5 5 5-5" />
    </svg>
  )
}
