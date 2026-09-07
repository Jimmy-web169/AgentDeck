import { useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from '../../api.js'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { HOME_VIEWS, isHome } from '../../lib/tabs.js'
import { isPinned, togglePin, usePins } from '../../lib/pins.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { TrashIcon } from './icons.jsx'
import { CheckSquareIcon, PanelLeftIcon, PinIcon } from './shellIcons.jsx'
import PathPicker from './PathPicker.jsx'
import ScopeBar from './ScopeBar.jsx'

// The one sidebar. It belongs to the shell, so it is the same column whether
// the active tab shows Home or a session — only the highlights move:
//   scope        provider · folder (segmented + chips)
//   Home pages   Overview · Stats · History · … · Folders (navigate this tab)
//   filter, + New project
//   Pinned       this folder's pinned projects / sessions
//   Projects     expand one to see its sessions; click a session to open it
//                here, Ctrl/middle-click for a new tab
// Data comes from the shell's cross-provider index (projects up front,
// sessions lazily per project), so it never depends on which app is showing.
export default function AppSidebar({
  providers,
  index,
  live,
  scope,
  onScope,
  activeTarget,
  onOpenHome,
  onOpenTarget,
  onNewConversation,
  onNewProject,
  onDeleteSession,
  onDeleteSessions,
  onCollapse,
}) {
  const [filter, setFilter] = useState('')
  const [openSlug, setOpenSlug] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirmDelId, setConfirmDelId] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const batchEpoch = useRef(0)
  const pins = usePins()

  const provider = scope?.provider || null
  const root = scope?.root || null
  const api = useMemo(() => (provider ? createApi(provider) : null), [provider])
  const scopeInfo = index.scopes.find((s) => s.provider === provider && s.root === root)
  const rootLabel = scopeInfo?.rootLabel || ''
  const homeView = isHome(activeTarget) ? activeTarget?.view || 'overview' : null

  const projects = useMemo(() => index.projects.filter((p) => p.provider === provider && p.root === root), [index.projects, provider, root])
  const sessions = openSlug && provider ? index.sessionsFor(provider, root, openSlug) : null

  // follow the active tab: its project is the expanded one
  useEffect(() => {
    if (activeTarget?.provider === provider && activeTarget?.root === root && activeTarget?.slug) setOpenSlug(activeTarget.slug)
  }, [activeTarget?.provider, activeTarget?.root, activeTarget?.slug, provider, root])

  // pending confirms / selections don't survive a scope or project change
  useEffect(() => {
    batchEpoch.current++
    setConfirmDelId(null)
    setSelectMode(false)
    setSelected(new Set())
    setConfirmBatch(false)
  }, [provider, root, openSlug])

  const list = sessions || []
  const selCount = list.filter((s) => selected.has(s.id)).length
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
    const picked = list.filter((s) => selected.has(s.id))
    if (!picked.length) {
      setConfirmBatch(false)
      return
    }
    const epoch = batchEpoch.current
    setBatchBusy(true)
    try {
      await onDeleteSessions?.(scope, openSlug, picked)
    } finally {
      setBatchBusy(false)
      if (batchEpoch.current === epoch) exitSelectMode()
    }
  }

  // "+ New project": OS folder chooser first, in-browser picker as fallback
  const newProjectFlow = async () => {
    if (picking || !api) return
    setPicking(true)
    try {
      const r = await api.pickFolder()
      if (r?.ok && r.path) onNewProject(scope, r.path)
      else if (!r?.cancelled) setPickerOpen(true)
    } catch {
      setPickerOpen(true)
    } finally {
      setPicking(false)
    }
  }

  const isLive = (id) => live?.ids?.has(liveSessionKey(provider, root, id))
  const isActiveSession = (id) => activeTarget?.provider === provider && activeTarget?.root === root && activeTarget?.id === id
  const projectTarget = (p) => ({ provider, root, rootLabel, slug: p.slug, cwd: p.cwd, project: p.name })
  const sessionTarget = (s) => {
    const p = projects.find((x) => x.slug === openSlug)
    return { provider, root, rootLabel, slug: openSlug, id: s.id, title: s.title, project: p?.name || null, cwd: p?.cwd || null }
  }

  const filtered = projects.filter((p) => {
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug} ${p.name}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })
  const myPins = pins.filter((p) => p.provider === provider && p.root === root)
  const iconBtn = 'w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors'

  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <ScopeBar scopes={index.scopes} providers={providers} value={scope} onChange={onScope} onManage={() => onOpenHome({ view: 'folders' })} />
          </div>
          <button onClick={onCollapse} title="Hide sidebar  (Ctrl+B)" className={`${iconBtn} mt-0.5 w-7 h-7 text-zinc-500 hover:text-zinc-100 hover:bg-ink-700`}>
            <PanelLeftIcon />
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {HOME_VIEWS.map((v) => (
            <button
              key={v.k}
              onClick={(e) => onOpenHome({ view: v.k }, { newTab: e.ctrlKey || e.metaKey })}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && onOpenHome({ view: v.k }, { newTab: true })}
              title={`${v.label} · Ctrl+click opens in a new tab`}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${homeView === v.k ? 'bg-ink-600 text-zinc-100' : 'bg-ink-700 text-zinc-400 hover:text-zinc-100 hover:bg-ink-600'}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects…"
          className="w-full bg-ink-700 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 outline-none"
        />
        <button onClick={newProjectFlow} disabled={picking || !api} className="w-full text-left text-[12px] text-emerald-300/80 hover:text-emerald-200 disabled:opacity-60" title="Pick a folder (opens Finder/Explorer) and start a new conversation there">
          {picking ? '+ opening folder chooser…' : '+ New project (choose a folder)'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {myPins.length > 0 && !filter && (
          <div className="border-b border-zinc-800/60 pb-1">
            <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-600 flex items-center gap-1.5">
              <PinIcon className="w-3 h-3 text-amber-300" filled /> Pinned
            </div>
            {myPins.map((p) => {
              const active = p.id ? isActiveSession(p.id) : false
              return (
                <div key={`${p.slug}|${p.id || ''}`} className={`group flex items-stretch hover:bg-ink-700/50 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
                  <button
                    onClick={(e) => (p.id ? onOpenTarget(p, { newTab: e.ctrlKey || e.metaKey }) : setOpenSlug(openSlug === p.slug ? null : p.slug))}
                    onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                    onAuxClick={(e) => e.button === 1 && p.id && onOpenTarget(p, { newTab: true })}
                    title={p.id ? `${p.project || ''} · ${p.title || ''}` : p.cwd || p.slug}
                    className="flex-1 min-w-0 text-left pl-3 pr-2 py-1.5"
                  >
                    <div className="text-[12.5px] text-zinc-300 truncate flex items-center gap-1.5">
                      {p.id && isLive(p.id) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
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
                <button onClick={() => setOpenSlug(isOpen ? null : p.slug)} className="flex-1 min-w-0 text-left pl-3 pr-1 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-600 text-xs w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
                    <span className="text-[13px] text-zinc-200 truncate flex-1" title={p.cwd || p.slug}>{shortPath(p.cwd || p.slug)}</span>
                    <span className="text-[11px] text-zinc-600 shrink-0">{p.sessionCount}</span>
                  </div>
                </button>
                <div className="flex items-center gap-0.5 pr-1.5">
                  {isOpen && onDeleteSessions && list.length > 0 && (
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
                  <button onClick={() => onNewConversation(scope, p)} className="w-full text-left pl-7 pr-2 py-1.5 text-[12px] text-emerald-300/80 hover:text-emerald-200 hover:bg-ink-700/50" title="Start a new conversation in this project">
                    + New conversation
                  </button>
                  {selectMode && (
                    <div className="pl-7 pr-2 py-1 flex items-center gap-1.5 text-[11px]">
                      <span className="text-zinc-400">{selCount} selected</span>
                      <button onClick={() => setSelected(selCount === list.length ? new Set() : new Set(list.map((s) => s.id)))} className="px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200">
                        {selCount === list.length ? 'none' : 'all'}
                      </button>
                      <span className="flex-1" />
                      {batchBusy ? (
                        <span className="text-zinc-500">trashing…</span>
                      ) : confirmBatch ? (
                        <>
                          <span className="text-red-300">
                            trash {selCount}
                            {list.some((s) => selected.has(s.id) && (isLive(s.id) || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000))) ? ' (incl. active!)' : ''}?
                          </span>
                          <button onClick={runBatchDelete} className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
                          <button onClick={() => setConfirmBatch(false)} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setConfirmBatch(true)} disabled={selCount === 0} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40">Delete</button>
                          <button onClick={exitSelectMode} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">Cancel</button>
                        </>
                      )}
                    </div>
                  )}
                  {sessions === null && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                  {sessions && sessions.length === 0 && <div className="px-7 py-2 text-[12px] text-zinc-600">no sessions yet</div>}
                  {list.map((s) => {
                    const active = isActiveSession(s.id)
                    const live = isLive(s.id)
                    const recent = live || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000)
                    const checked = selected.has(s.id)
                    const pinnedS = isPinned({ provider, root, slug: openSlug, id: s.id })
                    return (
                      <div key={s.id} className={`group flex items-stretch hover:bg-ink-700/50 ${selectMode && checked ? 'bg-red-500/10' : active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
                        <button
                          onClick={(e) => (selectMode ? toggleSelected(s.id) : onOpenTarget(sessionTarget(s), { newTab: e.ctrlKey || e.metaKey }))}
                          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                          onAuxClick={(e) => e.button === 1 && !selectMode && onOpenTarget(sessionTarget(s), { newTab: true })}
                          title={selectMode ? undefined : `${s.title}\nOpen here · Ctrl+click or middle-click opens in a new tab`}
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
                        {selectMode ? null : confirmDelId === s.id ? (
                          <span className="flex items-center gap-1 pr-1.5 shrink-0">
                            <span className="text-[10px] text-red-300">{recent ? 'active! trash?' : 'trash?'}</span>
                            <button onClick={() => { setConfirmDelId(null); onDeleteSession?.(scope, openSlug, s) }} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
                            <button onClick={() => setConfirmDelId(null)} className="text-[11px] px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
                          </span>
                        ) : (
                          <div className="flex items-center gap-0.5 pr-1.5">
                            <button onClick={() => togglePin(sessionTarget(s))} title={pinnedS ? 'Unpin session' : 'Pin session'} className={`${iconBtn} hover:bg-ink-600 ${pinnedS ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-100'} opacity-0 group-hover:opacity-100`}>
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
        {filtered.length === 0 && (
          <div className="p-4 text-[12px] text-zinc-600">{!scope ? 'No tracked folders yet — add one under Folders.' : index.loading && !projects.length ? 'Loading projects…' : 'No projects.'}</div>
        )}
      </div>

      {pickerOpen && api && (
        <PathPicker
          apiClient={api}
          onPick={(p) => {
            setPickerOpen(false)
            onNewProject(scope, p)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  )
}
