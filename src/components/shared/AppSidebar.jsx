import { useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from '../../api.js'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { isPinned, togglePin, usePins } from '../../lib/pins.js'
import { addToWorkspace, createWorkspace, deleteWorkspace, inWorkspace, projectKey, removeFromWorkspace, renameWorkspace, suggestWorkspaces, useWorkspaces } from '../../lib/workspaces.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import { TrashIcon } from './icons.jsx'
import { CheckSquareIcon, ChevronRightIcon, CloseIcon, LayersIcon, PencilIcon, PinIcon, PlusIcon } from './shellIcons.jsx'
import PathPicker from './PathPicker.jsx'
import FolderChips from './FolderChips.jsx'

// The one sidebar. It belongs to the shell, so it is the same column whether
// the active tab shows Home or a session — only the highlights move.
//
//   folders      the rail's provider → its tracked folders as chips (+ = track one)
//   filter, + New project
//   Workspaces   named groups of projects from ANY provider / folder (the same
//                repo under Claude Code and Codex, say); expand a workspace →
//                its projects → their sessions, all in place
//   Pinned       pinned projects (expand in place) and sessions from ANY provider
//   Projects     the current folder's projects; expand one to see its sessions
//
// Everything opens by click into the current tab (Ctrl/middle-click: a new
// tab). Data comes from the shell's cross-provider index (projects up front,
// sessions lazily per project), so no section depends on which app is showing.

const SECTIONS_KEY = 'agentdeck_sidebar_sections'
const INLINE_SESSIONS = 8 // sessions shown under a pinned / workspace project before "show all"
const loadSections = () => {
  try {
    return { workspaces: true, pinned: true, projects: true, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}') }
  } catch {
    return { workspaces: true, pinned: true, projects: true }
  }
}

const iconBtn = 'w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors'
const hoverBtn = `${iconBtn} text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100 hover:bg-ink-600`

function SectionHeader({ title, count, open, onToggle, right }) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2.5 pb-1">
      <button onClick={onToggle} className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
        <ChevronRightIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        {count != null && <span className="text-zinc-600 normal-case tracking-normal">· {count}</span>}
      </button>
      <span className="flex-1" />
      {right}
    </div>
  )
}

