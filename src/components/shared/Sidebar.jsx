import { useEffect, useRef, useState } from 'react'
import { fmtRelative } from '../../lib/format.js'
import { ActivityIcon, TrashIcon } from './icons.jsx'
import PathPicker from './PathPicker.jsx'
import ThemeToggle from './ThemeToggle.jsx'

function shortPath(cwd, slug) {
  const p = cwd || slug || ''
  const parts = p.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || p || '(unknown)'
}

// Provider differences are props with claude defaults:
// - `rootStatusField` (default 'hasProjects') + `noHistorySuffix` decorate the
//   root <select>.
// - `appName` is the header label.
// Subagent adornments (isSubagent / childCount) render only when present on the
// session object, so codex data lights them up and claude data does not.
export default function Sidebar({
  apiClient,
  roots,
  root,
  onRoot,
  projects,
  openSlug,
  onOpenProject,
  sessions,
  activeSession,
  onSelectSession,
  loadingSessions,
  liveIds,
  onManageRoots,
  globalViews,
  activeGlobal,
  onGlobalView,
  onAddSession,
  onDeleteSession,
  onDeleteSessions,
  onNewConversation,
  onNewProject,
  providers,
  provider,
  onProvider,
  rootStatusField = 'hasProjects',
  noHistorySuffix = ' (config only)',
  appName = 'AgentDeck',
  onLogo,
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
  // bumped whenever the selection context changes, so a batch that outlives a
  // navigation can tell its select-mode session is over (see runBatchDelete)
  const batchEpoch = useRef(0)
  // pending confirms / selections shouldn't survive navigating away and back
  useEffect(() => {
    batchEpoch.current++
    setConfirmDelId(null)
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBatch(false)
  }, [root, openSlug])

  // selections count against the CURRENT list (stale ids from a live refresh
  // don't inflate the number)
  const selCount = sessions.filter((s) => selected.has(s.id)).length
  // if a refresh empties the selection under an open confirm bar, retract it —
  // otherwise it sits there offering to "trash 0"
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
    // If the user navigates away mid-batch the [root, openSlug] effect resets
    // the selection (and bumps the epoch); a fresh selection they start after
    // that belongs to a NEW epoch and must not be wiped by this batch's finally.
    const epoch = batchEpoch.current
    setBatchBusy(true)
    try {
      await onDeleteSessions?.(list)
    } finally {
      // busy is global (blocks a second batch — the confirm UI shows
      // "trashing…" instead of yes/no while it's set), the exit is epoch-scoped
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
      else if (!r?.cancelled) setPickerOpen(true) // native unavailable → fallback
    } catch {
      setPickerOpen(true)
    } finally {
      setPicking(false)
    }
  }

  const filtered = projects.filter((p) => {
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })

  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800">
        <button
          onClick={onLogo}
          title="Open dashboard"
          className="flex items-center gap-2 mb-2.5 cursor-pointer group"
        >
          <span className="text-emerald-400"><ActivityIcon /></span>
          <span className="text-[13px] font-semibold tracking-tight text-zinc-200 group-hover:text-zinc-100">{appName}</span>
        </button>
        {providers?.length > 0 && (
          <select
            value={provider || ''}
            onChange={(e) => onProvider?.(e.target.value)}
            title="Switch monitored CLI agent"
            className="w-full mb-1.5 bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-300"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1.5">
          <select
            value={root || ''}
            onChange={(e) => onRoot(e.target.value)}
            className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-300"
          >
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r[rootStatusField] === false ? noHistorySuffix : ''}
              </option>
            ))}
            {roots.length === 0 && <option value="">no folders</option>}
          </select>
          <button
            onClick={onManageRoots}
            title="Manage tracked folders"
            className="shrink-0 px-2 rounded bg-ink-700 border border-zinc-700 text-zinc-400 hover:text-zinc-100 text-[12px]"
          >
            folders
          </button>
        </div>

        {/* folder(root)-scoped views — belong to the whole tracked folder */}
        {globalViews?.length > 0 && (
          <div className="mt-2">
            <div className="flex flex-wrap gap-1">
              {globalViews.map((g) => (
                <button
                  key={g.k}
                  onClick={() => onGlobalView(g.k)}
                  className={`text-[11px] px-2 py-1 rounded ${
                    activeGlobal === g.k ? 'bg-ink-600 text-zinc-100' : 'bg-ink-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects…"
          className="mt-2 w-full bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600"
        />

        {onNewProject && (
          <div className="mt-2">
            <button onClick={newProjectFlow} disabled={picking} className="w-full text-left text-[12px] text-emerald-300/80 hover:text-emerald-200 py-0.5 disabled:opacity-60" title="Pick a folder (opens Finder/Explorer) and start a new conversation there">
              {picking ? '+ opening folder chooser…' : '+ New project (choose a folder)'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map((p) => {
          const isOpen = p.slug === openSlug
          return (
            <div key={p.slug} className="border-b border-zinc-800/60">
              <button
                onClick={() => onOpenProject(isOpen ? null : p.slug)}
                className={`w-full text-left px-3 py-2 hover:bg-ink-700/50 ${isOpen ? 'bg-ink-700/40' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-600 text-xs">{isOpen ? '▾' : '▸'}</span>
                  <span className="text-[13px] text-zinc-200 truncate flex-1" title={p.cwd || p.slug}>
                    {shortPath(p.cwd, p.slug)}
                  </span>
                  <span className="text-[11px] text-zinc-600">{p.sessionCount}</span>
                </div>
              </button>

              {isOpen && (
                <div className="pb-1">
                  {onNewConversation && (
                    <button
                      onClick={() => onNewConversation(p.slug)}
                      className="w-full text-left pl-7 pr-2 py-1.5 text-[12px] text-emerald-300/80 hover:text-emerald-200 hover:bg-ink-700/50"
                      title="Start a new conversation in this project"
                    >
                      + New conversation
                    </button>
                  )}
                  {/* batch select — enter/act/exit; sits under "+ New conversation".
                      Counts derive from the CURRENT list (stale selections from a
                      live refresh don't inflate them — see selCount above), and the
                      bar stays mounted through SSE-triggered loading flickers while
                      selecting. */}
                  {onDeleteSessions && sessions.length > 0 && (selectMode || !loadingSessions) && (
                      <div className="pl-7 pr-2 py-1 flex items-center gap-1.5 text-[11px]">
                        {!selectMode ? (
                          <button onClick={() => setSelectMode(true)} className="text-zinc-500 hover:text-zinc-200" title="Select multiple sessions to trash">
                            ☐ select
                          </button>
                        ) : (
                          <>
                            <span className="text-zinc-400">{selCount} selected</span>
                            <button
                              onClick={() =>
                                setSelected(selCount === sessions.length ? new Set() : new Set(sessions.map((s) => s.id)))
                              }
                              className="px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200"
                            >
                              {selCount === sessions.length ? 'none' : 'all'}
                            </button>
                            <span className="flex-1" />
                            {batchBusy ? (
                              <span className="text-zinc-500">trashing…</span>
                            ) : confirmBatch ? (
                              <>
                                <span className="text-red-300">
                                  trash {selCount}
                                  {sessions.some((s) => selected.has(s.id) && (liveIds?.has(s.id) || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000)))
                                    ? ' (incl. active!)'
                                    : ''}
                                  ?
                                </span>
                                <button onClick={runBatchDelete} className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
                                <button onClick={() => setConfirmBatch(false)} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setConfirmBatch(true)}
                                  disabled={selCount === 0}
                                  className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40"
                                >
                                  Delete
                                </button>
                                <button onClick={exitSelectMode} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">Cancel</button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                  )}
                  {loadingSessions && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                  {!loadingSessions &&
                    sessions.map((s) => {
                      const active = activeSession?.id === s.id
                      const live = liveIds?.has(s.id)
                      // deleting a session something is still writing to leaves a truncated
                      // transcript behind — surface that in the confirm text
                      const recent = live || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000)
                      const checked = selected.has(s.id)
                      return (
                        <div
                          key={s.id}
                          className={`group flex items-stretch hover:bg-ink-700/50 ${
                            selectMode && checked ? 'bg-red-500/10' : active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''
                          }`}
                        >
                          <button
                            onClick={() => (selectMode ? toggleSelected(s.id) : onSelectSession(s))}
                            className="flex-1 min-w-0 text-left pl-7 pr-2 py-1.5"
                          >
                            <div className="text-[12.5px] text-zinc-300 truncate flex items-center gap-1.5">
                              {selectMode && <span className={`shrink-0 ${checked ? 'text-red-300' : 'text-zinc-600'}`}>{checked ? '☑' : '☐'}</span>}
                              {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
                              {s.isSubagent && <span className="shrink-0 text-violet-400" title={`subagent${s.agentRole ? ` · ${s.agentRole}` : ''}`}>⤷</span>}
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
                              <button
                                onClick={() => { setConfirmDelId(null); onDeleteSession(s) }}
                                className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-200"
                              >
                                yes
                              </button>
                              <button onClick={() => setConfirmDelId(null)} className="text-[11px] px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">
                                no
                              </button>
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => onAddSession?.(s)}
                                title="Open in multi-session (compare)"
                                className="px-2 text-zinc-600 hover:text-sky-300 opacity-0 group-hover:opacity-100 shrink-0"
                              >
                                ⊞
                              </button>
                              {onDeleteSession && (
                                <button
                                  onClick={() => setConfirmDelId(s.id)}
                                  title="Move session to the OS trash (recoverable)"
                                  className="px-2 flex items-center justify-center text-zinc-600 hover:text-sky-300 opacity-0 group-hover:opacity-100 shrink-0"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              )}
                            </>
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

      <div className="p-2 border-t border-zinc-800">
        <ThemeToggle />
      </div>

      {pickerOpen && (
        <PathPicker
          apiClient={apiClient}
          onPick={(p) => { setPickerOpen(false); onNewProject(p) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  )
}
