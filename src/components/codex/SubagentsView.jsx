import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import useEscToClose from '../../lib/useEscToClose.js'
import Conversation from './Conversation.jsx'
import ContextMeter from './ContextMeter.jsx'
import { fmtTokens } from '../../lib/format.js'

// Codex subagents are independent top-level rollouts linked to a parent via
// session_meta. This view lists a parent's children (with context%, turns,
// tokens) and opens any child's full transcript in a modal.

function AgentRow({ c, onOpen }) {
  const title = c.title || c.firstPrompt || `agent ${c.id.slice(0, 8)}`
  return (
    <button onClick={() => onOpen(c)} className="w-full text-left px-3 py-2.5 hover:bg-ink-700/50 flex items-center gap-2.5 border-b border-zinc-800/50 group">
      <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 shrink-0 font-mono">
        {c.agentRole || 'agent'}{c.agentNickname ? ` · ${c.agentNickname}` : ''}
      </span>
      <span className="text-[12.5px] text-zinc-200 truncate flex-1 group-hover:text-white">{title}</span>
      {c.depth > 1 && <span className="text-[10px] text-zinc-600 shrink-0">depth {c.depth}</span>}
      <ContextMeter summary={c} label="ctx" />
      {c.tokens?.output > 0 && <span className="text-[10px] text-zinc-600 font-mono shrink-0">↓{fmtTokens(c.tokens.output)}</span>}
      <span className="text-[10px] text-zinc-500 shrink-0 w-16 text-right">{c.assistantTurns} replies</span>
      <span className="text-[10px] text-sky-400 opacity-0 group-hover:opacity-100 shrink-0 w-12 text-right">view →</span>
    </button>
  )
}

function TranscriptModal({ tx, onClose, onOpenSession }) {
  useEscToClose(onClose)
  const label = `${tx.c.agentRole || 'agent'}${tx.c.agentNickname ? ` (${tx.c.agentNickname})` : ''}`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="w-[860px] max-w-[95vw] h-[88vh] bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <div className="text-[13px] text-zinc-100 font-medium truncate">{label}</div>
            <div className="text-[11px] text-zinc-500 font-mono truncate">{tx.c.id}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-3">
            {onOpenSession && (
              <button onClick={() => { onOpenSession(tx.c.id); onClose() }} className="text-[11px] text-sky-400 hover:text-sky-300">open as session ↗</button>
            )}
            <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {tx.loading && <div className="p-8 text-center text-zinc-600">Loading transcript…</div>}
          {tx.error && <div className="p-8 text-center text-red-300">{tx.error}</div>}
          {tx.data && <Conversation data={tx.data} onOpenSession={onOpenSession} />}
        </div>
      </div>
    </div>
  )
}

export default function SubagentsView({ root, parent, onOpenSession }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tx, setTx] = useState(null)

  useEffect(() => {
    if (!root || !parent?.id) return
    setData(null)
    setError(null)
    api.subagents(root, parent.id).then(setData).catch((e) => setError(e.message))
  }, [root, parent?.id])

  const open = (c) => {
    setTx({ c, loading: true })
    api.session(root, c.id).then((d) => setTx({ c, data: d })).catch((e) => setTx({ c, error: e.message }))
  }

  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading sub-agents…</div>
  const children = data.children || []

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-zinc-100">Sub-agents</h2>
        <p className="text-[12px] text-zinc-500 mt-0.5">
          {children.length} subagent thread{children.length === 1 ? '' : 's'} spawned by this session. Each is its own rollout — click to view its full transcript (context, prompts, tool calls).
        </p>
      </div>
      {children.length === 0 ? (
        <div className="text-center text-zinc-600 py-10">This session spawned no sub-agents.</div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-ink-900/40 overflow-hidden">
          {children.map((c) => <AgentRow key={c.id} c={c} onOpen={open} />)}
        </div>
      )}
      {tx && <TranscriptModal tx={tx} onClose={() => setTx(null)} onOpenSession={onOpenSession} />}
    </div>
  )
}
