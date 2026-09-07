import { useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from '../../api.js'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { isPinned, togglePin, usePins } from '../../lib/pins.js'
import { createWorkspace, deleteWorkspace, projectKey, removeFromWorkspace, renameWorkspace, sourceKey, suggestWorkspaces, useWorkspaces, workspaceSources } from '../../lib/workspaces.js'
import { usePrefs } from '../../lib/prefs.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import { ChevronRightIcon, CloseIcon, DotsIcon, LayersIcon, PinIcon, PlusIcon } from './shellIcons.jsx'
import { FolderIcon } from './icons.jsx'
import PathPicker from './PathPicker.jsx'
import FolderChips from './FolderChips.jsx'
import RowMenu from './RowMenu.jsx'
import useConfirm from '../../lib/useConfirm.jsx'

// The one sidebar. It belongs to the shell, so it is the same column whether
// the active tab shows Home or a session — only the highlights move.
//
//   folders      every tracked folder of every provider as colour-coded chips
//                (+ = track another / edit labels)
//   filter, + New project
//   Workspaces   named groups of projects and sessions from ANY provider /
//                folder, shown as ONE flat session list; a coloured source tag
//                (provider dot + folder label) tells the members apart, and
//                the source chips above the list filter it
//   Pinned       pinned projects (expand in place) and sessions, every provider
//   Projects     the current folder's projects; expand one to see its sessions
//
// Every row has the same two hover controls — pin and ⋯ — and everything else
// (workspaces, select, trash, rename…) lives in the ⋯ menu. Click opens in
// the current tab, Ctrl/middle-click in a new one.

const SECTIONS_KEY = 'agentdeck_sidebar_sections'
const INLINE_SESSIONS = 8 // sessions under a pinned project before "show all"
const WS_SESSIONS = 12 // sessions in a workspace list before "show all"
const loadSections = () => {
  try {
    return { workspaces: true, pinned: true, projects: true, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}') }
  } catch {
    return { workspaces: true, pinned: true, projects: true }
  }
}

const iconBtn = 'w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors'
const hoverBtn = `${iconBtn} text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-100 hover:bg-ink-600`
const RECENT_MS = 5 * 60 * 1000

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

// provider dot + folder label — what tells members of a workspace apart
function SourceTag({ providers, provider, rootLabel, className = '' }) {
  const c = providerColor(providers, provider)
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={`${providerLabel(providers, provider)} · ${rootLabel}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
      <span className={`truncate ${c.text}`}>{rootLabel}</span>
    </span>
  )
}

// targets --------------------------------------------------------------
const srcOf = (p) => ({ provider: p.provider, root: p.root, rootLabel: p.rootLabel || '', slug: p.slug, project: p.project || p.name || shortPath(p.cwd || p.slug, 1), cwd: p.cwd || null })
const sessionTarget = (src, s) => ({ ...src, id: s.id, title: s.title })
const projectItem = (src) => ({ kind: 'project', ...src })
const sessionItem = (src, s) => ({ kind: 'session', ...src, id: s.id, title: s.title })

// one session row, shared by every section ------------------------------
function SessionLine({ ctx, src, s, indent = 'pl-7', showSource = false, menuKey, extraItems = [], selectable = false }) {
  const { providers, dotFor, isActive, isRecent, selected, toggleSelected, onOpenTarget, onDeleteSession, menuFor, setMenuFor, workspaces } = ctx
  const dot = dotFor(src.provider, src.root, s.id)
  const active = isActive(src.provider, src.root, s.id)
  const pinned = isPinned({ provider: src.provider, root: src.root, slug: src.slug, id: s.id })
  const checked = selectable && selected.has(s.id)
  const t = sessionTarget(src, s)
  const items = [
    ...extraItems,
    onDeleteSession && { label: 'Move to trash', danger: true, onClick: () => ctx.askTrash(src, s, !!dot || isRecent(s)) },
  ].filter(Boolean)
  return (
    <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${selectable && checked ? 'bg-red-500/10' : active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
      <button
        onClick={(e) => (selectable ? toggleSelected(s.id) : onOpenTarget(t, { newTab: e.ctrlKey || e.metaKey }))}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && !selectable && onOpenTarget(t, { newTab: true })}
        title={selectable ? undefined : `${s.title}\nOpen here · Ctrl+click or middle-click opens in a new tab`}
        className={`flex-1 min-w-0 text-left ${indent} pr-2 sb-row`}
      >
        <div className="text-[12px] text-zinc-400 group-hover:text-zinc-200 truncate flex items-center gap-1.5">
          {selectable && <span className={`shrink-0 ${checked ? 'text-red-300' : 'text-zinc-600'}`}>{checked ? '☑' : '☐'}</span>}
          {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} title={dot.startsWith('bg-red') ? 'terminal running' : 'being written'} />}
          {s.isSubagent && <span className="shrink-0 text-violet-400" title={`subagent${s.agentRole ? ` · ${s.agentRole}` : ''}`}>⤷</span>}
          {s.oversized && <span className="shrink-0 text-amber-400" title="Transcript exceeds the parse limit — it can't be opened">⚠</span>}
          {pinned && !selectable && <PinIcon className="w-3 h-3 text-amber-300 shrink-0" filled />}
          <span className="truncate">{s.title}</span>
        </div>
        <div className="sb-meta flex items-center gap-1.5 text-[10.5px] text-zinc-600 min-w-0">
          {showSource && <SourceTag providers={providers} provider={src.provider} rootLabel={src.rootLabel} className="max-w-[45%]" />}
          {showSource && <span className="truncate">{src.project}</span>}
          {showSource && <span>·</span>}
          <span className="shrink-0">{s.lastTs ? fmtRelative(s.lastTs) : ''}</span>
          {s.toolCalls != null && <span className="shrink-0">· {s.toolCalls} tools</span>}
          {s.childCount > 0 && <span className="text-violet-400/80 shrink-0">· ⤷ {s.childCount}</span>}
          {s.hasSubagents && <span className="text-violet-400 shrink-0">· ⚇ subs</span>}
        </div>
      </button>
      {!selectable && (
        <div className="flex items-center gap-0.5 pr-1.5">
          <button onClick={() => togglePin(t)} title={pinned ? 'Unpin session' : 'Pin session'} className={`${hoverBtn} ${pinned ? 'text-amber-300 opacity-100' : ''}`}>
            <PinIcon className="w-3.5 h-3.5" filled={pinned} />
          </button>
          <button onClick={() => setMenuFor(menuFor === menuKey ? null : menuKey)} title="More" className={`${hoverBtn} ${menuFor === menuKey ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}>
            <DotsIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <RowMenu open={menuFor === menuKey} onClose={() => setMenuFor(null)} items={items} workspaceItem={sessionItem(src, s)} workspaces={workspaces} />
    </div>
  )
}

// a project row for the cross-provider sections (pinned): chevron, dot, name, folder
function ProjectLine({ ctx, src, open, onToggle, menuKey, children }) {
  const { providers, onOpenTarget, menuFor, setMenuFor, workspaces } = ctx
  const c = providerColor(providers, src.provider)
  const pinned = isPinned({ provider: src.provider, root: src.root, slug: src.slug })
  const t = { provider: src.provider, root: src.root, rootLabel: src.rootLabel, slug: src.slug, cwd: src.cwd, project: src.project }
  return (
    <div>
      <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
        <button onClick={onToggle} className="w-6 shrink-0 flex items-center justify-center text-zinc-600 hover:text-zinc-300" title={open ? 'Collapse' : 'Show sessions'}>
          <ChevronRightIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <button onClick={(e) => onOpenTarget(t, { newTab: e.ctrlKey || e.metaKey })} className="flex-1 min-w-0 text-left pr-1 sb-row-lg" title={`${src.cwd || src.slug}\nOpen the project · Ctrl+click for a new tab`}>
          <div className="flex items-center gap-1.5">
            <FolderIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
            <span className="text-[13px] font-medium text-zinc-200 truncate">{src.project}</span>
          </div>
          <div className="sb-meta text-[10.5px] text-zinc-600 truncate pl-5">{providerLabel(providers, src.provider)} · {src.rootLabel}</div>
        </button>
        <div className="flex items-center gap-0.5 pr-1.5">
          <button onClick={() => togglePin(t)} title={pinned ? 'Unpin project' : 'Pin project'} className={`${hoverBtn} ${pinned ? 'text-amber-300 opacity-100' : ''}`}>
            <PinIcon className="w-3.5 h-3.5" filled={pinned} />
          </button>
          <button onClick={() => setMenuFor(menuFor === menuKey ? null : menuKey)} title="More" className={`${hoverBtn} ${menuFor === menuKey ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}>
            <DotsIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <RowMenu open={menuFor === menuKey} onClose={() => setMenuFor(null)} items={[]} workspaceItem={projectItem(src)} workspaces={workspaces} />
      </div>
      {children}
    </div>
  )
}

// sessions of a project from the index (pinned projects expand in place)
function ProjectSessions({ ctx, src, indent = 'pl-9', keyPrefix }) {
  const { index, openKeys, toggleKey } = ctx
  const lst = index.sessionsFor(src.provider, src.root, src.slug)
  const all = openKeys.has(`${keyPrefix}|all`)
  if (lst === null) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>loading…</div>
  if (!lst.length) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>no sessions yet</div>
  const shown = all ? lst : lst.slice(0, INLINE_SESSIONS)
  return (
    <>
      {shown.map((s) => <SessionLine key={s.id} ctx={ctx} src={src} s={s} indent={indent} menuKey={`${keyPrefix}|${s.id}`} />)}
      {lst.length > INLINE_SESSIONS && (
        <button onClick={() => toggleKey(`${keyPrefix}|all`)} className={`${indent} pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300`}>
          {all ? 'show fewer' : `show all ${lst.length}`}
        </button>
      )}
    </>
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
  onNewProject,
  onDeleteSession,
  onDeleteSessions,
}) {
  const [filter, setFilter] = useState('')
  const [openSlug, setOpenSlug] = useState(null) // expanded project in the folder list
  const [openKeys, setOpenKeys] = useState(() => new Set()) // expanded pinned projects
  const [openWs, setOpenWs] = useState(() => new Set()) // expanded workspaces
  const [wsFilter, setWsFilter] = useState({}) // workspace id -> Set(sourceKey)
  const [wsAll, setWsAll] = useState(() => new Set()) // workspaces showing every session
  const [sections, setSections] = useState(loadSections)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [menuFor, setMenuFor] = useState(null) // key of the open ⋯ menu
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [confirmEl, confirm] = useConfirm()
  const [newWs, setNewWs] = useState(null) // '' while typing a new workspace name
  const [renaming, setRenaming] = useState(null) // { id, name }
  const batchEpoch = useRef(0)
  const pins = usePins()
  const workspaces = useWorkspaces()
  const prefs = usePrefs()

  const provider = scope?.provider || null
  const root = scope?.root || null
  const api = useMemo(() => (provider ? createApi(provider) : null), [provider])
  const scopeInfo = index.scopes.find((s) => s.provider === provider && s.root === root)
  const rootLabel = scopeInfo?.rootLabel || ''

  const projects = useMemo(() => index.projects.filter((p) => p.provider === provider && p.root === root), [index.projects, provider, root])
  const sessions = openSlug && provider ? index.sessionsFor(provider, root, openSlug) : null
  const suggestions = useMemo(() => suggestWorkspaces(index.projects, workspaces), [index.projects, workspaces])
  // two workspaces called "AgentDeck" (…/project/AgentDeck vs …/maintain/AgentDeck) → show the parent folder too
  const wsName = useMemo(() => {
    const count = new Map()
    for (const w of workspaces) count.set(w.name, (count.get(w.name) || 0) + 1)
    const out = new Map()
    for (const w of workspaces) {
      const cwds = new Set(w.items.map((it) => String(it.cwd || '').replace(/[\\/]+$/, '').toLowerCase()).filter(Boolean))
      const only = cwds.size === 1 ? w.items.find((it) => it.cwd)?.cwd : null
      out.set(w.id, count.get(w.name) > 1 && only ? shortPath(only, 2) : w.name)
    }
    return out
  }, [workspaces])

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
  const toggleWsAll = toggleIn(setWsAll)
  const toggleWsSource = (wid, sk) =>
    setWsFilter((prev) => {
      const cur = new Set(prev[wid] || [])
      if (cur.has(sk)) cur.delete(sk)
      else cur.add(sk)
      return { ...prev, [wid]: cur }
    })

  // follow the active tab: its project is the expanded one in the folder list
  useEffect(() => {
    if (activeTarget?.provider === provider && activeTarget?.root === root && activeTarget?.slug) setOpenSlug(activeTarget.slug)
  }, [activeTarget?.provider, activeTarget?.root, activeTarget?.slug, provider, root])

  // selections don't survive a scope or project change
  useEffect(() => {
    batchEpoch.current++
    setSelectMode(false)
    setSelected(new Set())
    setMenuFor(null)
  }, [provider, root, openSlug])

  const list = sessions || []
  const selCount = list.filter((s) => selected.has(s.id)).length

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
  }
  const askBatchDelete = async () => {
    if (batchBusy) return
    const picked = list.filter((s) => selected.has(s.id))
    if (!picked.length) return
    const activeN = picked.filter((s) => dotFor(provider, root, s.id) || isRecent(s)).length
    const ok = await confirm({
      title: `Move ${picked.length} session${picked.length === 1 ? '' : 's'} to the trash?`,
      message: activeN ? `${activeN} of them ${activeN === 1 ? 'is' : 'are'} active right now — a transcript still being written ends up truncated.` : 'They go to the OS trash and can be restored from there.',
      detail: picked.slice(0, 4).map((s) => s.title).join(' · ') + (picked.length > 4 ? ` · +${picked.length - 4} more` : ''),
      confirmLabel: 'Move to trash',
    })
    if (!ok) return
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
  const isRecent = (s) => s.lastTs && Date.now() - new Date(s.lastTs).getTime() < RECENT_MS

  // a workspace as ONE flat, time-sorted session list across all its members
  const wsRows = (w) => {
    const rows = []
    const seen = new Set()
    let loading = false
    const tracked = (it) => index.scopes.some((x) => x.provider === it.provider && x.root === it.root)
    let untracked = 0
    for (const it of w.items) {
      if (it.kind !== 'project') continue
      if (!tracked(it)) {
        untracked++
        continue
      }
      const lst = index.sessionsFor(it.provider, it.root, it.slug)
      if (lst === null) {
        loading = true
        continue
      }
      for (const s of lst) {
        const k = `${it.provider}|${it.root}|${s.id}`
        if (seen.has(k)) continue
        seen.add(k)
        rows.push({ src: srcL(it), s, item: it })
      }
    }
    for (const it of w.items) {
      if (it.kind !== 'session') continue
      if (!tracked(it)) {
        untracked++
        continue
      }
      const k = `${it.provider}|${it.root}|${it.id}`
      if (seen.has(k)) continue
      seen.add(k)
      const lst = index.sessionsFor(it.provider, it.root, it.slug)
      const fresh = lst?.find((x) => x.id === it.id)
      rows.push({ src: srcL(it), s: fresh || { id: it.id, title: it.title || it.id.slice(0, 8), lastTs: null, toolCalls: null }, item: it })
    }
    rows.sort((a, b) => String(b.s.lastTs || '').localeCompare(String(a.s.lastTs || '')))
    return { rows, loading, untracked }
  }

  // labels come from the live folder list, never from what was stored when a
  // pin / workspace item was created — a relabelled folder updates everywhere
  const labelOf = (prov, r, fallback = '') => index.scopes.find((x) => x.provider === prov && x.root === r)?.rootLabel || fallback
  const srcL = (p) => {
    const src = srcOf(p)
    return { ...src, rootLabel: labelOf(src.provider, src.root, src.rootLabel) }
  }

  const askTrash = async (src, s, active) => {
    const ok = await confirm({
      title: 'Move this session to the trash?',
      message: s.title,
      detail: `${providerLabel(providers, src.provider)} · ${src.project} · ${src.rootLabel}${active ? ' — active right now: a transcript still being written ends up truncated.' : ''}`,
      confirmLabel: 'Move to trash',
    })
    if (ok) onDeleteSession?.({ provider: src.provider, root: src.root }, src.slug, s)
  }
  const askDeleteWorkspace = async (w) => {
    const ok = await confirm({
      title: `Delete workspace “${w.name}”?`,
      message: 'Only the grouping goes away.',
      detail: `Its ${w.items.length} project${w.items.length === 1 ? '' : 's'} and sessions stay where they are.`,
      confirmLabel: 'Delete workspace',
    })
    if (ok) deleteWorkspace(w.id)
  }

  const ctx = { providers, index, dotFor, isActive, isRecent, selected, toggleSelected, onOpenTarget, onDeleteSession, askTrash, menuFor, setMenuFor, workspaces, openKeys, toggleKey }

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
        <FolderChips scopes={index.scopes} providers={providers} value={scope} onPick={onScope} onManage={() => onOpenHome({ view: 'folders' })} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter projects…" className="w-full bg-ink-700 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 outline-none" />
        <button onClick={newProjectFlow} disabled={picking || !api} className="w-full text-left text-[12px] text-emerald-300/80 hover:text-emerald-200 disabled:opacity-60" title="Pick a folder (opens Finder/Explorer) and start a new conversation there">
          {picking ? '+ opening folder chooser…' : '+ New project (choose a folder)'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ---- Workspaces ---- */}
        {!filter && prefs.showWorkspaces && (
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
                  const sources = workspaceSources(w).map((x) => ({ ...x, rootLabel: labelOf(x.provider, x.root, x.rootLabel) }))
                  const filt = wsFilter[w.id]
                  const { rows, loading, untracked } = open ? wsRows(w) : { rows: [], loading: false, untracked: 0 }
                  const visible = filt?.size ? rows.filter((r) => filt.has(sourceKey(r.src))) : rows
                  const shown = wsAll.has(w.id) ? visible : visible.slice(0, WS_SESSIONS)
                  const mk = `ws|${w.id}`
                  return (
                    <div key={w.id}>
                      <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
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
                            <span className="text-[12.5px] text-zinc-200 truncate" title={w.name}>{wsName.get(w.id) || w.name}</span>
                          )}
                          {!open && sources.length > 0 && (
                            <span className="flex -space-x-0.5 shrink-0 ml-1">
                              {sources.map((s) => <span key={s.key} className={`w-1.5 h-1.5 rounded-full ring-1 ring-ink-900 ${providerColor(providers, s.provider).dot}`} />)}
                            </span>
                          )}
                          <span className="text-[11px] text-zinc-600 shrink-0 ml-auto">{w.items.length}</span>
                        </button>
                        <div className="flex items-center gap-0.5 pr-1.5">
                          <button onClick={() => setMenuFor(menuFor === mk ? null : mk)} title="More" className={`${hoverBtn} ${menuFor === mk ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}>
                            <DotsIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <RowMenu
                          open={menuFor === mk}
                          onClose={() => setMenuFor(null)}
                          items={[
                            { label: 'Rename', onClick: () => setRenaming({ id: w.id, name: w.name }) },
                            { label: 'Delete workspace', danger: true, onClick: () => askDeleteWorkspace(w) },
                          ]}
                        />
                      </div>
                      {open && (
                        <div className="pb-1">
                          {sources.length > 1 && (
                            <div className="flex flex-wrap items-center gap-1 pl-7 pr-2 pb-1">
                              {sources.map((s) => {
                                const on = filt?.has(s.key)
                                const c = providerColor(providers, s.provider)
                                return (
                                  <button
                                    key={s.key}
                                    onClick={() => toggleWsSource(w.id, s.key)}
                                    title={`${providerLabel(providers, s.provider)} · ${s.rootLabel}${on ? ' — showing only this' : ' — click to show only this'}`}
                                    className={`flex items-center gap-1 px-1.5 h-5 rounded text-[10.5px] border transition-colors ${on ? `bg-ink-600 border-zinc-500 ${c.text}` : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600'}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                                    <span className="truncate max-w-[110px]">{s.rootLabel}</span>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          {shown.map((r) => (
                            <SessionLine
                              ctx={ctx}
                              key={`${r.src.provider}|${r.src.root}|${r.s.id}`}
                              src={r.src}
                              s={r.s}
                              showSource
                              menuKey={`${mk}|${r.src.provider}|${r.src.root}|${r.s.id}`}
                              extraItems={[{ label: r.item.kind === 'session' ? 'Remove from workspace' : `Remove ${r.src.project} (${r.src.rootLabel}) from workspace`, onClick: () => removeItem(w.id, r.item) }]}
                            />
                          ))}
                          {loading && <div className="pl-7 pr-2 py-1.5 text-[11.5px] text-zinc-600">loading…</div>}
                          {untracked > 0 && <div className="pl-7 pr-2 py-1 text-[11px] text-zinc-600">{untracked} member{untracked === 1 ? '' : 's'} in a folder that is no longer tracked — hidden</div>}
                          {!loading && !rows.length && <div className="pl-7 pr-2 py-1.5 text-[11.5px] text-zinc-600">Empty — open ⋯ on a project or session and tick this workspace.</div>}
                          {visible.length > WS_SESSIONS && (
                            <button onClick={() => toggleWsAll(w.id)} className="pl-7 pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300">
                              {wsAll.has(w.id) ? 'show fewer' : `show all ${visible.length}`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!workspaces.length && newWs == null && !suggestions.length && (
                  <div className="px-3 pb-1.5 text-[11.5px] text-zinc-600">Group projects and sessions from any provider under one name — ⋯ on a row → Workspaces.</div>
                )}
                {suggestions.length > 0 && (
                  <div className="mt-1 mx-2 mb-1 rounded-md border border-dashed border-zinc-700/70 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Suggested · same folder in several places</div>
                    {suggestions.slice(0, 5).map((s) => (
                      <div key={s.cwd} className="flex items-center gap-2 py-0.5">
                        <span className="flex -space-x-0.5 shrink-0">
                          {s.sources.map((x) => <span key={`${x.provider}|${x.root}`} className={`w-1.5 h-1.5 rounded-full ring-1 ring-ink-900 ${providerColor(providers, x.provider).dot}`} title={`${providerLabel(providers, x.provider)} · ${x.rootLabel}`} />)}
                        </span>
                        <span className="flex-1 min-w-0 text-[12px] text-zinc-300 truncate" title={s.cwd}>{s.name}</span>
                        <span className="text-[10.5px] text-zinc-600 shrink-0">{s.sources.length}</span>
                        <button onClick={() => { const id = createWorkspace(s.name, s.items); setOpenWs((o) => new Set(o).add(id)) }} className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200 hover:bg-sky-500/25">Group</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- Pinned: every provider ---- */}
        {!filter && prefs.showPinned && pins.length > 0 && (
          <div className="border-b border-zinc-800/60 pb-1">
            <SectionHeader title="Pinned" count={pins.length} open={sections.pinned} onToggle={() => toggleSection('pinned')} />
            {sections.pinned && (
              <>
                {pinnedProjects.map((p) => {
                  const k = projectKey(p)
                  const src = srcL(p)
                  return (
                    <ProjectLine ctx={ctx} key={k} src={src} open={openKeys.has(k)} onToggle={() => toggleKey(k)} menuKey={`pin|${k}`}>
                      {openKeys.has(k) && <ProjectSessions ctx={ctx} src={src} keyPrefix={`pin|${k}`} />}
                    </ProjectLine>
                  )
                })}
                {pinnedSessions.map((p) => (
                  <SessionLine ctx={ctx} key={`${projectKey(p)}|${p.id}`} src={srcL(p)} s={{ id: p.id, title: p.title || p.id.slice(0, 8), lastTs: null, toolCalls: null }} indent="pl-3" showSource menuKey={`pin|${projectKey(p)}|${p.id}`} />
                ))}
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
              const src = srcL({ ...p, provider, root, rootLabel })
              const pinned = isPinned({ provider, root, slug: p.slug })
              const pk = projectKey({ provider, root, slug: p.slug })
              const mk = `proj|${pk}`
              return (
                <div key={p.slug} className="border-b border-zinc-800/60 last:border-0">
                  <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${isOpen ? 'bg-ink-700/40' : ''}`}>
                    <button onClick={() => setOpenSlug(isOpen ? null : p.slug)} className="flex-1 min-w-0 text-left pl-3 pr-1 sb-row-lg">
                      <div className="flex items-center gap-1.5">
                        <span className="text-zinc-600 text-xs w-3 shrink-0">{isOpen ? '▾' : '▸'}</span>
                        <FolderIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <span className="text-[13px] font-medium text-zinc-200 truncate flex-1" title={p.cwd || p.slug}>{shortPath(p.cwd || p.slug)}</span>
                        <span className="text-[11px] text-zinc-600 shrink-0">{p.sessionCount}</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-0.5 pr-1.5">
                      <button onClick={() => togglePin({ provider, root, rootLabel, slug: p.slug, cwd: p.cwd, project: p.name })} title={pinned ? 'Unpin project' : 'Pin project'} className={`${hoverBtn} ${pinned ? 'text-amber-300 opacity-100' : ''}`}>
                        <PinIcon className="w-3.5 h-3.5" filled={pinned} />
                      </button>
                      <button onClick={() => setMenuFor(menuFor === mk ? null : mk)} title="More" className={`${hoverBtn} ${menuFor === mk ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}>
                        <DotsIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <RowMenu
                      open={menuFor === mk}
                      onClose={() => setMenuFor(null)}
                      items={[
                        onDeleteSessions && { label: 'Select sessions to trash…', disabled: !p.sessionCount, onClick: () => { setOpenSlug(p.slug); setSelectMode(true) } },
                      ].filter(Boolean)}
                      workspaceItem={projectItem(src)}
                      workspaces={workspaces}
                    />
                  </div>

                  {isOpen && (
                    <div className="pb-1">
                      {selectMode && (
                        <div className="pl-7 pr-2 py-1 flex items-center gap-1.5 text-[11px]">
                          <span className="text-zinc-400">{selCount} selected</span>
                          <button onClick={() => setSelected(selCount === list.length ? new Set() : new Set(list.map((s) => s.id)))} className="px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200">
                            {selCount === list.length ? 'none' : 'all'}
                          </button>
                          <span className="flex-1" />
                          {batchBusy ? (
                            <span className="text-zinc-500">trashing…</span>
                          ) : (
                            <>
                              <button onClick={askBatchDelete} disabled={selCount === 0} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-40">Delete…</button>
                              <button onClick={exitSelectMode} className="px-1.5 py-0.5 rounded bg-ink-600 text-zinc-300">Cancel</button>
                            </>
                          )}
                        </div>
                      )}
                      {sessions === null && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                      {sessions && sessions.length === 0 && <div className="px-7 py-2 text-[12px] text-zinc-600">no sessions yet</div>}
                      {list.map((s) => <SessionLine ctx={ctx} key={s.id} src={src} s={s} menuKey={`${mk}|${s.id}`} selectable={selectMode} />)}
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

      {confirmEl}
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

function removeItem(wid, item) {
  removeFromWorkspace(wid, item)
}
