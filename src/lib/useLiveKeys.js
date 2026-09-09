import { useEffect, useRef, useState } from 'react'

// Shell-level "what is being written to right now" across every provider and
// root. Two sets: session keys `${provider}|${root}|${id}` (tab dots, quick
// switcher rows) and project keys `${provider}|${root}|${slug}` (project rows).
// One SSE subscription; entries expire LIVE_MS after their last write.
const LIVE_MS = 8000

export const liveSessionKey = (provider, root, id) => `${provider}|${root}|${id}`
export const liveProjectKey = (provider, root, slug) => `${provider}|${root}|${slug}`

export default function useLiveKeys({ onChange } = {}) {
  const [live, setLive] = useState(() => ({ ids: new Set(), slugs: new Set() }))
  const timers = useRef(new Map())
  const onChangeRef = useRef(onChange)
  useEffect(() => void (onChangeRef.current = onChange), [onChange])

  useEffect(() => {
    const es = new EventSource('/events')
    es.onopen = () => window.dispatchEvent(new CustomEvent('agentdeck:files-changed'))
    const expire = (set, k) =>
      setLive((p) => {
        if (!p[set].has(k)) return p
        const n = new Set(p[set])
        n.delete(k)
        return { ...p, [set]: n }
      })
    const arm = (set, k) => {
      const old = timers.current.get(k)
      if (old) clearTimeout(old)
      timers.current.set(
        k,
        setTimeout(() => {
          timers.current.delete(k)
          expire(set, k)
        }, LIVE_MS)
      )
    }
    es.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type !== 'change') return
      const changes = (msg.changes || []).filter((c) => c.provider && c.root)
      if (!changes.length) return
      window.dispatchEvent(new CustomEvent('agentdeck:files-changed', { detail: changes }))
      onChangeRef.current?.(changes)
      setLive((prev) => {
        const ids = new Set(prev.ids)
        const slugs = new Set(prev.slugs)
        for (const c of changes) {
          if (c.id) {
            const k = liveSessionKey(c.provider, c.root, c.id)
            ids.add(k)
            arm('ids', k)
          }
          if (c.slug) {
            const k = liveProjectKey(c.provider, c.root, c.slug)
            slugs.add(k)
            arm('slugs', k)
          }
        }
        return { ids, slugs }
      })
    }
    return () => {
      es.close()
      for (const t of timers.current.values()) clearTimeout(t)
      timers.current.clear()
    }
  }, [])

  return live
}
