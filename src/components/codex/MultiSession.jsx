import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { keyOf as liveKeyOf } from '../../lib/store.codex.js'
import Conversation from './Conversation.jsx'
import SubagentsView from './SubagentsView.jsx'
import RawView from '../shared/RawView.jsx'
import ResourcesView from './ResourcesView.jsx'
import ChatComposer from '../shared/ChatComposer.jsx'
import TerminalPanel from './TerminalPanel.jsx'

// codex sessions are addressed by root+id (slug/cwd is only a grouping)
const keyOf = (s) => `${s.root}|${s.id}`

const PANE_TABS = [
  { k: 'conversation', label: 'Conv' },
  { k: 'subagents', label: 'Subs' },
  { k: 'raw', label: 'Raw' },
  { k: 'config', label: 'Config' },
]

const Loading = () => <div className="p-8 text-center text-zinc-600">Loading…</div>

// A full per-session view (its own Conv/Sub-agents/Raw/Config tabs + composer or
// terminal) embedded in a compare pane — reuses the single-session components.
function SessionPane({ entry, version, live, chatMode, onChatMode, liveCount, onOpenManager, engine, runningKeys, onTermChange, onOpenSession }) {
  const [tab, setTab] = useState('conversation')
  const [conv, setConv] = useState(null)
  const [raw, setRaw] = useState(null)
  const [err, setErr] = useState(null)

  const key = liveKeyOf(entry)
  const slice = live.sessions[key]

  useEffect(() => {
    setConv(null)
    setRaw(null)
    setErr(null)
  }, [entry?.root, entry?.id])

  // fetch the active tab's data; refetch on live change (version). While a live
  // chat owns this session's transcript, skip the conversation fetch.
  useEffect(() => {
    if (!entry) return
    let c = false
    const go = (pr, set) => pr.then((d) => !c && set(d)).catch((e) => !c && setErr(e.message))
    if (tab === 'conversation') {
      if (!slice) go(api.session(entry.root, entry.id), setConv)
    } else if (tab === 'raw') go(api.raw(entry.root, entry.id), setRaw)
    return () => {
      c = true
    }
  }, [entry?.root, entry?.id, tab, version, !!slice])

  const ctxSummary = slice?.transcript?.summary || conv?.summary

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex gap-0.5 px-2 py-1 border-b border-zinc-800 bg-ink-900/30 overflow-x-auto">
        {PANE_TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`text-[11px] px-2 py-0.5 rounded shrink-0 ${tab === t.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'config' ? (
        <div className="flex-1 min-h-0">
          {entry.cwd ? (
            <ResourcesView key={`${entry.root}|${entry.cwd}`} root={entry.root} scope="project" slug={entry.cwd} />
          ) : (
            <div className="p-4 text-[12px] text-zinc-600">No project directory for this session.</div>
          )}
        </div>
      ) : tab === 'subagents' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SubagentsView root={entry.root} parent={{ id: entry.id, title: entry.title }} onOpenSession={onOpenSession} />
        </div>
      ) : tab === 'conversation' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {err && <div className="p-4 text-[13px] text-red-300">{err}</div>}
            {slice?.transcript || conv ? (
              <Conversation data={slice?.transcript || conv} live={slice ? { items: slice.items } : null} onOpenSession={onOpenSession} />
            ) : (
              <Loading />
            )}
          </div>
          {engine === 'terminal' ? (
            <TerminalPanel root={entry.root} id={entry.id} title={entry.title} contextSummary={ctxSummary} runningKeys={runningKeys} onChange={onTermChange} onOpenTool={(what) => api.open(entry.root, entry.id, what)} />
          ) : (
            <ChatComposer
              slice={slice}
              contextSummary={ctxSummary}
              onOpen={() => live.open({ root: entry.root, id: entry.id, title: entry.title, slug: entry.cwd }, slice?.transcript || conv)}
              onClose={() => { live.close(key); api.session(entry.root, entry.id).then(setConv).catch(() => {}) }}
              mode={chatMode}
              onMode={onChatMode}
              onSend={(t) => live.send(key, t, chatMode)}
              liveCount={liveCount}
              onOpenManager={onOpenManager}
              onOpenTool={(what) => api.open(entry.root, entry.id, what)}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {err && <div className="p-4 text-[13px] text-red-300">{err}</div>}
          {tab === 'raw' && (raw ? <RawView records={raw.records} /> : <Loading />)}
        </div>
      )}
    </div>
  )
}

export default function MultiSession({ openSessions, panes, paneKeys, setPaneKey, onCloseSession, sessionVersions, rootLabels, live, chatMode, onChatMode, liveCount, onOpenManager, engine, runningKeys, onTermChange, onOpenSession }) {
  const byKey = (k) => openSessions.find((s) => keyOf(s) === k) || null
  return (
    <div className="flex h-full min-h-0 divide-x divide-zinc-800">
      {Array.from({ length: panes }).map((_, i) => {
        const k = paneKeys[i] || ''
        const entry = byKey(k)
        return (
          <div key={i} className="flex-1 min-w-0 flex flex-col">
            <div className="h-9 shrink-0 flex items-center gap-1.5 px-2 border-b border-zinc-800 bg-ink-900/40">
              <select value={k} onChange={(e) => setPaneKey(i, e.target.value)} className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-300">
                <option value="">— select session —</option>
                {openSessions.map((s) => (
                  <option key={keyOf(s)} value={keyOf(s)}>
                    {s.title}
                    {rootLabels?.[s.root] ? ` · ${rootLabels[s.root]}` : ''}
                  </option>
                ))}
              </select>
              {entry && (
                <button onClick={() => onCloseSession(k)} title="Remove from workspace" className="shrink-0 text-zinc-500 hover:text-red-300 px-1">
                  ×
                </button>
              )}
            </div>
            {entry ? (
              <SessionPane
                entry={entry}
                version={sessionVersions[entry.id]}
                live={live}
                chatMode={chatMode}
                onChatMode={onChatMode}
                liveCount={liveCount}
                onOpenManager={onOpenManager}
                engine={engine}
                runningKeys={runningKeys}
                onTermChange={onTermChange}
                onOpenSession={onOpenSession}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm text-center px-4">
                Add sessions with ⊞ in the sidebar, then pick one here.
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
