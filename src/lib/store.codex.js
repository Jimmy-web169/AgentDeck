import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

export const keyOf = (e) => `${e.root}|${e.id}`

let draftSeq = 0 // unique key suffix for not-yet-created "new conversation" drafts

const emptyTranscript = (title) => ({
  summary: { title: title || 'New conversation', userTurns: 0, assistantTurns: 0, toolCalls: 0, models: [], tokens: { input: 0, output: 0, cacheRead: 0, total: 0 } },
  timeline: [],
})

// A persistent, app-level store of live "continue" chats — one WebSocket per
// session. Connections live until explicitly closed, so a reply keeps streaming
// when you navigate away. The overlay (`items`) holds the in-flight turn; on
// turn-end we refetch the now-authoritative transcript (Codex appends to the same
// rollout) and clear the overlay in one update, so re-entering never duplicates.
//
// Codex's SDK emits whole `item.completed` events (no token deltas), each with a
// stable id — so the overlay upserts items by id rather than streaming text.
export default function useLiveChatStore({ onTurnLogged } = {}) {
  const [sessions, setSessions] = useState({}) // key -> slice
  const wss = useRef(new Map()) // key -> WebSocket
  const sessionsRef = useRef(sessions)
  useEffect(() => void (sessionsRef.current = sessions), [sessions])
  const onLogRef = useRef(onTurnLogged)
  useEffect(() => void (onLogRef.current = onTurnLogged), [onTurnLogged])

  const patch = useCallback((key, fn) => {
    setSessions((s) => (s[key] ? { ...s, [key]: fn(s[key]) } : s))
  }, [])

  // upsert an item into the overlay by id (append if new)
  const upsertItem = useCallback((key, item) => {
    patch(key, (sl) => {
      const items = [...sl.items]
      const i = item.id ? items.findIndex((x) => x.id === item.id) : -1
      if (i >= 0) items[i] = { ...items[i], ...item }
      else items.push(item)
      return { ...sl, items }
    })
  }, [patch])

  const handle = useCallback((key, entry, m) => {
    switch (m.type) {
      case 'ready':
        patch(key, (sl) => ({ ...sl, ready: true, error: null, account: m.account || null, cwd: m.cwd || sl.cwd }))
        break
      case 'session-created':
        // a new conversation's id is now known — pin it so turn-end refetches the
        // right rollout (the slice keeps its stable draft key)
        patch(key, (sl) => ({ ...sl, id: m.sessionId, slug: m.slug || sl.slug }))
        break
      case 'turn-start':
        patch(key, (sl) => ({ ...sl, streaming: true, error: null }))
        break
      case 'item':
        upsertItem(key, m.item)
        break
      case 'turn-end': {
        const sl = sessionsRef.current[key]
        const realId = m.sessionId || sl?.id || entry.id
        if (sl) {
          const lastUser = [...sl.items].reverse().find((x) => x.kind === 'user')
          if (lastUser?.text) onLogRef.current?.({ ...entry, id: realId, title: sl.title || entry.title }, { lastMessage: lastUser.text })
        }
        if (!realId) {
          patch(key, (s) => ({ ...s, streaming: false }))
          break
        }
        // resume appended to the same rollout; refetch the authoritative transcript,
        // then clear the overlay in the SAME update so the swap never flickers/dups.
        api
          .session(entry.root, realId)
          .then((d) => patch(key, (s) => ({ ...s, id: realId, transcript: d, items: [], streaming: false })))
          .catch(() => patch(key, (s) => ({ ...s, streaming: false }))) // keep overlay if refetch fails
        break
      }
      case 'error':
        patch(key, (sl) => ({ ...sl, error: m.error, streaming: false }))
        break
    }
  }, [patch, upsertItem])

  const connect = useCallback((key, entry, params) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/chat/codex?${new URLSearchParams(params).toString()}`)
    wss.current.set(key, ws)
    ws.onmessage = (e) => {
      let m
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      handle(key, entry, m)
    }
    ws.onclose = () => patch(key, (sl) => ({ ...sl, ready: false }))
    ws.onerror = () => patch(key, (sl) => ({ ...sl, error: 'connection error' }))
    return ws
  }, [handle, patch])

  // open a live chat on an existing session (idempotent)
  const open = useCallback((entry, initialTranscript) => {
    const key = keyOf(entry)
    if (wss.current.has(key)) return key
    setSessions((s) => ({
      ...s,
      [key]: { key, root: entry.root, slug: entry.slug, id: entry.id, title: entry.title, ready: false, streaming: false, error: null, account: null, items: [], transcript: initialTranscript || null },
    }))
    connect(key, entry, { root: entry.root, id: entry.id })
    if (!initialTranscript) api.session(entry.root, entry.id).then((d) => patch(key, (sl) => ({ ...sl, transcript: d }))).catch(() => {})
    return key
  }, [connect, patch])

  // start a brand-new conversation (no resume). cwd or slug (= cwd) gives the dir.
  const openNew = useCallback((entry) => {
    const key = `new|${entry.root}|${entry.slug || entry.cwd || ''}|${++draftSeq}`
    const title = entry.title || 'New conversation'
    setSessions((s) => ({
      ...s,
      [key]: { key, root: entry.root, slug: entry.slug || entry.cwd || null, cwd: entry.cwd || entry.slug || null, id: null, title, isNew: true, ready: false, streaming: false, error: null, account: null, items: [], transcript: emptyTranscript(title) },
    }))
    const params = { root: entry.root, new: '1' }
    if (entry.slug) params.slug = entry.slug
    if (entry.cwd) params.cwd = entry.cwd
    connect(key, { root: entry.root, id: null }, params)
    return key
  }, [connect])

  const send = useCallback((key, message, mode) => {
    const ws = wss.current.get(key)
    if (!ws || ws.readyState !== 1) return false
    const txt = (message || '').trim()
    if (!txt) return false
    patch(key, (sl) => ({ ...sl, items: [{ kind: 'user', text: txt }], streaming: true, error: null }))
    ws.send(JSON.stringify({ type: 'send', message: txt, permissionMode: mode }))
    return true
  }, [patch])

  const close = useCallback((key) => {
    const ws = wss.current.get(key)
    if (ws) {
      try {
        ws.close()
      } catch {}
      wss.current.delete(key)
    }
    setSessions((s) => {
      if (!s[key]) return s
      const n = { ...s }
      delete n[key]
      return n
    })
  }, [])

  // close every connection when the app unmounts
  useEffect(() => {
    const map = wss.current
    return () => {
      for (const ws of map.values()) {
        try {
          ws.close()
        } catch {}
      }
      map.clear()
    }
  }, [])

  return { sessions, open, openNew, send, close, keyOf }
}
