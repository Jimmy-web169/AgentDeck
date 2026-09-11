import { useCallback, useLayoutEffect, useRef } from 'react'
import { sessionKey } from '../../shared/identity.ts'
interface Options {
  provider: string
  root: string | null
  id: string | null
  view: string
  data: unknown
}

// Retain reader position separately from the Query-owned transcript. Returning
// to a cached session restores its position; live appends follow only when the
// reader was already within the established 80px bottom threshold.
export function useSessionPane<T extends HTMLElement = HTMLDivElement>({ provider, root, id, view, data }: Options) {
  const mainRef = useRef<T | null>(null)
  const positions = useRef(new Map<string, { top: number; stick: boolean }>())
  const shown = useRef<string | null>(null)
  const key = root && id ? sessionKey(provider, root, id) : null
  const onScroll = useCallback(() => {
    const el = mainRef.current
    if (!el || !key || view !== 'conversation') return
    positions.current.set(key, { top: el.scrollTop, stick: el.scrollTop + el.clientHeight >= el.scrollHeight - 80 })
  }, [key, view])
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el || !key || view !== 'conversation' || !data) return
    const memo = positions.current.get(key)
    if (shown.current !== key) {
      el.scrollTop = memo?.top ?? el.scrollHeight
      shown.current = key
    } else if (!memo || memo.stick) el.scrollTop = el.scrollHeight
    positions.current.set(key, { top: el.scrollTop, stick: memo?.stick ?? true })
  }, [key, view, data])
  return { mainRef, onScroll }
}
