import { useCallback, useLayoutEffect, useRef } from 'react'
import type { UIEvent } from 'react'
import { sessionKey } from '../../shared/identity.ts'
interface Options {
  provider: string
  root: string | null
  id: string | null
  view: string
  data: unknown
  active?: boolean
}

// Opening or returning to a conversation shows its latest message. While the
// pane is visible, live updates follow only readers already near the bottom.
export function useSessionPane<T extends HTMLElement = HTMLDivElement>({ provider, root, id, view, data, active = true }: Options) {
  const mainRef = useRef<T | null>(null)
  const stick = useRef(true)
  const geometry = useRef({ height: 0, viewport: 0 })
  const readerIntent = useRef(false)
  const shown = useRef<string | null>(null)
  const key = root && id ? sessionKey(provider, root, id) : null
  const onScroll = useCallback(
    (event: UIEvent<T>) => {
      const el = mainRef.current
      if (!el || !key || !active || view !== 'conversation') return
      const resized = geometry.current.height !== el.scrollHeight || geometry.current.viewport !== el.clientHeight
      // Layout may emit a native scroll before ResizeObserver. Explicit navigator
      // events still update intent after revealing an earlier transcript chunk.
      if (!resized || readerIntent.current || !event.nativeEvent.isTrusted) {
        stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
        readerIntent.current = false
      }
      geometry.current = { height: el.scrollHeight, viewport: el.clientHeight }
    },
    [key, view, active]
  )
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!active || view !== 'conversation') {
      shown.current = null
      return
    }
    if (!el || !key || !data) return
    if (shown.current !== key) {
      stick.current = true
      shown.current = key
    }
    if (stick.current) el.scrollTop = el.scrollHeight
    geometry.current = { height: el.scrollHeight, viewport: el.clientHeight }
    // Reader input wins even when layout and a native scroll arrive in the
    // same frame. Mark upward intent before ResizeObserver can follow bottom.
    const intent = (up: boolean) => {
      readerIntent.current = true
      if (up) stick.current = false
    }
    const wheel = (event: WheelEvent) => {
      if (event.deltaY) intent(event.deltaY < 0)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) intent(true)
      else if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) intent(false)
    }
    let touchY = 0
    const touchstart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY || 0
    }
    const touchmove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? touchY
      if (y !== touchY) intent(y > touchY)
      touchY = y
    }
    const pointerdown = (event: PointerEvent) => {
      // Native scrollbar gestures target the scroll container itself.
      const edge = el.getBoundingClientRect().right - Math.max(12, el.offsetWidth - el.clientWidth)
      if (el.scrollHeight > el.clientHeight && event.target === el && event.clientX >= edge) intent(true)
    }
    el.addEventListener('wheel', wheel, { passive: true })
    el.addEventListener('keydown', keydown)
    el.addEventListener('touchstart', touchstart, { passive: true })
    el.addEventListener('touchmove', touchmove, { passive: true })
    el.addEventListener('pointerdown', pointerdown)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (stick.current) el.scrollTop = el.scrollHeight
            geometry.current = { height: el.scrollHeight, viewport: el.clientHeight }
          })
    observer?.observe(el)
    for (const child of el.children) observer?.observe(child)
    return () => {
      observer?.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('keydown', keydown)
      el.removeEventListener('touchstart', touchstart)
      el.removeEventListener('touchmove', touchmove)
      el.removeEventListener('pointerdown', pointerdown)
    }
  }, [key, view, data, active])
  return { mainRef, onScroll }
}
