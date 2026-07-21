import { useEffect, useState } from 'react'
import { claudeApi as api } from '../../api.js'
import Conversation from './Conversation.jsx'
import SubagentsView from './SubagentsView.jsx'
import RawView from '../shared/RawView.jsx'
import MemoryView from './MemoryView.jsx'
import Resources from './Resources.jsx'
import ChatComposer from '../shared/ChatComposer.jsx'
import TerminalPanel from './TerminalPanel.jsx'
import ErrorBoundary from '../shared/ErrorBoundary.jsx'
import { getSessionVersion, isLiveAuthoritative, startFallbackPoll } from '../../lib/liveSync.js'

const keyOf = (s) => `${s.root}|${s.slug}|${s.id}`

const PANE_TABS = [
  { k: 'conversation', label: 'Conv' },
  { k: 'subagents', label: 'Subs' },
  { k: 'raw', label: 'Raw' },
  { k: 'memory', label: 'Mem' },
  { k: 'config', label: 'Config' },
]

// A full per-session view (its own Conversation/Sub-agents/Raw/Memory/Config
// tabs) embedded in a compare pane — reuses the single-session components.
function SessionPane({ entry, version, active, live, chatMode, onChatMode, liveCount, onOpenManager, engine, runningKeys, onTermChange }) {
  const [tab, setTab] = useState('conversation')
  const [conv, setConv] = useState(null)
  const [subs, setSubs] = useState(null)
  const [raw, setRaw] = useState(null)
  const [mem, setMem] = useState(null)
  const [err, setErr] = useState(null)

  const key = live.keyOf(entry)
  const slice = live.sessions[key]

  // reset caches when the pane's session changes
  useEffect(() => {
    setConv(null)
    setSubs(null)
    setRaw(null)
    setMem(null)
    setErr(null)
  }, [entry?.root, entry?.slug, entry?.id])

  // fetch the active tab's data; refetch when this session changes live (version).
  // While a live chat is attached to this session, the store owns its transcript
  // (so re-entry mid-stream shows snapshot + overlay, no dup) — skip the fetch.
  useEffect(() => {
    if (!entry || !active) return
    let c = false
    const go = (pr, set) => pr.then((d) => !c && set(d)).catch((e) => !c && setErr(e.message))
    const load = () => {
      if (tab === 'conversation') {
        if (!isLiveAuthoritative(slice)) go(api.session(entry.root, entry.slug, entry.id), setConv)
      } else if (tab === 'subagents') go(api.subagents(entry.root, entry.slug, entry.id), setSubs)
      else if (tab === 'raw') go(api.raw(entry.root, entry.slug, entry.id), setRaw)
      else if (tab === 'memory') go(api.memory(entry.root, entry.slug), setMem)
    }
    load()
    const stopPoll = ['conversation', 'subagents', 'raw'].includes(tab)
      ? startFallbackPoll(load, FALLBACK_POLL_MS)
      : () => {}
    return () => {
      c = true
      stopPoll()
    }
  }, [active, entry?.root, entry?.slug, entry?.id, tab, version, slice?.ready])

  const transcript = isLiveAuthoritative(slice) ? slice.transcript : conv || slice?.transcript

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex gap-0.5 px-2 py-1 border-b border-zinc-800 bg-ink-900/30 overflow-x-auto">
        {PANE_TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`text-[11px] px-2 py-0.5 rounded shrink-0 ${tab === t.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'config' ? (
        <div className="flex-1 min-h-0">
          <Resources key={`${entry.root}|${entry.slug}`} root={entry.root} slug={entry.slug} />
        </div>
      ) : tab === 'conversation' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {err && <div className="p-4 text-[13px] text-red-300">{err}</div>}
            {transcript ? (
              <Conversation
                data={transcript}
                live={slice ? { items: slice.items, onPerm: (r, bh, scope, answers) => live.respondPerm(key, r, bh, scope, answers) } : null}
              />
            ) : (
              <Loading />
            )}
          </div>
          {engine === 'terminal' ? (
            <TerminalPanel root={entry.root} slug={entry.slug} id={entry.id} title={entry.title} onChange={onTermChange} runningKeys={runningKeys} onOpenTool={(what) => api.open(entry.root, entry.slug, entry.id, what)} />
          ) : (
            <ChatComposer
              slice={slice}
              onOpen={() => live.open(entry, transcript)}
              onClose={() => { live.close(key); api.session(entry.root, entry.slug, entry.id).then(setConv).catch(() => {}) }}
              mode={chatMode}
              onMode={onChatMode}
              onSend={(t) => live.send(key, t, chatMode)}
              liveCount={liveCount}
              onOpenManager={onOpenManager}
              onOpenTool={(what) => api.open(entry.root, entry.slug, entry.id, what)}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {err && <div className="p-4 text-[13px] text-red-300">{err}</div>}
          {tab === 'subagents' && (subs ? <SubagentsView data={subs} version={version} active={active} /> : <Loading />)}
          {tab === 'raw' && (raw ? <RawView records={raw.records} /> : <Loading />)}
          {tab === 'memory' && <MemoryView data={mem} />}
        </div>
      )}
    </div>
  )
}

const Loading = () => <div className="p-8 text-center text-zinc-600">Loading…</div>
const FALLBACK_POLL_MS = 3000

export default function MultiSession({ openSessions, panes, paneKeys, setPaneKey, onCloseSession, sessionVersions, rootLabels, active = true, live, chatMode, onChatMode, liveCount, onOpenManager, engine, runningKeys, onTermChange }) {
  const byKey = (k) => openSessions.find((s) => keyOf(s) === k) || null
  // (the open-session list + split control live in the app top bar now; each
  //  pane picks its session below, so no separate strip is needed.)
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
              // per-pane boundary keyed by the pane's session: one crashed pane
              // degrades to a card while the other panes stay live, and picking
              // a different session in this pane clears the error.
              <ErrorBoundary label="this pane" resetKey={k}>
                <SessionPane
                  entry={entry}
                  version={getSessionVersion(sessionVersions, 'claude', entry.root, entry.id)}
                  active={active}
                  live={live}
                  chatMode={chatMode}
                  onChatMode={onChatMode}
                  liveCount={liveCount}
                  onOpenManager={onOpenManager}
                  engine={engine}
                  runningKeys={runningKeys}
                  onTermChange={onTermChange}
                />
              </ErrorBoundary>
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
