import type { Dispatch, SetStateAction, ReactNode } from 'react'
import type { Target } from '../../../../shared/types.d.ts'
import type { Workspace } from '../../../lib/workspaces.ts'
import type { Scope } from '../../../lib/useShellNavigation.ts'
import type { UIProvider } from '../../../providers/views.ts'
import type { SidebarRowsContext, SidebarSession } from './rows.tsx'
type Navigation = ReturnType<typeof useShellNavigation>
export interface SidebarProps {
  providers: readonly UIProvider[]
  index?: Navigation['index']
  live?: Navigation['live']
  termKeys?: Set<string>
  scope?: Scope | null
  onScope?: typeof shellActions.onScope
  activeTarget?: Target | null
  onManageFolders?: () => void
  onOpenTarget?: typeof shellActions.openTarget
  onNewProject?: Navigation['newProject']
  onDeleteSession?: Navigation['deleteSession']
  onDeleteSessions?: Navigation['deleteSessions']
  drafts?: Target[]
  folderFocus?: { folderId: string } | null
}
export type SidebarModel = ReturnType<typeof useSidebar>
import { useShellNavigation } from '../../../lib/useShellNavigation.ts'
import { useState, useMemo, useRef, useEffect } from 'react'
import { createApi } from '../../../api/index.ts'
import useConfirm from '../../../lib/useConfirm.tsx'
import { usePins, pinsForMode, isFolderPin, isPinned, type Pin } from '../../../lib/pins.ts'
import {
  useWorkspaces,
  isFolderItem,
  suggestWorkspaces,
  workspaceHolding,
  adoptPendingProjects,
  deleteWorkspace,
  sourceKey,
  type WorkspaceItem,
} from '../../../lib/workspaces.ts'
import { usePrefs } from '../../../lib/prefs.ts'
import useFolderCatalog from '../../../lib/useFolderCatalog.ts'
import { liveSessionKey } from '../../../../shared/identity.ts'
import { statusDot, providerLabel } from '../../../lib/providerColors.ts'
import { RECENT_MS, srcOf, projectItem, ProjectActions, ProjectSessions, draftsOf, DraftLine } from './rows.tsx'
import { homeSourceKey, sidebarFolderKey } from '../../../../shared/identity.ts'
import FolderProjects from '../FolderProjects.tsx'
import { targetKey } from '../../../lib/tabs.ts'
import { workspaceNames, workspaceGroups, conversationActions } from './sidebarModel.ts'
import { useShell, shellActions, loadSidebarSections, saveSidebarSections } from '../../../store/index.ts'

