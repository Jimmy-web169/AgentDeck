import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { fmtTokens } from '../../lib/format.js'

// Inline sub-agent thread: the collapsible block rendered right under the tool
// call that spawned a sub-agent. This file is presentation + lazy loading only;
// what counts as "the spawning call" and how a child transcript is fetched is
// the per-provider adapter's business (claude/subagentAdapter.js,
// codex/subagentAdapter.js), which supplies:
//   resolve(part, ctx)         → item | null   (ctx.claimed = ids already linked, ctx.ev = the assistant event)
//   fetchTranscript(item, ctx) → Promise<{ summary, timeline, … }>  (a Conversation `data`)
//   cacheKey(item, ctx)        → string
// The thread never navigates away: the Sub-agents tab is a separate way in,
// and the maintainer did not want the conversation to jump while reading.
//   accent                     → { border, rail, badge, text } theme-token classes
// item: { key, label, type, status, elapsedMs, toolCalls, tokens, expandable, agentCount?, note? }
//
// Nested sub-agents (a child spawning its own) render the header only — no
// recursion — which is what `ctx.depth >= 1` means here.

const STATUS_DOT = {
  done: 'bg-emerald-400',
  running: 'bg-amber-400 animate-pulse',
  starting: 'bg-sky-400 animate-pulse',
  stalled: 'bg-zinc-600',
  idle: 'bg-zinc-500',
  unknown: 'bg-zinc-500',
}

// Same wording as the provider apps' oversized-session placeholder.
const OVERSIZED_MSG = "This transcript exceeds the parse limit, so it can't be displayed."

export function fmtDur(ms) {
  if (!ms || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`
}

// Resolve every tool_use of a timeline once (the caller memoises the result)
// so rows stay cheap: AssistantMsg just looks its part id up in the map.
// `claimed` stops two calls from linking to the same agent when a fallback
// rule (description / timestamp) is used.
export function buildThreadMap(timeline, adapter, ctx) {
  const map = new Map()
  const claimed = new Set()
  for (const ev of timeline) {
    if (ev.kind !== 'assistant' || !ev.parts?.length) continue
    let rctx = null
    for (const p of ev.parts) {
      if (p.kind !== 'tool_call' || !p.id) continue
      if (!rctx) rctx = { ...ctx, claimed, ev }
      const item = adapter.resolve(p, rctx)
      if (item) map.set(p.id, item)
    }
  }
  return map
}

// A finished agent's transcript never changes, so it is fetched on the first
// expand and kept for the life of the page; running agents are refetched on
// every expand (and via ↻). Small LRU — a page rarely opens many threads.
const cache = new Map()
const CACHE_MAX = 24
function cacheGet(k) {
  const v = cache.get(k)
  if (v === undefined) return null
  cache.delete(k)
  cache.set(k, v)
  return v
}
function cacheSet(k, v) {
  cache.delete(k)
  cache.set(k, v)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

// The parent's sub-agent list (Claude: GET /api/subagents; Codex: the rich
// children list) fetched once per session key and refetched when `version`
// changes (the provider Conversation passes its `data` object, i.e. "the parent
// transcript was refetched"), never more often than INDEX_REFETCH_MS.
const INDEX_REFETCH_MS = 3000
export function useSubagentIndex({ enabled, key, version, fetcher }) {
  const [state, setState] = useState(null) // { key, data }
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const lastAt = useRef(0)
  const lastKey = useRef(null)
  useEffect(() => {
    if (!enabled || !key) return
    let cancelled = false
    let timer = null
    const run = () => {
      lastAt.current = Date.now()
      Promise.resolve()
        .then(() => fetcherRef.current())
        // reference short-circuit: a 304 hands back the same object (api.js), so
        // the setState bails and nothing below re-renders
        .then((d) => !cancelled && setState((prev) => (prev && prev.key === key && prev.data === d ? prev : { key, data: d })))
        .catch(() => {})
    }
    if (lastKey.current !== key) {
      lastKey.current = key
      run()
    } else {
      const wait = INDEX_REFETCH_MS - (Date.now() - lastAt.current)
      if (wait <= 0) run()
      else timer = setTimeout(run, wait)
    }
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, key, version])
  return state && state.key === key ? state.data : null
}

function SubagentThread({ item, adapter, ctx, Conversation }) {
  const [open, setOpen] = useState(false)
  const [tx, setTx] = useState(null) // { loading } | { error, status } | { data }
  const seq = useRef(0)
  const depth = ctx?.depth || 0
  const canExpand = depth === 0 && item.expandable !== false && !!Conversation
  const accent = adapter.accent
  const dot = STATUS_DOT[item.status] || STATUS_DOT.unknown
  // the child transcript resolves its own tool calls against the same index,
  // one level deeper (header-only there)
  const childCtx = useMemo(() => ({ ...ctx, depth: depth + 1 }), [ctx, depth])
  useEffect(() => () => void seq.current++, []) // drop responses that land after unmount

  const load = (force) => {
    const key = adapter.cacheKey(item, ctx)
    const hit = force ? null : cacheGet(key)
    if (hit) return setTx({ data: hit })
    const my = ++seq.current
    setTx({ loading: true })
    adapter
      .fetchTranscript(item, ctx)
      .then((d) => {
        if (my !== seq.current) return
        if (item.status === 'done') cacheSet(key, d)
        setTx({ data: d })
      })
      .catch((e) => my === seq.current && setTx({ error: e.message || 'failed to load', status: e.status }))
  }
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !tx) load(false)
  }

  return (
    <div className={`my-2 rounded-lg border ${accent.border} bg-ink-800/40`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[12px] min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} title={item.status} />
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${accent.badge}`}>⤷ {item.type}</span>
        <span className="text-zinc-200 truncate flex-1 min-w-[8rem]" title={item.label}>
          {item.label}
        </span>
        {item.elapsedMs > 0 && <span className="text-[11px] text-zinc-500 shrink-0">{fmtDur(item.elapsedMs)}</span>}
        {item.agentCount != null && <span className="text-[11px] text-zinc-500 shrink-0">{item.agentCount} agents</span>}
        {item.toolCalls != null && (
          <span className="text-[11px] text-zinc-500 shrink-0">
            {item.toolCalls} tool{item.toolCalls === 1 ? '' : 's'}
          </span>
        )}
        {item.tokens && <span className="text-[11px] text-zinc-500 font-mono shrink-0">↓{fmtTokens(item.tokens.output)}</span>}
        {item.note && <span className="text-[11px] text-amber-400/80 shrink-0">{item.note}</span>}
        {canExpand && (
          <button onClick={toggle} className={`shrink-0 text-[11px] ${accent.text} hover:underline`}>
            {open ? '▾ hide thread' : '▸ show thread'}
          </button>
        )}
        {open && tx && !tx.loading && (
          <button onClick={() => load(true)} title="Refetch this thread" className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-200">
            ↻
          </button>
        )}
      </div>
      {open && (
        <div className={`mx-2 mb-2 border-l-2 ${accent.rail} bg-ink-900/40 rounded-r-md max-h-[60vh] overflow-y-auto`}>
          {tx?.loading && <div className="p-4 text-center text-[12px] text-zinc-600">Loading thread…</div>}
          {tx?.error && <div className="p-4 text-center text-[12px] text-red-300">{tx.status === 413 ? OVERSIZED_MSG : tx.error}</div>}
          {tx?.data && <Conversation data={tx.data} compact subagentCtx={childCtx} />}
        </div>
      )}
    </div>
  )
}

export default memo(SubagentThread)
