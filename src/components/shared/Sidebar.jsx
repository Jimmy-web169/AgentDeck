import { useEffect, useRef, useState } from 'react'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { isPinned, togglePin, usePins } from '../../lib/pins.js'
import { TrashIcon } from './icons.jsx'
import { CheckSquareIcon, PinIcon } from './shellIcons.jsx'
import PathPicker from './PathPicker.jsx'
import ScopeMenu from './ScopeMenu.jsx'

// The provider app's project/session browser. Header = one scope menu
// (provider · folder) + filter + new project; list = pinned items for this
// folder, then every project with its sessions. Folder-wide views (stats,
// history, …) live on Home now.
//
// Row actions (hover): pin, batch-select (projects), trash (sessions).
// Ctrl/middle-click on a session opens it in a new tab.
export default function Sidebar({
  apiClient,
  providers,
  scopes,
  scope,
  onScope,
  onManageFolders,
  projects,
  openSlug,
  onOpenProject,
  sessions,
  activeSession,
  onSelectSession,
  onOpenTarget,
  loadingSessions,
  liveIds,
  onDeleteSession,
  onDeleteSessions,
  onNewConversation,
  onNewProject,
}) {
  const [filter, setFilter] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirmDelId, setConfirmDelId] = useState(null) // session id pending delete confirmation
  // batch selection mode (only offered when onDeleteSessions is provided)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const batchEpoch = useRef(0)
  const pins = usePins()
  const root = scope?.root
  const provider = scope?.provider

  // pending confirms / selections shouldn't survive navigating away and back
  useEffect(() => {
    batchEpoch.current++
    setConfirmDelId(null)
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBatch(false)
  }, [root, openSlug])

  const selCount = sessions.filter((s) => selected.has(s.id)).length
  useEffect(() => {
    if (confirmBatch && selCount === 0) setConfirmBatch(false)
  }, [confirmBatch, selCount])

  const toggleSelected = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBatch(false)
  }
  const runBatchDelete = async () => {
    if (batchBusy) return
    const list = sessions.filter((s) => selected.has(s.id))
    if (!list.length) {
      setConfirmBatch(false)
      return
    }
    const epoch = batchEpoch.current
    setBatchBusy(true)
    try {
      await onDeleteSessions?.(list)
    } finally {
      setBatchBusy(false)
      if (batchEpoch.current === epoch) exitSelectMode()
    }
  }

  // try the OS-native folder chooser first; fall back to the in-browser picker
  const newProjectFlow = async () => {
    if (picking) return
    setPicking(true)
    try {
      const r = await apiClient.pickFolder()
      if (r?.ok && r.path) onNewProject(r.path)
      else if (!r?.cancelled) setPickerOpen(true)
    } catch {
      setPickerOpen(true)
    } finally {
      setPicking(false)
    }
  }

  const rootLabel = scopes?.find((s) => s.provider === provider && s.root === root)?.rootLabel || ''
  const projectTarget = (p) => ({ provider, root, rootLabel, slug: p.slug, project: shortPath(p.cwd || p.slug, 1), cwd: p.cwd || null })
  const sessionTarget = (s) => {
    const p = projects.find((x) => x.slug === openSlug)
    return { provider, root, rootLabel, slug: openSlug, id: s.id, title: s.title, project: p ? shortPath(p.cwd || p.slug, 1) : null, cwd: p?.cwd || null }
  }

  const filtered = projects.filter((p) => {
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })
  const myPins = pins.filter((p) => p.provider === provider && p.root === root)

  const iconBtn = 'w-6 h-6 rounded flex items-center justify-center shrink-0'

  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <ScopeMenu scopes={scopes} providers={providers} value={scope} onChange={onScope} onManage={onManageFolders} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects…"
          className="w-full bg-ink-700 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600"
        />
        {onNewProject && (
          <button onClick={newProjectFlow} disabled={picking} className="w-full text-left text-[12px] text-emerald-300/80 hover:text-emerald-200 py-0.5 disabled:opacity-60" title="Pick a folder (opens Finder/Explorer) and start a new conversation there">
            {picking ? '+ opening folder chooser…' : '+ New project (choose a folder)'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {myPins.length > 0 && !filter && (
          <div className="border-b border-zinc-800/60 pb-1">
            <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-600 flex items-center gap-1.5">
              <PinIcon className="w-3 h-3 text-amber-300" filled /> Pinned
            </div>
            {myPins.map((p) => {
              const live = p.id && liveIds?.has(p.id)
              const isActive = p.id ? activeSession?.id === p.id : !activeSession && openSlug === p.slug
              return (
                <div key={`${p.slug}|${p.id || ''}`} className={`group flex items-stretch hover:bg-ink-700/50 ${isActive ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
                  <button
                    onClick={(e) => onOpenTarget?.(p, { newTab: e.ctrlKey || e.metaKey })}
                    onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                    onAuxClick={(e) => e.button === 1 && onOpenTarget?.(p, { newTab: true })}
                    title={p.id ? `${p.project || ''} · ${p.title || ''}` : p.cwd || p.slug}
                    className="flex-1 min-w-0 text-left pl-3 pr-2 py-1.5"
                  >
                    <div className="text-[12.5px] text-zinc-300 truncate flex items-center gap-1.5">
                      {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
                      <span className="truncate">{p.id ? p.title || p.id.slice(0, 8) : p.project || p.slug}</span>
                    </div>
                    <div className="text-[10.5px] text-zinc-600 truncate">{p.id ? p.project || '' : 'project'}</div>
                  </button>
                  <button onClick={() => togglePin(p)} title="Unpin" className={`${iconBtn} self-center mr-1.5 text-amber-300 opacity-0 group-hover:opacity-100 hover:bg-ink-600`}>
                    <PinIcon className="w-3.5 h-3.5" filled />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {filtered.map((p) => {
          const isOpen = p.slug === openSlug
          const pinned = isPinned({ provider, root, slug: p.slug })
          return (
            <div key={p.slug} className="border-b border-zinc-800/60">
              <div className={`group flex items-stretch hover:bg-ink-700/50 ${isOpen ? 'bg-ink-700/40' : ''}`}>
                <button onClick={() => onOpenProject(isOpen ? null : p.slug)} className="flex-1 min-w-0 text-left pl-3 pr-1 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-600 text-xs w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
                    <span className="text-[13px] text-zinc-200 truncate flex-1" title={p.cwd || p.slug}>
                      {shortPath(p.cwd || p.slug)}
                    </span>
                    <span className="text-[11px] text-zinc-600 shrink-0">{p.sessionCount}</span>
                  </div>
                </button>
                <div className="flex items-center gap-0.5 pr-1.5">
                  {isOpen && onDeleteSessions && sessions.length > 0 && (
                    <button
                      onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                      title={selectMode ? 'Leave select mode' : 'Select several sessions to trash'}
                      className={`${iconBtn} hover:bg-ink-600 ${selectMode ? 'text-red-300 opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}
                    >
                      <CheckSquareIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => togglePin(projectTarget(p))}
                    title={pinned ? 'Unpin project' : 'Pin project'}
                    className={`${iconBtn} hover:bg-ink-600 ${pinned ? 'text-amber-300 opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}
                  >
                    <PinIcon className="w-3.5 h-3.5" filled={pinned} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="pb-1">
                  {onNewConversation && (
                    <button onClick={() => onNewConversation(p.slug)} className="w-full text-left pl-7 pr-2 py-1.5 text-[12px] text-emerald-300/80 hover:text-emerald-200 hover:bg-ink-700/50" title="Start a new conversation in this project">
                      + New conversation
                    </button>
                  )}
                  {selectMode && (
                    <div className="pl-7 pr-2 py-1 flex items-center gap-1.5 text-[11px]">
                      <span className="text-zinc-400">{selCount} selected</span>
                      <button onClick={() => setSelected(selCount === sessions.length ? new Set() : new Set(sessions.map((s) => s.id)))} className="px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200">
                        {selCount === sessions.length ? 'none' : 'all'}
                      </button>
                      <span className="flex-1" />
                      {batchBusy ? (
                        <span className="text-zinc-500">trashing…</span>
                      ) : confirmBatch ? (
                        <>
                          <span className="text-red-300">
                            trash {selCount}
                            {sessions.some((s) => selected.has(s.id) && (liveIds?.has(s.id) || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000))) ? ' (incl. active!)' : ''}?
                          </span>
                          <button onClick={runBatchDelete} className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
                          <button onClick={() => setConfirmBatch(false)} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setConfirmBatch(true)} disabled={selCount === 0} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40">
                            Delete
                          </button>
                          <button onClick={exitSelectMode} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">Cancel</button>
                        </>
                      )}
                    </div>
                  )}
                  {loadingSessions && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                  {!loadingSessions &&
                    sessions.map((s) => {
                      const active = activeSession?.id === s.id
                      const live = liveIds?.has(s.id)
                      const recent = live || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000)
                      const checked = selected.has(s.id)
                      const pinnedS = isPinned({ provider, root, slug: openSlug, id: s.id })
                      return (
                        <div key={s.id} className={`group flex items-stretch hover:bg-ink-700/50 ${selectMode && checked ? 'bg-red-500/10' : active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
                          <button
                            onClick={(e) => (selectMode ? toggleSelected(s.id) : onSelectSession(s, { newTab: e.ctrlKey || e.metaKey }))}
                            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                            onAuxClick={(e) => e.button === 1 && !selectMode && onSelectSession(s, { newTab: true })}
                            title={selectMode ? undefined : 'Open here · Ctrl+click or middle-click opens in a new tab'}
                            className="flex-1 min-w-0 text-left pl-7 pr-2 py-1.5"
                          >
                            <div className="text-[12.5px] text-zinc-300 truncate flex items-center gap-1.5">
                              {selectMode && <span className={`shrink-0 ${checked ? 'text-red-300' : 'text-zinc-600'}`}>{checked ? '☑' : '☐'}</span>}
                              {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
                              {s.isSubagent && <span className="shrink-0 text-violet-400" title={`subagent${s.agentRole ? ` · ${s.agentRole}` : ''}`}>⤷</span>}
                              {s.oversized && <span className="shrink-0 text-amber-400" title="Transcript exceeds the parse limit — it can't be opened, but other sessions are unaffected">⚠</span>}
                              {pinnedS && !selectMode && <PinIcon className="w-3 h-3 text-amber-300 shrink-0" filled />}
                              <span className="truncate">{s.title}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10.5px] text-zinc-600">
                              <span>{fmtRelative(s.lastTs)}</span>
                              <span>· {s.toolCalls} tools</span>
                              {s.childCount > 0 && <span className="text-violet-400/80">· ⤷ {s.childCount}</span>}
                              {s.hasSubagents && <span className="text-violet-400">· ⚇ subs</span>}
                            </div>
                          </button>
                          {selectMode ? null : onDeleteSession && confirmDelId === s.id ? (
                            <span className="flex items-center gap-1 pr-1.5 shrink-0">
                              <span className="text-[10px] text-red-300">{recent ? 'active! trash?' : 'trash?'}</span>
                              <button onClick={() => { setConfirmDelId(null); onDeleteSession(s) }} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
                              <button onClick={() => setConfirmDelId(null)} className="text-[11px] px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
                            </span>
                          ) : (
                            <div className="flex items-center gap-0.5 pr-1.5">
                              <button
                                onClick={() => togglePin(sessionTarget(s))}
                                title={pinnedS ? 'Unpin session' : 'Pin session'}
                                className={`${iconBtn} hover:bg-ink-600 ${pinnedS ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-100'} opacity-0 group-hover:opacity-100`}
                              >
                                <PinIcon className="w-3.5 h-3.5" filled={pinnedS} />
                              </button>
                              {onDeleteSession && (
                                <button onClick={() => setConfirmDelId(s.id)} title="Move session to the OS trash (recoverable)" className={`${iconBtn} hover:bg-ink-600 text-zinc-500 hover:text-red-300 opacity-0 group-hover:opacity-100`}>
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="p-4 text-[12px] text-zinc-600">No projects.</div>}
      </div>

      {pickerOpen && (
        <PathPicker
          apiClient={apiClient}
          onPick={(p) => {
            setPickerOpen(false)
            onNewProject(p)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  )
}
