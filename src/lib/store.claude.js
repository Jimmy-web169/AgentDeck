import { useCallback, useEffect, useRef, useState } from 'react'
import { claudeApi as api } from '../api.js'
import { cancelReconnect, scheduleReconnect } from './liveSync.js'

export const keyOf = (e) => `${e.root}|${e.slug}|${e.id}`

let draftSeq = 0 // unique key suffix for not-yet-created "new conversation" drafts

// placeholder transcript for a brand-new conversation (before any turn lands)
const emptyTranscript = (title) => ({
  summary: { title: title || 'New conversation', userTurns: 0, assistantTurns: 0, toolCalls: 0, models: [], tokens: { input: 0, output: 0, cacheRead: 0 } },
  timeline: [],
})

// A persistent, app-level store of live "continue" chats — one WebSocket per
// session, keyed by root|slug|id. Connections live until explicitly closed (or
// the app unloads); switching the viewed session never tears one down, so a
// reply keeps streaming in the background. Invariant (verified in single-view):
// the overlay holds ONLY the in-flight turn; completed turns come from the
// transcript, which the store re-fetches at turn-end (resume appends to the same
// <id>.jsonl) and owns for the life of the chat — so re-entering mid-stream
// renders snapshot + overlay with no duplicated tool cards.
export default function useLiveChatStore({ onTurnLogged } = {}) {
  const [sessions, setSessions] = useState({}) // key -> slice
  const wss = useRef(new Map()) // key -> WebSocket
  const reconnects = useRef(new Map()) // key -> retry metadata
  const sessionsRef = useRef(sessions)
  useEffect(() => void (sessionsRef.current = sessions), [sessions])
  const onLogRef = useRef(onTurnLogged)
  useEffect(() => void (onLogRef.current = onTurnLogged), [onTurnLogged])

  const patch = useCallback((key, fn) => {
    setSessions((s) => (s[key] ? { ...s, [key]: fn(s[key]) } : s))
  }, [])
  const patchAsst = useCallback((key, fn) => {
    setSessions((s) => {
      const sl = s[key]
      if (!sl || sl.asst == null || !sl.items[sl.asst]) return s
      const items = [...sl.items]
      items[sl.asst] = fn(items[sl.asst])
      return { ...s, [key]: { ...sl, items } }
    })
  }, [])

  // Streaming deltas can arrive dozens of times per second; committing each one
  // to React state re-renders (and re-parses markdown for) the in-flight message
  // on every token. Buffer them and flush at most every FLUSH_MS.
  const FLUSH_MS = 80
  const deltaBuf = useRef(new Map()) // key -> { text, thinking }
  const deltaTimer = useRef(new Map()) // key -> timeout id
  const flushDeltas = useCallback((key) => {
    const t = deltaTimer.current.get(key)
    if (t) {
      clearTimeout(t)
      deltaTimer.current.delete(key)
    }
    const buf = deltaBuf.current.get(key)
    deltaBuf.current.delete(key)
    if (!buf) return
    patchAsst(key, (a) => ({ ...a, text: a.text + buf.text, thinking: (a.thinking || '') + buf.thinking }))
  }, [patchAsst])
  const bufferDelta = useCallback((key, field, text) => {
    const buf = deltaBuf.current.get(key) || { text: '', thinking: '' }
    buf[field] += text
    deltaBuf.current.set(key, buf)
    if (!deltaTimer.current.has(key)) {
      deltaTimer.current.set(
        key,
        setTimeout(() => {
          deltaTimer.current.delete(key)
          flushDeltas(key)
        }, FLUSH_MS)
      )
    }
  }, [flushDeltas])

  const handle = useCallback((key, entry, m) => {
    // any non-delta event must see the fully-applied text (e.g. a tool_use ends
    // the current assistant item) — flush pending buffered deltas first.
    if (m.type !== 'delta' && m.type !== 'thinking') flushDeltas(key)
    switch (m.type) {
      case 'ready':
        patch(key, (sl) => ({ ...sl, ready: true, error: null, account: m.account || null }))
        break
      case 'session-created':
        // a new conversation's id (and discovered slug) are now known — pin them so
        // turn-end refetches the right transcript (slice keeps its draft key)
        patch(key, (sl) => ({ ...sl, id: m.sessionId, slug: m.slug || sl.slug }))
        break
      case 'turn-start':
        setSessions((s) => {
          const sl = s[key]
          if (!sl) return s
          return { ...s, [key]: { ...sl, items: [...sl.items, { role: 'assistant', text: '', thinking: '' }], asst: sl.items.length } }
        })
        break
      case 'delta':
        bufferDelta(key, 'text', m.text)
        break
      case 'text':
        patchAsst(key, (a) => ({ ...a, text: a.text || m.text }))
        break
      case 'thinking':
        bufferDelta(key, 'thinking', m.text)
        break
      case 'tool_use':
        patch(key, (sl) => ({ ...sl, items: [...sl.items, { role: 'tool', id: m.id, name: m.name, input: m.input }], asst: null }))
        break
      case 'tool_result':
        patch(key, (sl) => ({ ...sl, items: sl.items.map((x) => (x.role === 'tool' && x.id === m.tool_use_id ? { ...x, result: m.content, isError: m.is_error } : x)) }))
        break
      case 'permission':
        patch(key, (sl) => ({ ...sl, items: [...sl.items, { role: 'perm', reqId: m.reqId, toolName: m.toolName, input: m.input }] }))
        break
      case 'result':
        break
      case 'turn-end': {
        const sl = sessionsRef.current[key]
        const realId = m.sessionId || sl?.id || entry.id // new sessions: id assigned via session-created
        const realSlug = m.slug || sl?.slug || entry.slug // new-path sessions: slug discovered server-side
        if (sl) {
          const lastUser = [...sl.items].reverse().find((x) => x.role === 'user')
          const lastAsst = [...sl.items].reverse().find((x) => x.role === 'assistant')
          if (lastUser?.text) onLogRef.current?.({ ...entry, slug: realSlug, id: realId, title: sl.title || entry.title }, { lastMessage: lastUser.text, reply: (lastAsst?.text || '').slice(0, 80) })
        }
        // resume appended to the same id; refetch the now-authoritative transcript,
        // then clear the overlay in the SAME update so the swap never flickers/dups.
        api
          .session(entry.root, realSlug, realId)
          .then((d) => patch(key, (s) => ({ ...s, slug: realSlug, transcript: d, items: [], streaming: false, asst: null })))
          .catch(() => patch(key, (s) => ({ ...s, streaming: false, asst: null }))) // keep overlay if refetch fails
        break
      }
      case 'error':
        patch(key, (sl) => ({ ...sl, error: m.error, streaming: false }))
        break
    }
  }, [patch, patchAsst, bufferDelta, flushDeltas])

  const connect = useCallback((key, entry, params) => {
    let meta = reconnects.current.get(key)
    if (!meta) {
      meta = { entry, params, attempt: 0, timer: null, closed: false, connectedOnce: false }
      reconnects.current.set(key, meta)
    } else {
      meta.entry = entry
      meta.params = params
      meta.closed = false
      if (meta.timer) clearTimeout(meta.timer)
      meta.timer = null
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/chat/claude?${new URLSearchParams(params).toString()}`)
    wss.current.set(key, ws)
    ws.onopen = () => {
      const recovering = meta.connectedOnce
      meta.connectedOnce = true
      meta.attempt = 0
      const sl = sessionsRef.current[key]
      if (recovering && sl?.id && sl.slug) {
        api.session(sl.root, sl.slug, sl.id).then((d) => patch(key, (s) => (
          s.streaming ? s : { ...s, transcript: d, items: [], asst: null, streaming: false }
        ))).catch(() => {})
      }
    }
    ws.onmessage = (e) => {
      let m
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      handle(key, entry, m)
    }
    ws.onclose = () => {
      if (wss.current.get(key) === ws) wss.current.delete(key)
      patch(key, (sl) => ({ ...sl, ready: false, streaming: false }))
      if (meta.closed || !sessionsRef.current[key]) return
      scheduleReconnect(meta, () => {
        const sl = sessionsRef.current[key]
        if (!sl || meta.closed) return
        const retryEntry = { ...meta.entry, root: sl.root, slug: sl.slug, id: sl.id }
        const retryParams = sl.id && sl.slug ? { root: sl.root, slug: sl.slug, id: sl.id } : meta.params
        connect(key, retryEntry, retryParams)
      })
    }
    ws.onerror = () => patch(key, (sl) => ({ ...sl, error: 'connection error' }))
    return ws
  }, [handle, patch])

  // open a live chat (idempotent). initialTranscript seeds the frozen base the
  // overlay sits on top of, captured BEFORE the first web turn writes the jsonl.
  const open = useCallback((entry, initialTranscript) => {
    const key = keyOf(entry)
    if (wss.current.has(key)) return key
    setSessions((s) => ({
      ...s,
      [key]: { key, root: entry.root, slug: entry.slug, id: entry.id, title: entry.title, ready: false, streaming: false, error: null, account: null, items: [], asst: null, transcript: initialTranscript || null },
    }))
    connect(key, entry, { root: entry.root, slug: entry.slug, id: entry.id })
    if (!initialTranscript) api.session(entry.root, entry.slug, entry.id).then((d) => patch(key, (sl) => ({ ...sl, transcript: d }))).catch(() => {})
    return key
  }, [connect, patch])

  // start a brand-new conversation under a project (no resume). The session id is
  // assigned by the backend on the first turn (session-created); until then the
  // slice lives under a stable draft key with an empty transcript.
  // entry: { root, slug?, cwd?, title }. slug for new-under-existing-project; cwd
  // for a brand-new project at an arbitrary path (slug is discovered server-side).
  const openNew = useCallback((entry) => {
    const key = `new|${entry.root}|${entry.slug || entry.cwd || ''}|${++draftSeq}`
    const title = entry.title || 'New conversation'
    setSessions((s) => ({
      ...s,
      [key]: { key, root: entry.root, slug: entry.slug || null, cwd: entry.cwd || null, id: null, title, isNew: true, ready: false, streaming: false, error: null, account: null, items: [], asst: null, transcript: emptyTranscript(title) },
    }))
    const params = { root: entry.root, new: '1' }
    if (entry.slug) params.slug = entry.slug
    if (entry.cwd) params.cwd = entry.cwd
    connect(key, { root: entry.root, slug: entry.slug || null, id: null }, params)
    return key
  }, [connect])

  const send = useCallback((key, message, mode) => {
    const ws = wss.current.get(key)
    if (!ws || ws.readyState !== 1) return false
    const txt = (message || '').trim()
    if (!txt) return false
    patch(key, (sl) => ({ ...sl, items: [{ role: 'user', text: txt }], asst: null, streaming: true, error: null }))
    ws.send(JSON.stringify({ type: 'send', message: txt, permissionMode: mode }))
    return true
  }, [patch])

  const respondPerm = useCallback((key, reqId, behavior, scope, answers) => {
    wss.current.get(key)?.send(JSON.stringify({ type: 'permission-response', reqId, behavior, scope, answers }))
    patch(key, (sl) => ({ ...sl, items: sl.items.map((x) => (x.role === 'perm' && x.reqId === reqId ? { ...x, decided: behavior } : x)) }))
  }, [patch])

  const close = useCallback((key) => {
    const meta = reconnects.current.get(key)
    if (meta) {
      cancelReconnect(meta)
      reconnects.current.delete(key)
    }
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
    const retryMap = reconnects.current
    return () => {
      for (const meta of retryMap.values()) {
        cancelReconnect(meta)
      }
      retryMap.clear()
      for (const ws of map.values()) {
        try {
          ws.close()
        } catch {}
      }
      map.clear()
    }
  }, [])

  return { sessions, open, openNew, send, respondPerm, close, keyOf }
}
