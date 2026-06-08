import { useEffect, useState } from 'react'
import RawView from './RawView.jsx'
import ChatComposer from './ChatComposer.jsx'

// MultiSession is the shared compare-panes shell. It owns the layout, the
// per-pane session picker, tab strip, data fetching/caching, and the live/raw
// wiring. Everything provider-specific is injected via props:
//
//   Provider subcomponents (NOT imported here):
//     Conversation, SubagentsView, MemoryView, ResourcesView, TerminalPanel
//   Config:
//     paneTabs      tab list, default claude's PANE_TABS
//     keyOf         session → workspace key, default `${root}|${slug}|${id}`
//     liveKeyOf     live-store key fn (live.keyOf is used if this is omitted)
//   Provider data/render hooks (defaults preserve claude behavior):
//     fetchSession(entry), fetchSubagents(entry), fetchRaw(entry),
//     fetchMemory(entry), openTool(entry, what), openLive(entry, snapshot),
//     renderConfig(entry), renderSubagents({ entry, data }),
//     renderConversation({ entry, data, slice, key, live }),
//     contextMeterFor(ctx) → node injected into ChatComposer (default none)
//
// RawView and ChatComposer are themselves shared, so they are imported directly.

export const DEFAULT_PANE_TABS = [
  { k: 'conversation', label: 'Conv' },
  { k: 'subagents', label: 'Subs' },
  { k: 'raw', label: 'Raw' },
  { k: 'memory', label: 'Mem' },
  { k: 'config', label: 'Config' },
]

const defaultKeyOf = (s) => `${s.root}|${s.slug}|${s.id}`

const Loading = () => <div className="p-8 text-center text-zinc-600">Loading…</div>

// A full per-session view (its own tabs + composer/terminal) embedded in a
// compare pane — reuses the single-session components passed down via props.
function SessionPane({
  entry,
  version,
  live,
  chatMode,
  onChatMode,
  liveCount,
  onOpenManager,
  engine,
  runningKeys,
  onTermChange,
  onOpenSession,
  paneTabs,
  liveKeyOf,
  Conversation,
  SubagentsView,
  MemoryView,
  ResourcesView,
  TerminalPanel,
  fetchSession,
  fetchSubagents,
  fetchRaw,
  fetchMemory,
  openTool,
  openLive,
  renderConfig,
  renderSubagents,
  renderConversation,
  contextMeterFor,
}) {
  const [tab, setTab] = useState(paneTabs[0]?.k || 'conversation')
  const [conv, setConv] = useState(null)
  const [subs, setSubs] = useState(null)
  const [raw, setRaw] = useState(null)
  const [mem, setMem] = useState(null)
  const [err, setErr] = useState(null)

  const key = liveKeyOf ? liveKeyOf(entry) : live.keyOf(entry)
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
    if (!entry) return
    let c = false
    const go = (pr, set) => pr.then((d) => !c && set(d)).catch((e) => !c && setErr(e.message))
    if (tab === 'conversation') {
      if (!slice) go(fetchSession(entry), setConv)
    } else if (tab === 'subagents' && fetchSubagents) go(fetchSubagents(entry), setSubs)
    else if (tab === 'raw') go(fetchRaw(entry), setRaw)
    else if (tab === 'memory' && fetchMemory) go(fetchMemory(entry), setMem)
    return () => {
      c = true
    }
  }, [entry?.root, entry?.slug, entry?.id, tab, version, !!slice])

  const ctx = { entry, conv, subs, raw, mem, slice, key, live }
  const contextMeter = contextMeterFor ? contextMeterFor(ctx) : null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex gap-0.5 px-2 py-1 border-b border-zinc-800 bg-ink-900/30 overflow-x-auto">
        {paneTabs.map((t) => (
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
        <div className="flex-1 min-h-0">{renderConfig(entry)}</div>
      ) : tab === 'conversation' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {err && <div className="p-4 text-[13px] text-red-300">{err}</div>}
            {slice?.transcript || conv ? (
              renderConversation({ entry, data: slice?.transcript || conv, slice, key, live })
            ) : (
              <Loading />
            )}
          </div>
          {engine === 'terminal' ? (
            <TerminalPanel
              entry={entry}
              title={entry.title}
              onChange={onTermChange}
              runningKeys={runningKeys}
              contextSummary={ctx.slice?.transcript?.summary || conv?.summary}
              onOpenTool={(what) => openTool(entry, what)}
            />
          ) : (
            <ChatComposer
              slice={slice}
              contextMeter={contextMeter}
              onOpen={() => openLive(entry, slice?.transcript || conv)}
              onClose={() => { live.close(key); fetchSession(entry).then(setConv).catch(() => {}) }}
              mode={chatMode}
              onMode={onChatMode}
              onSend={(t) => live.send(key, t, chatMode)}
              liveCount={liveCount}
              onOpenManager={onOpenManager}
              onOpenTool={(what) => openTool(entry, what)}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {err && <div className="p-4 text-[13px] text-red-300">{err}</div>}
          {tab === 'subagents' && renderSubagents({ entry, data: subs, onOpenSession })}
          {tab === 'raw' && (raw ? <RawView records={raw.records} typeOf={raw.typeOf} /> : <Loading />)}
          {tab === 'memory' && MemoryView && <MemoryView data={mem} />}
        </div>
      )}
    </div>
  )
}

export default function MultiSession({
  openSessions,
  panes,
  paneKeys,
  setPaneKey,
  onCloseSession,
  sessionVersions,
  rootLabels,
  live,
  chatMode,
  onChatMode,
  liveCount,
  onOpenManager,
  engine,
  runningKeys,
  onTermChange,
  onOpenSession,
  // provider config / subcomponents
  paneTabs = DEFAULT_PANE_TABS,
  keyOf = defaultKeyOf,
  liveKeyOf,
  Conversation,
  SubagentsView,
  MemoryView,
  ResourcesView,
  TerminalPanel,
  fetchSession,
  fetchSubagents,
  fetchRaw,
  fetchMemory,
  openTool,
  openLive,
  renderConfig,
  renderSubagents,
  renderConversation,
  contextMeterFor,
}) {
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
                paneTabs={paneTabs}
                liveKeyOf={liveKeyOf}
                Conversation={Conversation}
                SubagentsView={SubagentsView}
                MemoryView={MemoryView}
                ResourcesView={ResourcesView}
                TerminalPanel={TerminalPanel}
                fetchSession={fetchSession}
                fetchSubagents={fetchSubagents}
                fetchRaw={fetchRaw}
                fetchMemory={fetchMemory}
                openTool={openTool}
                openLive={openLive}
                renderConfig={renderConfig}
                renderSubagents={renderSubagents}
                renderConversation={renderConversation}
                contextMeterFor={contextMeterFor}
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