export default function useSidebar({
  providers,
  index: suppliedIndex,
  live: suppliedLive,
  termKeys: suppliedTermKeys,
  scope: suppliedScope,
  onScope = shellActions.onScope,
  activeTarget: suppliedTarget,
  onManageFolders = () => shellActions.setFoldersOpen(true),
  onOpenTarget = shellActions.openTarget,
  onNewProject: suppliedOnNewProject,
  onDeleteSession: suppliedOnDeleteSession,
  onDeleteSessions: suppliedOnDeleteSessions,
  drafts: suppliedDrafts,
  folderFocus: suppliedFocus,
}: SidebarProps) {
  const connected = useShellNavigation(providers, { enabled: suppliedIndex === undefined })
  const index = suppliedIndex === undefined ? connected.index : suppliedIndex
  const live = suppliedLive === undefined ? connected.live : suppliedLive
  const termKeys = suppliedTermKeys === undefined ? connected.termKeys : suppliedTermKeys
  const scope = suppliedScope === undefined ? connected.scope : suppliedScope
  const onNewProject = suppliedOnNewProject === undefined ? connected.newProject : suppliedOnNewProject
  const onDeleteSession = suppliedOnDeleteSession === undefined ? connected.deleteSession : suppliedOnDeleteSession
  const onDeleteSessions = suppliedOnDeleteSessions === undefined ? connected.deleteSessions : suppliedOnDeleteSessions
  const drafts = suppliedDrafts === undefined ? connected.drafts : suppliedDrafts
  const storedTarget = useShell(({ state }) => state.tabs.find((tab) => tab.key === state.activeKey)?.target || null)
  const storedFocus = useShell((state) => state.folderFocus)
  const activeTarget = suppliedTarget === undefined ? storedTarget : suppliedTarget
  const folderFocus = suppliedFocus === undefined ? storedFocus : suppliedFocus
  const [filter, setFilter] = useState('')
  const [openSlug, setOpenSlug] = useState<string | null>(null) // expanded project in the folder list
  const [openKeys, setOpenKeys] = useState(() => new Set<string>()) // expanded pinned projects
  const [folderExpanded, setFolderExpanded] = useState(() => new Set<string>())
  const [openWs, setOpenWs] = useState(() => new Set<string>()) // expanded workspaces
  const [wsFilter, setWsFilter] = useState<Record<string, Set<string>>>({}) // workspace id -> Set(sourceKey)
  const [sections, setSections] = useState(loadSidebarSections)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerScope, setPickerScope] = useState<Scope | null>(null)
  const [newScope, setNewScope] = useState<Scope | null>(null)
  const pickerProvider = pickerScope?.provider
  const pickerApi = useMemo(() => (pickerProvider ? createApi(pickerProvider) : null), [pickerProvider])
  const [picking, setPicking] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null) // key of the open ⋯ menu
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set<string>())
  const [batchBusy, setBatchBusy] = useState(false)
  const [confirmEl, confirm] = useConfirm()
  const [newWs, setNewWs] = useState<string | null>(null) // '' while typing a new workspace name
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null) // { id, name }
  const batchEpoch = useRef(0)
  const allPins = usePins()
  const workspaces = useWorkspaces()
  const prefs = usePrefs()
  const pins = pinsForMode(allPins, prefs.sidebarMode)
  const folderPins = pins.filter(isFolderPin)
  const folderMode = prefs.sidebarMode === 'folder'
  const folderCatalog = useFolderCatalog(folderMode || workspaces.some((w) => w.items.some(isFolderItem)))
  useEffect(() => {
    if (!folderFocus || !folderMode) return
    setFilter('')
    setSections((s) => ({ ...s, pinned: true, projects: true }))
  }, [folderFocus, folderMode])

  const provider = scope?.provider || null
  const root = scope?.root || null
  const api = useMemo(() => (provider ? createApi(provider) : null), [provider])

  const projects = useMemo(() => index.projects.filter((p) => p.provider === provider && p.root === root), [index.projects, provider, root])
  const sessions = openSlug && provider ? index.sessionsFor(provider, root || '', openSlug) : null
  const suggestions = useMemo(() => suggestWorkspaces(index.projects, workspaces, folderCatalog.folders), [index.projects, workspaces, folderCatalog.folders])
  // two workspaces called "AgentDeck" (…/project/AgentDeck vs …/maintain/AgentDeck) → show the parent folder too
  const wsName = useMemo(() => workspaceNames({ workspaces }), [workspaces])

  useEffect(() => saveSidebarSections(sections), [sections])
  const toggleSection = (k: keyof typeof sections) => setSections((s) => ({ ...s, [k]: !s[k] }))
  const toggleIn = (setter: Dispatch<SetStateAction<Set<string>>>) => (k: string) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const toggleKey = toggleIn(setOpenKeys)
  const toggleWs = toggleIn(setOpenWs)
  const toggleWsSource = (wid: string, sk: string) =>
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

  // Selections belong to one exact project, even if its rows look identical.
  const selectionScope = useRef({ provider, root, openSlug })
  useEffect(() => {
    const previous = selectionScope.current
    if (previous.provider === provider && previous.root === root && previous.openSlug === openSlug) return
    selectionScope.current = { provider, root, openSlug }
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

  const toggleSelected = (id: string) =>
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
    if (batchBusy || !scope || !openSlug) return
    const picked = list.filter((s) => selected.has(s.id))
    if (!picked.length) return
    const activeN = picked.filter((s) => dotFor(provider, root, s.id) || isRecent(s)).length
    const ok = await confirm({
      title: `Move ${picked.length} session${picked.length === 1 ? '' : 's'} to the trash?`,
      message: activeN
        ? `${activeN} of them ${activeN === 1 ? 'is' : 'are'} active right now — a transcript still being written ends up truncated.`
        : 'They go to the OS trash and can be restored from there.',
      detail:
        picked
          .slice(0, 4)
          .map((s) => s.title)
          .join(' · ') + (picked.length > 4 ? ` · +${picked.length - 4} more` : ''),
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
  const dotFor = (prov: string | null | undefined, r: string | null | undefined, id: string) => {
    const k = liveSessionKey(prov || '', r || '', id)
    return termKeys?.has(k) ? statusDot('terminal') : live?.ids?.has(k) ? statusDot('writing') : null
  }
  const isActive = (prov: string | null | undefined, r: string | null | undefined, id: string) =>
    activeTarget?.provider === prov && activeTarget?.root === r && activeTarget?.id === id
  const isRecent = (s: SidebarSession) => !!s.lastTs && Date.now() - new Date(s.lastTs).getTime() < RECENT_MS

  // a workspace as its member projects, each heading its own sessions (newest
  // first); a session member whose project is not itself a member gets a
  // "selected" group under that project's name. With many sessions this is
  // what makes "which project, which folder" readable at a glance — a flat
  // list with a source tag per row did not (the user said so, 2026-09-07).
  const wsGroups = (w: Workspace) => workspaceGroups(w, { folderCatalog, index, srcL })

  // labels come from the live folder list, never from what was stored when a
  // pin / workspace item was created — a relabelled folder updates everywhere
  const labelOf = (prov: string | null | undefined, r: string | null | undefined, fallback = '') =>
    index.scopes.find((x) => x.provider === prov && x.root === r)?.rootLabel || fallback
  const srcL = (p: WorkspaceItem) => {
    const src = srcOf(p)
    return { ...src, rootLabel: labelOf(src.provider, src.root, src.rootLabel) }
  }

  // Each project menu can start a conversation with any tracked account.
  const draftTarget = (t: Target) => ({ ...t, draft: true, title: 'New conversation', newConversation: true })
  const newConversationItems = (src: WorkspaceItem) => conversationActions(src, { onOpenTarget, draftTarget, index, folderMode, folderCatalog, providers })
  // a workspace waiting for a project started this way adopts it once the index lists it
  useEffect(() => adoptPendingProjects(index.projects), [index.projects])

  const askTrash = async (src: WorkspaceItem, s: SidebarSession, active: boolean) => {
    const ok = await confirm({
      title: 'Move this session to the trash?',
      message: s.title,
      detail: `${providerLabel(providers, src.provider)} · ${src.project} · ${src.rootLabel}${active ? ' — active right now: a transcript still being written ends up truncated.' : ''}`,
      confirmLabel: 'Move to trash',
    })
    if (ok && src.provider && src.root && src.slug) onDeleteSession?.({ provider: src.provider, root: src.root }, src.slug, s)
  }
  const askDeleteWorkspace = async (w: Workspace) => {
    const ok = await confirm({
      title: `Delete workspace “${w.name}”?`,
      message: 'Only the grouping goes away.',
      detail: 'Its folders, projects, sessions and running terminals stay where they are.',
      confirmLabel: 'Delete workspace',
    })
    if (ok) deleteWorkspace(w.id)
  }

  const projectHidden = (src: Pin) => (hidePinned && isPinned(src)) || (hideGrouped && !!workspaceHolding(projectItem(src), workspaces))
  const onFolderWorkspaceChange = (id: string, added: boolean) => {
    if (!added) return
    setFilter('')
    setSections((s) => ({ ...s, workspaces: true }))
    setOpenWs((s) => new Set(s).add(id))
  }
  const ctx: SidebarRowsContext = {
    providers,
    index,
    dotFor,
    isActive,
    isRecent,
    selected,
    toggleSelected,
    onOpenTarget,
    onDeleteSession,
    askTrash,
    menuFor,
    setMenuFor,
    workspaces,
    openKeys,
    toggleKey,
    hidePinned,
    hideGrouped,
    drafts,
    activeTarget,
    newConversationItems,
    projectHidden,
    folderPins,
    folderFocus,
    folderExpanded,
    setFolderExpanded,
    onFolderWorkspaceChange,
  }
  const renderFolderProjects = (section = 'folders', workspace?: Workspace): ReactNode => {
    const treeCtx = { ...ctx, folderSession: true, ...(workspace ? { hidePinned: false, hideGrouped: false, projectHidden: () => false } : {}) }
    const sourceFilter = workspace && wsFilter[workspace.id]
    const excludedRoots = [
      ...(folderMode ? prefs.folderExcludedRoots || [] : []),
      ...(sourceFilter?.size
        ? index.scopes.filter((s: WorkspaceItem) => !sourceFilter.has(sourceKey(s))).map((s: { provider: string; root: string }) => homeSourceKey(s))
        : []),
    ]
    return (
      <FolderProjects
        section={section}
        workspace={workspace}
        catalog={folderCatalog}
        ctx={treeCtx}
        filter={filter}
        excludedProviders={folderMode ? prefs.folderExcludedProviders : []}
        excludedRoots={excludedRoots}
        showUnavailable={prefs.showUnavailableFolders}
        renderProjectActions={(src, key, launchable) => (
          <ProjectActions
            ctx={ctx}
            src={src}
            menuKey={sidebarFolderKey('folder-project', workspace?.id || section, key)}
            bounded
            items={newConversationItems(src).map((item) => (launchable ? item : { label: item.label, disabled: true }))}
          />
        )}
        renderSessions={(src: WorkspaceItem, key: string, indent?: string) => (
          <ProjectSessions ctx={treeCtx} src={src} indent={indent} keyPrefix={sidebarFolderKey('folder', workspace?.id || section, key)} />
        )}
        renderDrafts={(src, indent) => draftsOf(drafts, src).map((d) => <DraftLine key={targetKey(d)} ctx={ctx} d={d} indent={indent} />)}
      />
    )
  }

  const filtered = projects.filter((p) => {
    if (hidePinned && isPinned({ provider, root, slug: p.slug })) return false
    if (hideGrouped && workspaceHolding({ kind: 'project', provider, root, slug: p.slug }, workspaces, folderCatalog.folders)) return false
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug} ${p.name}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })
  const pinnedProjects = pins.filter((p) => !isFolderPin(p) && !p.id)
  const pinnedSessions = pins.filter((p): p is Pin & { id: string } => !!p.id)

  return {
    providers,
    index,
    scope,
    onScope,
    onManageFolders,
    onNewProject,
    onDeleteSessions,
    drafts,
    filter,
    setFilter,
    openSlug,
    setOpenSlug,
    openKeys,
    openWs,
    setOpenWs,
    wsFilter,
    sections,
    setSections,
    pickerOpen,
    setPickerOpen,
    pickerScope,
    newScope,
    setNewScope,
    pickerApi,
    picking,
    menuFor,
    setMenuFor,
    selectMode,
    setSelectMode,
    setSelected,
    batchBusy,
    confirmEl,
    newWs,
    setNewWs,
    renaming,
    setRenaming,
    workspaces,
    prefs,
    pins,
    folderPins,
    folderMode,
    folderCatalog,
    provider,
    root,
    api,
    projects,
    sessions,
    suggestions,
    wsName,
    toggleSection,
    toggleKey,
    toggleWs,
    toggleWsSource,
    hiddenPinned,
    list,
    hiddenGrouped,
    selCount,
    exitSelectMode,
    askBatchDelete,
    newProjectFlow,
    wsGroups,
    labelOf,
    srcL,
    newConversationItems,
    askDeleteWorkspace,
    ctx,
    renderFolderProjects,
    filtered,
    pinnedProjects,
    pinnedSessions,
  }
}
