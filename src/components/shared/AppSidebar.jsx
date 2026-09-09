import { sameTarget, targetKey } from '../../lib/tabs.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from '../../api.js'
import { fmtRelative } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'
import { MOD_WORD } from './ShortcutHints.jsx'
import { isPinned, togglePin, usePins, isFolderPin, pinsForMode } from '../../lib/pins.js'
import { adoptPendingProjects, createWorkspace, deleteWorkspace, normCwd, projectKey, rememberAdoption, removeFromWorkspace, renameWorkspace, setWorkspaceColor, setWorkspaceIcon, sourceKey, suggestWorkspaces, useWorkspaces, workspaceHolding, workspaceSources, isFolderItem, standaloneWorkspaceItems } from '../../lib/workspaces.js'
import { WorkspaceIcon } from './workspaceIcons.jsx'
import { setFolderFilter, usePrefs } from '../../lib/prefs.js'
import { toggleHomeFilter } from '../../lib/homeScope.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { providerColor, providerLabel, statusDot } from '../../lib/providerColors.js'
import { accentStyle } from '../../lib/accent.js'
import { ChevronRightIcon, CloseIcon, DotsIcon, LayersIcon, PinIcon, PlusIcon } from './shellIcons.jsx'
import { FolderIcon } from './icons.jsx'
import PathPicker from './PathPicker.jsx'
import FolderChips from './FolderChips.jsx'
import RowMenu from './RowMenu.jsx'
import useConfirm from '../../lib/useConfirm.jsx'
import useFolderCatalog from '../../lib/useFolderCatalog.js'
import FolderProjects from './FolderProjects.jsx'
import ProviderFilterChips from './ProviderFilterChips.jsx'
import useEscToClose from '../../lib/useEscToClose.js'

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
//   Pinned       pinned projects (expand in place) and sessions, every provider.
//                Pinning MOVES a row here: a pinned project leaves the Projects
//                list and a pinned session leaves its project's inline list, so
//                nothing is listed twice (searching shows everything again).
//   Projects     the current folder's projects; expand one to see its sessions
//   Folder mode  replaces the root chips and Projects with the host's canonical
//                folder tree, filtered by provider chips. Workspaces/pins are
//                independent shortcuts; provider/root identities stay distinct.
//
// Every row has the same two hover controls — pin and ⋯ — and everything else
// (workspaces, select, trash, rename…) lives in the ⋯ menu. Click opens in
// the current tab, Ctrl/middle-click in a new one.

const SECTIONS_KEY = 'agentdeck_sidebar_sections'
const INLINE_SESSIONS = 8 // sessions under a pinned project before "show all"
const WS_GROUP_SESSIONS = 6 // sessions shown per project inside a workspace before "show all"
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

