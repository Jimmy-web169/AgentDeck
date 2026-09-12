import { useEffect, useMemo, useRef, useState } from 'react'
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
// Brushing a tick is immediate; the question unfolds only after a deliberate
// dwell, and holding an arrow runs to the edge while an early release is one
// ordinary step, so fast repeated clicks can never be misread as a jump.
const DWELL_MS = 400
const HOLD_MS = 420
// Below this gutter width no line is readable: brushing shows no text at all,
// and only a dwell may paint a soft ground over the transcript.
const MIN_READABLE = 140
const MAX_UNFOLD = 300

type Hot = { order: number; stage: 'hover' | 'dwell'; clipped: boolean; maxHeight: number | null }

const round = (value: number) => Math.round(value * 100) / 100

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
  const [viewport, setViewport] = useState({ top: 0, right: 0, height: 0, current: -1, progress: 0, gutter: 0 })
  const [hot, setHot] = useState<Hot | null>(null)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const texts = useRef(new Map<number, HTMLSpanElement>())
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
      // The empty gutter between the message column and the rail is the only
      // space the question text may occupy, so it can never cover a message.
      const gutter = Math.max(0, Math.round(rect.right - scrollbar - RAIL_WIDTH - root.getBoundingClientRect().right - 6))
      const next = { top, right: Math.max(0, window.innerWidth - rect.right + scrollbar), height, current, progress, gutter }
      setViewport((old) => (Object.keys(next).every((key) => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const scroll = () => {
      setHot(null)
      schedule()
    }
    measure()
    pane.addEventListener('scroll', scroll, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(pane)
    observer?.observe(root)
    return () => {
      cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', scroll)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
    }
  }, [prompts, rootRef])
  useEffect(() => {
    if (!hot) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setHot(null)
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [hot])
  const hotOrder = hot?.order,
    hotStage = hot?.stage
  useEffect(() => {
    if (hotOrder === undefined || hotStage !== 'hover') return
    const timer = window.setTimeout(() => {
      // Measure the whole question before unfolding, so the growth animates
      // across its real height instead of finishing in the first few frames.
      const wanted = texts.current.get(hotOrder)?.scrollHeight || 0
      const cap = Math.min(Math.round(window.innerHeight * 0.42), MAX_UNFOLD)
      setHot((old) =>
        old && old.order === hotOrder && old.stage === 'hover'
          ? { order: hotOrder, stage: 'dwell', clipped: wanted > cap, maxHeight: wanted > 0 ? Math.min(wanted, cap) : cap }
          : old
      )
    }, DWELL_MS)
    return () => window.clearTimeout(timer)
  }, [hotOrder, hotStage])

  const count = prompts.length
  const dotsHeight = Math.max(0, viewport.height - CHROME)
  const usable = Math.max(1, dotsHeight - 2 * INSET)
  const windowed = count * PITCH > usable
  const pitch = windowed ? PITCH : Math.min(MAX_PITCH, usable / Math.max(1, count))
  // Sliding a uniform strip by exactly one pitch puts every tick where its
  // neighbour was and changes no pixels; the mark sweeping the whole rail is the
  // motion a reader can actually see, so the strip's shift per step is
  // deliberately not a whole pitch.
  const offset = windowed
    ? INSET + (count > 1 ? viewport.progress / (count - 1) : 0) * usable - (viewport.progress * pitch + pitch / 2)
    : INSET + (usable - count * pitch) / 2
  const tight = viewport.gutter < MIN_READABLE
  const previous = viewport.current - 1,
    next = viewport.current + 1
  const jumpPrompt = (order: number) => {
    if (prompts[order]) {
      selectedPrompt.current = { order, scrollTop: null }
      onJump(prompts[order].index)
    }
    setHot(null)
  }
  const jumpEdge = (edge: 'top' | 'bottom') => {
    selectedPrompt.current = null
    onJump(edge)
    setHot(null)
  }
  const enter = (order: number) => setHot((old) => (old?.order === order ? old : { order, stage: 'hover', clipped: false, maxHeight: null }))
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
            } as CSSProperties
          }
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHot(null)
          }}
          onKeyDown={(event) => {
            if (hot && event.key === 'Escape') {
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
            aria-label="User prompts"
            className={`conversation-navigation-dots${hot?.stage === 'dwell' ? ' is-focus' : ''}`}
            onMouseLeave={() => setHot(null)}
          >
            <div className="conversation-navigation-strip" style={{ transform: `translateY(${round(offset)}px)` }}>
              {prompts.map((prompt, order) => {
                const y = order * pitch + pitch / 2 + offset
                const edge = !windowed ? 1 : y < 0 || y > dotsHeight ? 0 : Math.max(0, Math.min(1, Math.min(y, dotsHeight - y) / EDGE_FADE))
                const off = edge <= 0.05
                const mine = hot?.order === order ? hot : null
                const state = [
                  mine ? ` is-${mine.stage}` : '',
                  tight ? ' is-tight' : '',
                  tight && mine?.stage === 'dwell' ? ' is-scrim' : '',
                  mine?.clipped ? ' is-clipped' : '',
                  off ? ' is-off' : '',
                ].join('')
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
                    onMouseEnter={() => enter(order)}
                    onFocus={() => enter(order)}
                    onClick={() => jumpPrompt(order)}
                  >
                    <span className="conversation-navigation-tick" />
                    <span
                      className="conversation-navigation-text"
                      ref={(element) => {
                        if (element) texts.current.set(order, element)
                        else texts.current.delete(order)
                      }}
                      style={mine?.maxHeight != null ? { maxHeight: mine.maxHeight } : undefined}
                    >
                      {prompt.text}
                    </span>
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