// sessions of one project (any provider), read from the index — used under
// pinned and workspace projects
function SessionRows({ p, index, dotFor, isActive, onOpenTarget, indent = 'pl-9' }) {
  const [all, setAll] = useState(false)
  const list = index.sessionsFor(p.provider, p.root, p.slug)
  if (list === null) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>loading…</div>
  if (!list.length) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>no sessions yet</div>
  const shown = all ? list : list.slice(0, INLINE_SESSIONS)
  const target = (s) => ({ provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, id: s.id, title: s.title, project: p.project || p.name, cwd: p.cwd })
  return (
    <>
      {shown.map((s) => {
        const dot = dotFor(p.provider, p.root, s.id)
        const active = isActive(p.provider, p.root, s.id)
        const pinned = isPinned({ provider: p.provider, root: p.root, slug: p.slug, id: s.id })
        return (
          <div key={s.id} className={`group flex items-stretch hover:bg-ink-700/50 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
            <button
              onClick={(e) => onOpenTarget(target(s), { newTab: e.ctrlKey || e.metaKey })}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && onOpenTarget(target(s), { newTab: true })}
              title={`${s.title}\nOpen here · Ctrl+click or middle-click opens in a new tab`}
              className={`flex-1 min-w-0 text-left ${indent} pr-2 py-1`}
            >
              <div className="text-[12px] text-zinc-300 truncate flex items-center gap-1.5">
                {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
                {s.oversized && <span className="shrink-0 text-amber-400">⚠</span>}
                <span className="truncate">{s.title}</span>
              </div>
              <div className="text-[10.5px] text-zinc-600 truncate">{fmtRelative(s.lastTs)} · {s.toolCalls} tools</div>
            </button>
            <button onClick={() => togglePin(target(s))} title={pinned ? 'Unpin session' : 'Pin session'} className={`${hoverBtn} self-center mr-1.5 ${pinned ? 'text-amber-300 opacity-100' : ''}`}>
              <PinIcon className="w-3.5 h-3.5" filled={pinned} />
            </button>
          </div>
        )
      })}
      {list.length > INLINE_SESSIONS && (
        <button onClick={() => setAll((a) => !a)} className={`${indent} pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300`}>
          {all ? 'show fewer' : `show all ${list.length}`}
        </button>
      )}
    </>
  )
}

// a project row usable in any cross-provider section: provider dot, name,
// folder, chevron to expand its sessions in place
function ProjectRow({ p, providers, open, onToggle, right, onOpen }) {
  const c = providerColor(providers, p.provider)
  const name = p.project || p.name || shortPath(p.cwd || p.slug, 1)
  return (
    <div className={`group flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
      <button onClick={onToggle} className="w-6 shrink-0 flex items-center justify-center text-zinc-600 hover:text-zinc-300" title={open ? 'Collapse' : 'Show sessions'}>
        <ChevronRightIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <button onClick={onOpen || onToggle} className="flex-1 min-w-0 text-left pr-1 py-1.5" title={p.cwd || p.slug}>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
          <span className="text-[12.5px] text-zinc-200 truncate">{name}</span>
        </div>
        <div className="text-[10.5px] text-zinc-600 truncate pl-3">
          {providerLabel(providers, p.provider)} · {p.rootLabel || ''}
        </div>
      </button>
      <div className="flex items-center gap-0.5 pr-1.5">{right}</div>
    </div>
  )
}

// "add to workspace" popover for a project row
function WorkspaceMenu({ project, workspaces, onClose }) {
  const ref = useRef(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => {
    const off = (e) => !ref.current?.contains(e.target) && onClose()
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const create = () => {
    if (!name.trim()) return
    createWorkspace(name, [project])
    onClose()
  }
  return (
    <div ref={ref} className="absolute right-2 top-full z-30 mt-0.5 w-56 rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl py-1 text-[12px]">
      <div className="px-3 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-600">Workspaces</div>
      {workspaces.map((w) => {
        const member = inWorkspace(w, project)
        return (
          <button
            key={w.id}
            onClick={() => (member ? removeFromWorkspace(w.id, project) : addToWorkspace(w.id, project))}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-300 hover:bg-ink-600 hover:text-zinc-100"
          >
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] ${member ? 'bg-sky-500/30 border-sky-400 text-sky-100' : 'border-zinc-600'}`}>{member ? '✓' : ''}</span>
            <span className="truncate">{w.name}</span>
            <span className="ml-auto text-zinc-600">{w.projects.length}</span>
          </button>
        )
      })}
      {!workspaces.length && <div className="px-3 py-1.5 text-zinc-600">No workspaces yet.</div>}
      <div className="border-t border-zinc-800 mt-1 pt-1 px-2">
        {creating ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => (e.key === 'Enter' ? create() : e.key === 'Escape' ? onClose() : null)}
              placeholder="Workspace name"
              className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 placeholder-zinc-600"
            />
            <button onClick={create} disabled={!name.trim()} className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">Add</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-1 py-1.5 text-left text-sky-300 hover:text-sky-200">
            <PlusIcon className="w-3.5 h-3.5" /> New workspace with this project…
          </button>
        )}
      </div>
    </div>
  )
}

export default function AppSidebar({
  providers,
  index,
  live,
  termKeys,
  scope,
  onScope,
  activeTarget,
  onOpenHome,
  onOpenTarget,
  onNewConversation,
  onNewProject,
  onDeleteSession,
  onDeleteSessions,
}) {
  const [filter, setFilter] = useState('')
  const [openSlug, setOpenSlug] = useState(null) // expanded project in the folder list
  const [openKeys, setOpenKeys] = useState(() => new Set()) // expanded projects in Workspaces / Pinned (projectKey)
  const [openWs, setOpenWs] = useState(() => new Set()) // expanded workspaces
  const [sections, setSections] = useState(loadSections)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirmDelId, setConfirmDelId] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [wsMenuFor, setWsMenuFor] = useState(null) // projectKey with the workspace menu open
  const [newWs, setNewWs] = useState(null) // '' while typing a new workspace name
  const [renaming, setRenaming] = useState(null) // { id, name }
  const [confirmWs, setConfirmWs] = useState(null) // workspace id pending delete
  const batchEpoch = useRef(0)
  const pins = usePins()
  const workspaces = useWorkspaces()

  const provider = scope?.provider || null
  const root = scope?.root || null
  const api = useMemo(() => (provider ? createApi(provider) : null), [provider])
  const scopeInfo = index.scopes.find((s) => s.provider === provider && s.root === root)
  const rootLabel = scopeInfo?.rootLabel || ''

  const projects = useMemo(() => index.projects.filter((p) => p.provider === provider && p.root === root), [index.projects, provider, root])
  const sessions = openSlug && provider ? index.sessionsFor(provider, root, openSlug) : null
  const suggestions = useMemo(() => suggestWorkspaces(index.projects, workspaces), [index.projects, workspaces])

  useEffect(() => {
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
    } catch {}
  }, [sections])
  const toggleSection = (k) => setSections((s) => ({ ...s, [k]: !s[k] }))
  const toggleIn = (setter) => (k) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const toggleKey = toggleIn(setOpenKeys)
  const toggleWs = toggleIn(setOpenWs)

  // follow the active tab: its project is the expanded one in the folder list
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
    setWsMenuFor(null)
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

  // terminal running › being written › nothing
  const dotFor = (prov, r, id) => {
    const k = liveSessionKey(prov, r, id)
    return termKeys?.has(k) ? 'bg-red-400 animate-pulse' : live?.ids?.has(k) ? 'bg-emerald-400 animate-pulse' : null
  }
  const isActive = (prov, r, id) => activeTarget?.provider === prov && activeTarget?.root === r && activeTarget?.id === id
  const projectTarget = (p) => ({ provider, root, rootLabel, slug: p.slug, cwd: p.cwd, project: p.name })
  const sessionTarget = (s) => {
    const p = projects.find((x) => x.slug === openSlug)
    return { provider, root, rootLabel, slug: openSlug, id: s.id, title: s.title, project: p?.name || null, cwd: p?.cwd || null }
  }
  const openProjectTab = (p, e) => onOpenTarget({ provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.project || p.name }, { newTab: e?.ctrlKey || e?.metaKey })

  const filtered = projects.filter((p) => {
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug} ${p.name}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })
  const pinnedProjects = pins.filter((p) => !p.id)
  const pinnedSessions = pins.filter((p) => p.id)

  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800 space-y-2.5">
        <FolderChips scopes={index.scopes} provider={provider} root={root} onPick={onScope} onManage={() => onOpenHome({ view: 'folders' })} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter projects…" className="w-full bg-ink-700 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 outline-none" />
        <button onClick={newProjectFlow} disabled={picking || !api} className="w-full text-left text-[12px] text-emerald-300/80 hover:text-emerald-200 disabled:opacity-60" title="Pick a folder (opens Finder/Explorer) and start a new conversation there">
          {picking ? '+ opening folder chooser…' : '+ New project (choose a folder)'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ---- Workspaces: cross-provider groups ---- */}
        {!filter && (
          <div className="border-b border-zinc-800/60 pb-1">
            <SectionHeader
              title="Workspaces"
              count={workspaces.length}
              open={sections.workspaces}
              onToggle={() => toggleSection('workspaces')}
              right={
                <button onClick={() => { setSections((s) => ({ ...s, workspaces: true })); setNewWs('') }} title="New workspace" className={`${iconBtn} text-zinc-500 hover:text-zinc-100 hover:bg-ink-600`}>
                  <PlusIcon className="w-3.5 h-3.5" />
                </button>
              }
            />
            {sections.workspaces && (
              <>
                {newWs != null && (
                  <div className="flex items-center gap-1 px-2 pb-1.5">
                    <input
                      autoFocus
                      value={newWs}
                      onChange={(e) => setNewWs(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newWs.trim()) {
                          const id = createWorkspace(newWs)
                          setOpenWs((s) => new Set(s).add(id))
                          setNewWs(null)
                        } else if (e.key === 'Escape') setNewWs(null)
                      }}
                      placeholder="Workspace name, then Enter"
                      className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 placeholder-zinc-600"
                    />
                    <button onClick={() => setNewWs(null)} className={`${iconBtn} text-zinc-500 hover:text-zinc-100`}><CloseIcon /></button>
                  </div>
                )}
                {workspaces.map((w) => {
                  const open = openWs.has(w.id)
                  return (
                    <div key={w.id}>
                      <div className={`group flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
                        <button onClick={() => toggleWs(w.id)} className="flex-1 min-w-0 text-left pl-2 pr-1 py-1.5 flex items-center gap-1.5">
                          <ChevronRightIcon className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                          <LayersIcon className="w-3.5 h-3.5 text-sky-300/80 shrink-0" />
                          {renaming?.id === w.id ? (
                            <input
                              autoFocus
                              value={renaming.name}
                              onChange={(e) => setRenaming({ id: w.id, name: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renameWorkspace(w.id, renaming.name)
                                  setRenaming(null)
                                } else if (e.key === 'Escape') setRenaming(null)
                              }}
                              onBlur={() => setRenaming(null)}
                              className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-1.5 py-0.5 text-[12.5px] text-zinc-100"
                            />
                          ) : (
                            <span className="text-[12.5px] text-zinc-200 truncate">{w.name}</span>
                          )}
                          <span className="text-[11px] text-zinc-600 shrink-0 ml-auto">{w.projects.length}</span>
                        </button>
                        {confirmWs === w.id ? (
                          <span className="flex items-center gap-1 pr-1.5 shrink-0 text-[10px]">
                            <span className="text-red-300">delete?</span>
                            <button onClick={() => { deleteWorkspace(w.id); setConfirmWs(null) }} className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
                            <button onClick={() => setConfirmWs(null)} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
                          </span>
                        ) : (
                          <div className="flex items-center gap-0.5 pr-1.5">
                            <button onClick={() => setRenaming({ id: w.id, name: w.name })} title="Rename" className={hoverBtn}><PencilIcon className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setConfirmWs(w.id)} title="Delete workspace (projects stay)" className={`${hoverBtn} hover:text-red-300`}><TrashIcon className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {open && (
                        <div className="pb-1">
                          {w.projects.map((p) => {
                            const k = projectKey(p)
                            const exp = openKeys.has(k)
                            return (
                              <div key={k} className="pl-4">
                                <ProjectRow
                                  p={p}
                                  providers={providers}
                                  open={exp}
                                  onToggle={() => toggleKey(k)}
                                  onOpen={(e) => openProjectTab(p, e)}
                                  right={<button onClick={() => removeFromWorkspace(w.id, p)} title="Remove from workspace" className={hoverBtn}><CloseIcon /></button>}
                                />
                                {exp && <SessionRows p={p} index={index} dotFor={dotFor} isActive={isActive} onOpenTarget={onOpenTarget} indent="pl-12" />}
                              </div>
                            )
                          })}
                          {!w.projects.length && <div className="pl-9 pr-2 py-1.5 text-[11.5px] text-zinc-600">Empty — use ⧉ on a project below to add it.</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!workspaces.length && newWs == null && !suggestions.length && (
                  <div className="px-3 pb-1.5 text-[11.5px] text-zinc-600">Group projects from any provider under one name — hover a project and press ⧉.</div>
                )}
                {suggestions.length > 0 && (
                  <div className="mt-1 mx-2 mb-1 rounded-md border border-dashed border-zinc-700/70 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Suggested · same folder, several providers</div>
                    {suggestions.slice(0, 5).map((s) => (
                      <div key={s.cwd} className="flex items-center gap-2 py-0.5">
                        <span className="flex -space-x-0.5 shrink-0">
                          {s.providers.map((pid) => <span key={pid} className={`w-1.5 h-1.5 rounded-full ring-1 ring-ink-900 ${providerColor(providers, pid).dot}`} />)}
                        </span>
                        <span className="flex-1 min-w-0 text-[12px] text-zinc-300 truncate" title={s.cwd}>{s.name}</span>
                        <button onClick={() => { const id = createWorkspace(s.name, s.projects); setOpenWs((o) => new Set(o).add(id)) }} className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200 hover:bg-sky-500/25">Group</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- Pinned: cross-provider projects (expand in place) + sessions ---- */}
        {!filter && pins.length > 0 && (
          <div className="border-b border-zinc-800/60 pb-1">
            <SectionHeader title="Pinned" count={pins.length} open={sections.pinned} onToggle={() => toggleSection('pinned')} />
            {sections.pinned && (
              <>
                {pinnedProjects.map((p) => {
                  const k = projectKey(p)
                  const exp = openKeys.has(k)
                  return (
                    <div key={k}>
                      <ProjectRow
                        p={p}
                        providers={providers}
                        open={exp}
                        onToggle={() => toggleKey(k)}
                        onOpen={(e) => openProjectTab(p, e)}
                        right={<button onClick={() => togglePin(p)} title="Unpin" className={`${hoverBtn} text-amber-300`}><PinIcon className="w-3.5 h-3.5" filled /></button>}
                      />
                      {exp && <SessionRows p={p} index={index} dotFor={dotFor} isActive={isActive} onOpenTarget={onOpenTarget} />}
                    </div>
                  )
                })}
                {pinnedSessions.map((p) => {
                  const dot = dotFor(p.provider, p.root, p.id)
                  const active = isActive(p.provider, p.root, p.id)
                  const c = providerColor(providers, p.provider)
                  return (
                    <div key={`${projectKey(p)}|${p.id}`} className={`group flex items-stretch hover:bg-ink-700/50 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
                      <button
                        onClick={(e) => onOpenTarget(p, { newTab: e.ctrlKey || e.metaKey })}
                        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                        onAuxClick={(e) => e.button === 1 && onOpenTarget(p, { newTab: true })}
                        title={`${p.project || ''} · ${p.title || ''}`}
                        className="flex-1 min-w-0 text-left pl-3 pr-2 py-1.5"
                      >
                        <div className="text-[12.5px] text-zinc-300 truncate flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot || c.dot}`} />
                          <span className="truncate">{p.title || p.id.slice(0, 8)}</span>
                        </div>
                        <div className="text-[10.5px] text-zinc-600 truncate pl-3">{providerLabel(providers, p.provider)} · {p.project || ''}</div>
                      </button>
                      <button onClick={() => togglePin(p)} title="Unpin" className={`${hoverBtn} self-center mr-1.5 text-amber-300`}>
                        <PinIcon className="w-3.5 h-3.5" filled />
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* ---- Projects of the current folder ---- */}
        <div className="pb-2">
          <SectionHeader title="Projects" count={filtered.length} open={sections.projects || !!filter} onToggle={() => toggleSection('projects')} />
          {(sections.projects || !!filter) &&
            filtered.map((p) => {
              const isOpen = p.slug === openSlug
              const pinned = isPinned({ provider, root, slug: p.slug })
              const pk = projectKey({ provider, root, slug: p.slug })
              const inAny = workspaces.some((w) => inWorkspace(w, { provider, root, slug: p.slug }))
              return (
                <div key={p.slug} className="border-b border-zinc-800/60 last:border-0 relative">
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
                        <button onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))} title={selectMode ? 'Leave select mode' : 'Select several sessions to trash'} className={`${iconBtn} hover:bg-ink-600 ${selectMode ? 'text-red-300 opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}>
                          <CheckSquareIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setWsMenuFor(wsMenuFor === pk ? null : pk)} title="Add to a workspace" className={`${iconBtn} hover:bg-ink-600 ${inAny || wsMenuFor === pk ? 'text-sky-300 opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}>
                        <LayersIcon className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => togglePin(projectTarget(p))} title={pinned ? 'Unpin project' : 'Pin project'} className={`${iconBtn} hover:bg-ink-600 ${pinned ? 'text-amber-300 opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100'}`}>
                        <PinIcon className="w-3.5 h-3.5" filled={pinned} />
                      </button>
                    </div>
                  </div>
                  {wsMenuFor === pk && <WorkspaceMenu project={projectTarget(p)} workspaces={workspaces} onClose={() => setWsMenuFor(null)} />}

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
                                {list.some((s) => selected.has(s.id) && (dotFor(provider, root, s.id) || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000))) ? ' (incl. active!)' : ''}?
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
                        const active = isActive(provider, root, s.id)
                        const dot = dotFor(provider, root, s.id)
                        const recent = !!dot || (s.lastTs && Date.now() - new Date(s.lastTs).getTime() < 5 * 60 * 1000)
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
                                {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} title={dot.startsWith('bg-red') ? 'terminal running' : 'being written'} />}
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
          {(sections.projects || !!filter) && filtered.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-zinc-600">{!scope ? 'No tracked folders yet — press + above to track one.' : index.loading && !projects.length ? 'Loading projects…' : 'No projects.'}</div>
          )}
        </div>
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