// a "New conversation" tab that has not written anything yet: a muted row under
// the project it will land in, so the reader sees where the work goes before the
// first record exists. Clicking it focuses that tab.
const draftsOf = (drafts, src) => (drafts || []).filter((d) => d.provider === src.provider && d.root === src.root && ((d.slug && d.slug === src.slug) || (d.cwd && d.cwd === src.cwd)))
function DraftLine({ ctx, d, indent = 'pl-7' }) {
  const active = ctx.activeTarget?.draft && sameTarget(ctx.activeTarget, d)
  return (
    <button onClick={() => ctx.onOpenTarget(d)} title={`New conversation in ${d.cwd || d.slug} — nothing written yet`} className={`w-full text-left ${indent} pr-2 sb-row flex items-center gap-2 hover:bg-ink-700/50 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0 border border-dashed border-zinc-500" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-zinc-400 italic truncate">New conversation</span>
        <span className="block sb-meta text-[10.5px] text-zinc-600 truncate">not written yet</span>
      </span>
    </button>
  )
}

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
        title={selectable ? undefined : `${s.title}\nOpen here · ${MOD_WORD}+click or middle-click opens in a new tab`}
        className={`flex-1 min-w-0 text-left ${indent} pr-2 sb-row`}
      >
        <div className={`text-[12px] ${ctx.folderSession ? 'text-zinc-300' : 'text-zinc-400'} group-hover:text-zinc-200 truncate flex items-center gap-1.5`}>
          {selectable && <span className={`shrink-0 ${checked ? 'text-red-300' : 'text-zinc-600'}`}>{checked ? '☑' : '☐'}</span>}
          {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} title={dot.includes('terminal') ? 'terminal running' : 'being written'} />}
          {s.isSubagent && <span className="shrink-0 text-violet-400" title={`subagent${s.agentRole ? ` · ${s.agentRole}` : ''}`}>⤷</span>}
          {s.oversized && <span className="shrink-0 text-amber-400" title="Transcript exceeds the parse limit — it can't be opened">⚠</span>}
          {pinned && !selectable && <PinIcon className="w-3 h-3 text-amber-300 shrink-0" filled />}
          <span className="truncate">{s.title}</span>
          {s.lastTs && <span className="sb-time ml-auto pl-2 shrink-0 text-[10px] text-zinc-600 tabular-nums">{fmtRelative(s.lastTs)}</span>}
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

// Exact project actions shared by Provider mode, Pinned and Folder-mode roots.
export function ProjectActions({ ctx, src, menuKey, items, bounded = false }) {
  const pinned = isPinned(src)
  return <>
    <div className="flex items-center gap-0.5 pr-1.5 shrink-0">
      <button disabled={!src.slug} onClick={() => togglePin(src)} title={pinned ? 'Unpin project' : 'Pin project'} className={`${hoverBtn} disabled:opacity-30 ${pinned ? 'text-amber-300 opacity-100' : ''}`}><PinIcon className="w-3.5 h-3.5" filled={pinned} /></button>
      <button onClick={() => ctx.setMenuFor(ctx.menuFor === menuKey ? null : menuKey)} title="More" className={`${hoverBtn} ${ctx.menuFor === menuKey ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}><DotsIcon className="w-3.5 h-3.5" /></button>
    </div>
    <RowMenu open={ctx.menuFor === menuKey} onClose={() => ctx.setMenuFor(null)} items={items || ctx.newConversationItems(src)} workspaceItem={src.slug ? projectItem(src) : null} workspaces={ctx.workspaces} bounded={bounded} />
  </>
}

// a project row for the cross-provider sections (pinned): chevron, dot, name, folder
function ProjectLine({ ctx, src, open, onToggle, menuKey, children }) {
  const { providers, onOpenTarget } = ctx
  const c = providerColor(providers, src.provider)
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
        <ProjectActions ctx={ctx} src={t} menuKey={menuKey} />
      </div>
      {children}
    </div>
  )
}

// sessions of a project from the index (pinned projects expand in place)
function ProjectSessions({ ctx, src, indent = 'pl-9', keyPrefix }) {
  const { index, openKeys, toggleKey, hidePinned, hideGrouped, workspaces } = ctx
  const full = index.sessionsFor(src.provider, src.root, src.slug)
  const all = openKeys.has(`${keyPrefix}|all`)
  if (full === null) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>loading…</div>
  // pinned sessions live in the Pinned section and grouped ones in their
  // workspace, not under their project — nothing is listed twice
  const notPinned = hidePinned ? full.filter((s) => !isPinned({ provider: src.provider, root: src.root, slug: src.slug, id: s.id })) : full
  const hidden = full.length - notPinned.length
  const lst = hideGrouped ? notPinned.filter((s) => !workspaceHolding({ kind: 'session', provider: src.provider, root: src.root, slug: src.slug, id: s.id }, workspaces)) : notPinned
  const grouped = notPinned.length - lst.length
  const ghosts = draftsOf(ctx.drafts, src)
  if (!full.length && !ghosts.length) return <div className={`${indent} pr-2 py-1.5 text-[11.5px] text-zinc-600`}>no sessions yet</div>
  const shown = all ? lst : lst.slice(0, INLINE_SESSIONS)
  return (
    <>
      {ghosts.map((d, i) => <DraftLine key={targetKey(d)} ctx={ctx} d={d} indent={indent} />)}
      {shown.map((s) => <SessionLine key={s.id} ctx={ctx} src={src} s={s} indent={indent} menuKey={`${keyPrefix}|${s.id}`} />)}
      {lst.length > INLINE_SESSIONS && (
        <button onClick={() => toggleKey(`${keyPrefix}|all`)} className={`${indent} pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300`}>
          {all ? 'show fewer' : `show all ${lst.length}`}
        </button>
      )}
      {hidden > 0 && (
        <div className={`${indent} pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1`} title="Pinned sessions are listed in the Pinned section above">
          <PinIcon className="w-3 h-3 text-amber-300/70" />
          {lst.length ? `${hidden} more pinned · see Pinned` : `${hidden === 1 ? 'its only session is' : `all ${hidden} sessions are`} pinned · see Pinned`}
        </div>
      )}
      {grouped > 0 && (
        <div className={`${indent} pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1`} title="Sessions in a workspace are listed under that workspace above">
          <LayersIcon className="w-3 h-3 text-sky-300/70" />
          {`${grouped} more in a workspace · see Workspaces`}
        </div>
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
  onManageFolders,
  onOpenTarget,
  onNewProject,
  onDeleteSession,
  onDeleteSessions,
  drafts = [],
  folderFocus,
}) {
  const [filter, setFilter] = useState('')
  const [openSlug, setOpenSlug] = useState(null) // expanded project in the folder list
  const [openKeys, setOpenKeys] = useState(() => new Set()) // expanded pinned projects
  const [folderExpanded, setFolderExpanded] = useState(() => new Set())
  const [openWs, setOpenWs] = useState(() => new Set()) // expanded workspaces
  const [wsFilter, setWsFilter] = useState({}) // workspace id -> Set(sourceKey)
  const [sections, setSections] = useState(loadSections)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerScope, setPickerScope] = useState(null)
  const [newScope, setNewScope] = useState(null)
  const pickerApi = useMemo(() => pickerScope ? createApi(pickerScope.provider) : null, [pickerScope?.provider])
  const [picking, setPicking] = useState(false)
  const [menuFor, setMenuFor] = useState(null) // key of the open ⋯ menu
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [confirmEl, confirm] = useConfirm()
  const [newWs, setNewWs] = useState(null) // '' while typing a new workspace name
  const [renaming, setRenaming] = useState(null) // { id, name }
  const batchEpoch = useRef(0)
  const allPins = usePins()
  const workspaces = useWorkspaces()
  const prefs = usePrefs()
  const pins = pinsForMode(allPins, prefs.sidebarMode)
  const folderPins = pins.filter(isFolderPin)
  const folderMode = prefs.sidebarMode === 'folder'
  const folderCatalog = useFolderCatalog(folderMode || workspaces.some((w) => w.items.some(isFolderItem)), index.projects)
  useEffect(() => {
    if (!folderFocus || !folderMode) return
    setFilter('')
    setSections((s) => ({ ...s, pinned: true, projects: true }))
  }, [folderFocus, folderMode])

  const provider = scope?.provider || null
  const root = scope?.root || null
  const api = useMemo(() => (provider ? createApi(provider) : null), [provider])
  const scopeInfo = index.scopes.find((s) => s.provider === provider && s.root === root)
  const rootLabel = scopeInfo?.rootLabel || ''

  const projects = useMemo(() => index.projects.filter((p) => p.provider === provider && p.root === root), [index.projects, provider, root])
  const sessions = openSlug && provider ? index.sessionsFor(provider, root, openSlug) : null
  const suggestions = useMemo(() => suggestWorkspaces(index.projects, workspaces, folderCatalog.folders), [index.projects, workspaces, folderCatalog.folders])
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

  // pinning moves a row into Pinned and grouping moves it into its workspace;
  // both moves are undone while searching or when that section is switched off
  const hidePinned = !filter && !!prefs.showPinned
  const hideGrouped = !filter && !!prefs.showWorkspaces
  const notPinned = (sessions || []).filter((s) => !hidePinned || !isPinned({ provider, root, slug: openSlug, id: s.id }))
  const hiddenPinned = (sessions || []).length - notPinned.length
  const list = notPinned.filter((s) => !hideGrouped || !workspaceHolding({ kind: 'session', provider, root, slug: openSlug, id: s.id }, workspaces))
  const hiddenGrouped = notPinned.length - list.length
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

  const newProjectFlow = async (chosenScope = scope) => {
    if (picking || !chosenScope?.provider) return
    const pickerApi = createApi(chosenScope.provider)
    setPickerScope(chosenScope)
    setPicking(true)
    try {
      const r = await pickerApi.pickFolder()
      if (r?.ok && r.path) onNewProject(chosenScope, r.path)
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
    return termKeys?.has(k) ? statusDot('terminal') : live?.ids?.has(k) ? statusDot('writing') : null
  }
  const isActive = (prov, r, id) => activeTarget?.provider === prov && activeTarget?.root === r && activeTarget?.id === id
  const isRecent = (s) => s.lastTs && Date.now() - new Date(s.lastTs).getTime() < RECENT_MS

  // a workspace as its member projects, each heading its own sessions (newest
  // first); a session member whose project is not itself a member gets a
  // "selected" group under that project's name. With many sessions this is
  // what makes "which project, which folder" readable at a glance — a flat
  // list with a source tag per row did not (the user said so, 2026-09-07).
  const wsGroups = (w) => {
    const members = standaloneWorkspaceItems(w, folderCatalog.folders)
    const groups = new Map()
    let loading = false
    let untracked = 0
    const tracked = (it) => index.scopes.some((x) => x.provider === it.provider && x.root === it.root)
    const groupFor = (it, partial) => {
      const k = projectKey(it)
      let g = groups.get(k)
      if (!g) {
        g = { key: k, src: srcL(it), item: it, partial, rows: [], seen: new Set() }
        groups.set(k, g)
      } else if (!partial) {
        g.partial = false
        g.item = it
      }
      return g
    }
    for (const it of members) {
      if (it.kind !== 'project') continue
      if (!tracked(it)) {
        untracked++
        continue
      }
      const g = groupFor(it, false)
      const lst = index.sessionsFor(it.provider, it.root, it.slug)
      if (lst === null) {
        loading = true
        continue
      }
      for (const s of lst) {
        if (g.seen.has(s.id)) continue
        g.seen.add(s.id)
        g.rows.push({ s, item: it })
      }
    }
    for (const it of members) {
      if (it.kind !== 'session') continue
      if (!tracked(it)) {
        untracked++
        continue
      }
      const g = groupFor(it, true)
      if (g.seen.has(it.id)) continue
      g.seen.add(it.id)
      const lst = index.sessionsFor(it.provider, it.root, it.slug)
      const fresh = lst?.find((x) => x.id === it.id)
      g.rows.push({ s: fresh || { id: it.id, title: it.title || it.id.slice(0, 8), lastTs: null, toolCalls: null }, item: it })
    }
    const byTime = (a, b) => String(b.s.lastTs || '').localeCompare(String(a.s.lastTs || ''))
    const out = [...groups.values()]
    for (const g of out) {
      g.rows.sort(byTime)
      g.latest = g.rows[0]?.s.lastTs || ''
    }
    out.sort((a, b) => String(b.latest).localeCompare(String(a.latest)))
    return { groups: out, loading, untracked }
  }

  // labels come from the live folder list, never from what was stored when a
  // pin / workspace item was created — a relabelled folder updates everywhere
  const labelOf = (prov, r, fallback = '') => index.scopes.find((x) => x.provider === prov && x.root === r)?.rootLabel || fallback
  const srcL = (p) => {
    const src = srcOf(p)
    return { ...src, rootLabel: labelOf(src.provider, src.root, src.rootLabel) }
  }

  // The ⋯ menu of every project row (Projects, Pinned, a workspace's groups):
  // "New conversation here", and — when another folder or provider is tracked —
  // "New conversation here with…", the same folder opened by another account
  // or CLI. Every scope but this one is listed (a second Claude account counts:
  // switching accounts is half the point); one that already has a project for
  // the folder shows its session count and reuses it, one that has none is
  // tagged "new here" and starts from the path alone (the server accepts a
  // cwd without a slug). The user asked for exactly this (2026-09-08): no
  // switching the folder chip, no folder picker, no workspace needed first.
  const draftTarget = (t) => ({ ...t, draft: true, title: 'New conversation', newConversation: true })
  const newConversationItems = (src) => {
    const items = [{ label: 'New conversation here', onClick: () => onOpenTarget(draftTarget({ provider: src.provider, root: src.root, rootLabel: src.rootLabel, slug: src.slug, cwd: src.cwd, project: src.project })) }]
    if (!src.cwd) return items
    const others = index.scopes.filter((x) => !(x.provider === src.provider && x.root === src.root))
    if (!others.length) return items
    const cwdKey = normCwd(src.cwd)
    const canonicalFolder = folderMode ? folderCatalog.folders.find((f) => f.sources.some((s) => s.provider === src.provider && s.root === src.root && s.slug === src.slug)) : null
    const children = others.map((x) => {
      const canonicalSource = canonicalFolder?.sources.find((s) => s.provider === x.provider && s.root === x.root)
      const existing = index.projects.find((p) => p.provider === x.provider && p.root === x.root && (folderMode
        ? (canonicalSource ? p.slug === canonicalSource.slug : p.cwd === src.cwd)
        : p.cwd && normCwd(p.cwd) === cwdKey))
      const n = existing?.sessionCount || 0
      return {
        key: sourceKey(x),
        label: providerLabel(providers, x.provider),
        sub: x.rootLabel,
        dot: providerColor(providers, x.provider).dot,
        tag: existing ? `${n} session${n === 1 ? '' : 's'}` : 'new here',
        title: existing ? `${src.cwd}\nalready a project in ${providerLabel(providers, x.provider)} · ${x.rootLabel} — the conversation joins it` : `${src.cwd}\nnot opened with ${providerLabel(providers, x.provider)} · ${x.rootLabel} yet — the project appears once the first conversation is written`,
        onClick: () => {
          const t = { provider: x.provider, root: x.root, rootLabel: x.rootLabel, cwd: src.cwd, project: existing?.name || src.project }
          if (existing) t.slug = existing.slug
          else rememberAdoption(src, x, src.cwd)
          onOpenTarget(draftTarget(t))
        },
      }
    })
    items.push({ label: 'New conversation here with…', children })
    return items
  }
  // a workspace waiting for a project started this way adopts it once the index lists it
  useEffect(() => adoptPendingProjects(index.projects), [index.projects])

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
      detail: 'Its folders, projects, sessions and running terminals stay where they are.',
      confirmLabel: 'Delete workspace',
    })
    if (ok) deleteWorkspace(w.id)
  }

  const projectHidden = (src) => (hidePinned && isPinned(src)) || (hideGrouped && !!workspaceHolding(projectItem(src), workspaces))
  const onFolderWorkspaceChange = (id, added) => {
    if (!added) return
    setFilter('')
    setSections((s) => ({ ...s, workspaces: true }))
    setOpenWs((s) => new Set(s).add(id))
  }
  const ctx = { providers, index, dotFor, isActive, isRecent, selected, toggleSelected, onOpenTarget, onDeleteSession, askTrash, menuFor, setMenuFor, workspaces, openKeys, toggleKey, hidePinned, hideGrouped, drafts, activeTarget, newConversationItems, projectHidden, folderPins, folderFocus, folderExpanded, setFolderExpanded, onFolderWorkspaceChange }
  const renderFolderProjects = (section, workspace) => {
    const treeCtx = { ...ctx, folderSession: true, ...(workspace ? { hidePinned: false, hideGrouped: false, projectHidden: () => false } : {}) }
    const sourceFilter = workspace && wsFilter[workspace.id]
    const excludedRoots = [...(folderMode ? prefs.folderExcludedRoots || [] : []), ...(sourceFilter?.size ? index.scopes.filter((s) => !sourceFilter.has(sourceKey(s))).map((s) => JSON.stringify([s.provider, s.root])) : [])]
    return <FolderProjects section={section} workspace={workspace} catalog={folderCatalog} ctx={treeCtx} filter={filter} excludedProviders={folderMode ? prefs.folderExcludedProviders : []} excludedRoots={excludedRoots} showUnavailable={prefs.showUnavailableFolders}
    renderProjectActions={(src, key, launchable) => <ProjectActions ctx={ctx} src={src} menuKey={`folder-project|${workspace?.id || section}|${key}`} bounded items={newConversationItems(src).map((item) => launchable ? item : { label: item.label, disabled: true })} />}
    renderSessions={(src, key, indent) => <ProjectSessions ctx={treeCtx} src={src} indent={indent} keyPrefix={`folder|${workspace?.id || section}|${key}`} />}
    renderDrafts={(src, indent) => draftsOf(drafts, src).map((d) => <DraftLine key={targetKey(d)} ctx={ctx} d={d} indent={indent} />)} />
  }

  const filtered = projects.filter((p) => {
    if (hidePinned && isPinned({ provider, root, slug: p.slug })) return false
    if (hideGrouped && workspaceHolding({ kind: 'project', provider, root, slug: p.slug }, workspaces, folderCatalog.folders)) return false
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug} ${p.name}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })
  const pinnedProjects = pins.filter((p) => !isFolderPin(p) && !p.id)
  const pinnedSessions = pins.filter((p) => p.id)

  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800 space-y-2.5">
        {folderMode ? <ProviderFilterChips scopes={index.scopes} providers={providers} excluded={prefs.folderExcludedProviders} excludedRoots={prefs.folderExcludedRoots}
          onToggle={(provider, root) => setFolderFilter(toggleHomeFilter({ excluded: prefs.folderExcludedProviders, excludedRoots: prefs.folderExcludedRoots }, index.scopes, provider, root))}
          onReset={() => setFolderFilter({})} onManage={onManageFolders} /> : <FolderChips scopes={index.scopes} providers={providers} value={scope} onPick={onScope} onManage={onManageFolders} />}
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={folderMode ? 'Filter folders…' : 'Filter projects…'} className="w-full bg-ink-700 border border-zinc-700 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 outline-none" />
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
                  const sources = workspaceSources(w, folderCatalog.folders).map((x) => ({ ...x, rootLabel: labelOf(x.provider, x.root, x.rootLabel) }))
                  const hasFolders = w.items.some(isFolderItem)
                  const filt = wsFilter[w.id]
                  const { groups, loading, untracked } = open ? wsGroups(w) : { groups: [], loading: false, untracked: 0 }
                  const visible = filt?.size ? groups.filter((g) => filt.has(sourceKey(g.src))) : groups
                  const mk = `ws|${w.id}`
                  return (
                    <div key={w.id}>
                      <div className={`group relative flex items-stretch hover:bg-ink-700/50 ${open ? 'bg-ink-700/30' : ''}`}>
                        <button onClick={() => toggleWs(w.id)} className="flex-1 min-w-0 text-left pl-2 pr-1 py-1.5 flex items-center gap-1.5">
                          <ChevronRightIcon className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                          {/* the colour tints the glyph only — the name stays as readable as any other row */}
                          <span className="shrink-0 inline-flex" style={w.color ? accentStyle(w.color).style : undefined}>
                            <WorkspaceIcon icon={w.icon} className={`w-3.5 h-3.5 ${w.color ? 'accent-text' : 'text-sky-300/80'}`} />
                          </span>
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
                          icon={{ value: w.icon, onPick: (i) => setWorkspaceIcon(w.id, i), accentStyle: w.color ? accentStyle(w.color).style : null }}
                          accent={{ value: w.color, onChange: (c) => setWorkspaceColor(w.id, c), onReset: w.color ? () => setWorkspaceColor(w.id, null) : null, resetLabel: 'clear' }}
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
                          {hasFolders && renderFolderProjects('workspace', w)}
                          {visible.map((g) => {
                            const gk = `${mk}|${g.key}`
                            const gopen = !openKeys.has(`${gk}|closed`) // groups start open
                            const all = openKeys.has(`${gk}|all`)
                            const shownRows = all ? g.rows : g.rows.slice(0, WS_GROUP_SESSIONS)
                            const c = providerColor(providers, g.src.provider)
                            return (
                              <div key={g.key}>
                                <div className="group relative flex items-stretch hover:bg-ink-700/40">
                                  <button
                                    onClick={() => toggleKey(`${gk}|closed`)}
                                    title={`${g.src.cwd || g.src.slug}\n${providerLabel(providers, g.src.provider)} · ${g.src.rootLabel}${g.partial ? '\nonly the sessions you added, not the whole project' : ''}`}
                                    className="flex-1 min-w-0 text-left pl-6 pr-1 py-1 flex items-center gap-1.5"
                                  >
                                    <ChevronRightIcon className={`w-3 h-3 text-zinc-600 shrink-0 transition-transform ${gopen ? 'rotate-90' : ''}`} />
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                                    <span className="text-[12px] font-medium text-zinc-300 truncate">{g.src.project}</span>
                                    <span className={`text-[10.5px] truncate ${c.text}`}>{g.src.rootLabel}</span>
                                    {g.partial && <span className="text-[10px] text-zinc-600 shrink-0">selected</span>}
                                    <span className="ml-auto text-[10.5px] text-zinc-600 shrink-0">{g.rows.length}</span>
                                  </button>
                                  {!g.partial && (
                                    <div className="flex items-center gap-0.5 pr-1.5">
                                      <button onClick={() => setMenuFor(menuFor === gk ? null : gk)} title="More" className={`${hoverBtn} ${menuFor === gk ? 'opacity-100 text-zinc-100 bg-ink-600' : ''}`}>
                                        <DotsIcon className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                  {!g.partial && <RowMenu open={menuFor === gk} onClose={() => setMenuFor(null)} items={[...newConversationItems(g.src), { label: `Remove ${g.src.project} (${g.src.rootLabel}) from workspace`, onClick: () => removeItem(w.id, g.item) }]} />}
                                </div>
                                {gopen &&
                                  shownRows.map((r) => (
                                    <SessionLine
                                      ctx={ctx}
                                      key={`${g.src.provider}|${g.src.root}|${r.s.id}`}
                                      src={g.src}
                                      s={r.s}
                                      indent="pl-9"
                                      menuKey={`${gk}|${r.s.id}`}
                                      extraItems={r.item.kind === 'session' ? [{ label: 'Remove from workspace', onClick: () => removeItem(w.id, r.item) }] : []}
                                    />
                                  ))}
                                {gopen && !g.rows.length && <div className="pl-9 pr-2 py-1 text-[11px] text-zinc-600">no sessions yet</div>}
                                {gopen && g.rows.length > WS_GROUP_SESSIONS && (
                                  <button onClick={() => toggleKey(`${gk}|all`)} className="pl-9 pr-2 py-1 text-[11px] text-sky-400 hover:text-sky-300">
                                    {all ? 'show fewer' : `show all ${g.rows.length}`}
                                  </button>
                                )}
                              </div>
                            )
                          })}
                          {loading && <div className="pl-7 pr-2 py-1.5 text-[11.5px] text-zinc-600">loading…</div>}
                          {untracked > 0 && <div className="pl-7 pr-2 py-1 text-[11px] text-zinc-600">{untracked} member{untracked === 1 ? '' : 's'} in a folder that is no longer tracked — hidden</div>}
                          {!loading && !groups.length && !hasFolders && <div className="pl-7 pr-2 py-1.5 text-[11.5px] text-zinc-600">Empty — open ⋯ on a folder, project or session and tick this workspace.</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!workspaces.length && newWs == null && !(!folderMode && prefs.showSuggestions && suggestions.length) && (
                  <div className="px-3 pb-1.5 text-[11.5px] text-zinc-600">Group folders, projects and sessions from any provider under one name — ⋯ on a row → Workspaces.</div>
                )}
                {!folderMode && prefs.showSuggestions && suggestions.length > 0 && (
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
                {folderMode && folderPins.length > 0 && renderFolderProjects('pinned')}
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
        {folderMode ? <div className="pb-2">
          <SectionHeader title="Folders" open={sections.projects || !!filter} onToggle={() => toggleSection('projects')}
            right={<button disabled={picking || !index.scopes.some((s) => s.exists !== false)} onClick={() => setNewScope(index.scopes.find((s) => s.provider === scope?.provider && s.root === scope?.root && s.exists !== false) || index.scopes.find((s) => s.exists !== false))} title="New folder: choose AI and working folder" className={`${iconBtn} text-zinc-500 hover:text-zinc-200`}><PlusIcon className="w-3.5 h-3.5" /></button>} />
          {(sections.projects || !!filter) && renderFolderProjects('folders')}
        </div> :
        <div className="pb-2">
          <SectionHeader
            title="Projects"
            count={filtered.length}
            open={sections.projects || !!filter}
            onToggle={() => toggleSection('projects')}
            right={
              <button onClick={() => newProjectFlow()} disabled={picking || !api} title={picking ? 'Choosing a folder…' : 'New project: pick a folder and start a conversation in it'} className={`${iconBtn} text-zinc-500 hover:text-zinc-100 hover:bg-ink-600 disabled:opacity-60`}>
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            }
          />
          {(sections.projects || !!filter) &&
            drafts
              .filter((d) => d.provider === provider && d.root === root && !projects.some((p) => (d.slug && d.slug === p.slug) || (d.cwd && d.cwd === p.cwd)))
              .map((d, i) => (
                <div key={`draft-proj-${i}`} className="border-b border-zinc-800/60">
                  <div className="flex items-center gap-1.5 pl-3 pr-2 sb-row-lg" title={`${d.cwd || d.slug} — a new project: it is listed for real once its first conversation is written`}>
                    <span className="text-zinc-600 text-xs w-3 shrink-0">▾</span>
                    <FolderIcon className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    <span className="text-[13px] font-medium text-zinc-400 italic truncate flex-1">{shortPath(d.cwd || d.slug)}</span>
                    <span className="text-[10.5px] text-zinc-600 shrink-0">new</span>
                  </div>
                  <DraftLine ctx={ctx} d={d} />
                </div>
              ))}
          {(sections.projects || !!filter) &&
            filtered.map((p) => {
              const isOpen = p.slug === openSlug
              const src = srcL({ ...p, provider, root, rootLabel })
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
                    <ProjectActions ctx={ctx} src={src} menuKey={mk}
                      items={[
                        ...newConversationItems(src),
                        onDeleteSessions && { label: 'Select sessions to trash…', disabled: !p.sessionCount, onClick: () => { setOpenSlug(p.slug); setSelectMode(true) } },
                      ].filter(Boolean)}
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
                      {draftsOf(drafts, src).map((d, i) => <DraftLine key={targetKey(d)} ctx={ctx} d={d} />)}
                      {sessions === null && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                      {sessions && sessions.length === 0 && !draftsOf(drafts, src).length && <div className="px-7 py-2 text-[12px] text-zinc-600">no sessions yet</div>}
                      {list.map((s) => <SessionLine ctx={ctx} key={s.id} src={src} s={s} menuKey={`${mk}|${s.id}`} selectable={selectMode} />)}
                      {hiddenPinned > 0 && (
                        <div className="pl-7 pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1" title="Pinned sessions are listed in the Pinned section above">
                          <PinIcon className="w-3 h-3 text-amber-300/70" />
                          {list.length ? `${hiddenPinned} more pinned · see Pinned` : `${hiddenPinned === 1 ? 'its only session is' : `all ${hiddenPinned} sessions are`} pinned · see Pinned`}
                        </div>
                      )}
                      {hiddenGrouped > 0 && (
                        <div className="pl-7 pr-2 py-1 text-[11px] text-zinc-600 flex items-center gap-1" title="Sessions in a workspace are listed under that workspace above">
                          <LayersIcon className="w-3 h-3 text-sky-300/70" />
                          {`${hiddenGrouped} more in a workspace · see Workspaces`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          {(sections.projects || !!filter) && filtered.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-zinc-600">{!scope ? 'No tracked folders yet — press + above to track one.' : index.loading && !projects.length ? 'Loading projects…' : 'No projects.'}</div>
          )}
        </div>}
      </div>

      {confirmEl}
      {newScope && <NewFolderDialog scope={newScope} scopes={index.scopes} providers={providers} onChange={setNewScope} onClose={() => setNewScope(null)} onChoose={() => { const chosen = newScope; setNewScope(null); newProjectFlow(chosen) }} />}
      {pickerOpen && pickerScope && (
        <PathPicker
          apiClient={pickerApi}
          onPick={(p) => {
            setPickerOpen(false)
            onNewProject(pickerScope, p)
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

function NewFolderDialog({ scope, scopes, providers, onChange, onClose, onChoose }) {
  useEscToClose(onClose)
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="New folder conversation" className="w-96 max-w-full rounded-xl bg-ink-800 border border-zinc-700 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
      <h2 className="text-sm text-zinc-200">New folder conversation</h2>
      <label className="block text-xs text-zinc-400">Receiving AI / root<select aria-label="Receiving AI / root" className="block w-full mt-2 bg-ink-900 border border-zinc-700 rounded p-2" value={JSON.stringify([scope.provider, scope.root])} onChange={(e) => { const [p, r] = JSON.parse(e.target.value); onChange(scopes.find((s) => s.provider === p && s.root === r)) }}>
        {scopes.filter((s) => s.exists !== false).map((s) => <option key={JSON.stringify([s.provider, s.root])} value={JSON.stringify([s.provider, s.root])}>{providerLabel(providers, s.provider)} · {s.rootLabel}</option>)}
      </select></label>
      <div className="flex gap-3 text-xs"><button className="text-sky-300" onClick={onChoose}>Choose working folder…</button><button className="text-zinc-400" onClick={onClose}>Cancel</button></div>
    </div>
  </div>
}
