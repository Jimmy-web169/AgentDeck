import { createStore } from 'zustand/vanilla'
import { createTabActions, type Tab, type TabState } from './shellTabs.ts'
import { useStore } from 'zustand'
import type { Target, TerminalEntry } from '../../shared/types.js'
import { terminalEntryKey } from '../../shared/identity.ts'
import { PROVIDER_METADATA } from '../providers/metadata.ts'
import {
  openTabState,
  adoptTerminalsFor,
  adoptTerminal,
  dedupeTabs,
  newDraft,
  liveTarget,
  emptyTab,
  forgetRecent,
  isHome,
  loadRecent,
  loadTabs,
  normalizeView,
  pushRecent,
  sameTarget,
  saveTabs,
  targetKey,
  isDeckTarget,
} from '../lib/tabs.ts'
import { forgetPins } from '../lib/pins.ts'
import { currentHash, fromHash, toHash } from '../lib/route.ts'

interface Scope {
  provider: string
  root: string
}
interface OpenOptions {
  newTab?: boolean
}
interface HandoffRequest {
  mode: 'send' | 'export'
  source: Target
}
interface ShellData {
  state: TabState
  pendingOpen: (Target & { seq: number }) | null
  terminalEnds: Record<string, number>
  closedRunning: Target[] | null
  searchOpen: boolean
  showLive: boolean
  foldersOpen: boolean
  handoffRequest: HandoffRequest | null
  recent: Target[]
  sticky: Scope | null
  collapsed: boolean
  folderFocus: { folderId: string } | null
  sidebarW: number
  searchNewTab: boolean
}
interface Services {
  readTerminals: () => TerminalEntry[]
  updateTerminal: (entry: Partial<TerminalEntry> & { key: string }, remove: boolean) => void
}
const HOME: Target = { provider: null, view: 'activity' }
const SCOPE_KEY = 'agentdeck_scope'
const identity = targetKey
function initialState(providerIds: readonly string[]): TabState {
  const saved = loadTabs()
  let tabs = saved?.tabs || []
  let activeKey = saved?.activeKey || null
  if (!tabs.length) {
    tabs = [emptyTab({ ...HOME })]
    activeKey = tabs[0].key
  }
  // a deep link opens (or focuses) its own tab
  const linked = fromHash(currentHash(), [...providerIds])
  if (linked) {
    const target = linked.provider || isDeckTarget(linked) ? linked : { ...HOME, ...linked, view: normalizeView(linked.view) }
    const existing = !isHome(target)
      ? tabs.find((t) => sameTarget(t.target, target))
      : tabs.find((t) => isHome(t.target) && normalizeView(t.target?.view) === target.view && toHash(t.target) === toHash(target))
    if (existing) activeKey = existing.key
    else {
      const t = emptyTab(target)
      tabs = [...tabs, t]
      activeKey = t.key
    }
  }
  return { tabs, activeKey }
}

const loadJson = <T>(k: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback
  } catch {
    return fallback
  }
}
const saveJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {}
}

function initialData(providerIds: readonly string[]): ShellData {
  const width = loadJson('agentdeck_sidebarW', 300)
  return {
    state: initialState(providerIds),
    pendingOpen: null,
    terminalEnds: {},
    closedRunning: null,
    searchOpen: false,
    showLive: false,
    foldersOpen: false,
    handoffRequest: null,
    recent: loadRecent(),
    sticky: loadJson<Scope | null>(SCOPE_KEY, null),
    collapsed: loadJson<number>('agentdeck_collapsed', 0) === 1,
    folderFocus: null,
    sidebarW: width >= 240 && width <= 600 ? width : 300,
    searchNewTab: false,
  }
}
export function createShellStore(providerIds: readonly string[] = Object.keys(PROVIDER_METADATA)) {
  const store = createStore<ShellData>(() => initialData(providerIds))
  const get = store.getState,
    set = store.setState
  let sequence = 0
  let services: Services = { readTerminals: () => [], updateTerminal: () => {} }
  const field =
    <K extends keyof ShellData>(key: K) =>
    (value: ShellData[K] | ((previous: ShellData[K]) => ShellData[K])) => {
      const next = typeof value === 'function' ? (value as (previous: ShellData[K]) => ShellData[K])(get()[key]) : value
      set({ [key]: next } as Pick<ShellData, K>)
    }
  const setClosedRunning = field('closedRunning')
  const setSearchOpen = field('searchOpen')
  const setShowLive = field('showLive')
  const setFoldersOpen = field('foldersOpen')
  const setHandoffRequest = field('handoffRequest')
  const setRecent = field('recent')
  const setSticky = field('sticky')
  const setCollapsed = field('collapsed')
  const setFolderFocus = field('folderFocus')
  const setSidebarW = field('sidebarW')
  const setSearchNewTab = field('searchNewTab')
  const dismissClosedRunning = () => setClosedRunning(null)

  const commit = (next: TabState) => {
    set({ state: next })
  }

  const issuePending = (target: Target | null | undefined) => {
    const p = target?.provider ? { ...target, seq: ++sequence } : null
    set({ pendingOpen: p })
  }

  const consumedPending = () => {
    set({ pendingOpen: null })
  }

  const adoptTerminals = (entries: TerminalEntry[]) => {
    const cur = get().state
    const next = cur.tabs.map((tab) => {
      const target = tab.target ? adoptTerminalsFor(tab.target, entries) : null
      return JSON.stringify(target) === JSON.stringify(tab.target) ? tab : { ...tab, target }
    })
    const unique = dedupeTabs(next, cur.activeKey)
    if (unique.length === cur.tabs.length && unique.every((t, i) => t === cur.tabs[i])) return
    const before = cur.tabs.find((t) => t.key === cur.activeKey)?.target
    const after = unique.find((t) => t.key === cur.activeKey)?.target
    commit({ ...cur, tabs: unique })
    if ((after?.id && before?.id !== after.id) || (after?.terminalKey && before?.terminalKey !== after.terminalKey)) issuePending(after)
  }

  const openTarget = (target: Target, { newTab = false }: OpenOptions = {}) => {
    const cur = get().state
    if (target?.newConversation) {
      target = newDraft(target)
      newTab = true
    }
    const terminal = target?.provider && services.readTerminals().find((t) => sameTarget(target, liveTarget(t)))
    if (terminal) target = adoptTerminal(target, terminal)
    const next: TabState = openTabState(cur, target, { newTab })
    commit(next)
    const selected = next.tabs.find((t) => t.key === next.activeKey)?.target
    issuePending(selected?.provider ? { ...selected, newConversation: target?.newConversation } : null)
    if (selected?.provider) pushRecent(selected)
  }

  const setScope = (s: Scope | null) => {
    setSticky(s)
    saveJson(SCOPE_KEY, s)
  }

  const openHome = ({ scope: sc, ...patch }: Target & { scope?: Scope } = {}, opts?: OpenOptions) => {
    if (sc) setScope(sc)
    openTarget({ ...HOME, ...patch }, opts)
  }

  const updateHome = (patch: Partial<Target>) => {
    const cur = get().state
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab || !isHome(tab.target)) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: { ...HOME, ...(t.target || {}), ...patch } } : t)) })
  }

  const onScope = (s: Scope) => {
    setScope(s)
    const cur = get().state
    const t = cur.tabs.find((x) => x.key === cur.activeKey)?.target
    if (t?.provider) openTarget({ provider: s.provider, root: s.root })
    else if (isHome(t)) updateHome({ focus: null, homeSource: null })
  }

  const activateTab = (key: string | undefined) => {
    const cur = get().state
    const tab = cur.tabs.find((t) => t.key === key)
    if (!tab || key === cur.activeKey) return
    commit({ ...cur, activeKey: tab.key })
    issuePending(tab.target)
  }

  const notifyClosed = (closed: Tab[]) => {
    const running = services
      .readTerminals()
      .filter((entry) => closed.some((tab) => sameTarget(tab.target, liveTarget(entry))))
      .map(liveTarget)
    if (running.length) setClosedRunning(running)
  }

  const { closeTab, closeOthers, closeRight, moveTab } = createTabActions({
    read: () => get().state,
    commit,
    notifyClosed,
    issuePending,
    createHomeTab: () => emptyTab({ ...HOME }),
  })

  const newTab = () => {
    set({ searchNewTab: true })
    setSearchOpen(true)
  }

  const copyLink = (key: string) => {
    const tab = get().state.tabs.find((t) => t.key === key)
    if (!tab?.target) return
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}${toHash(tab.target)}`).catch(() => {})
  }

  const onNavigate = (providerId: string, target: Target, { newTab = false }: OpenOptions = {}) => {
    const full = { provider: providerId, ...target }
    if (newTab) return openTarget(full, { newTab: true })
    const cur = get().state
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab) return
    if (!tab.target?.provider || tab.target.provider !== providerId) return
    const pend = get().pendingOpen
    if (pend && pend.provider === providerId && identity(pend) !== identity(full)) return
    const prev = tab.target || {}
    const keepTerminal = prev.root === full.root && ((prev.id && prev.id === full.id) || (prev.launchId && prev.launchId === full.launchId))
    const next = {
      ...full,
      launchId: full.launchId || (keepTerminal ? prev.launchId : undefined),
      terminalKey: full.terminalKey || (keepTerminal ? prev.terminalKey : undefined),
      rootLabel: full.rootLabel || (prev.root === full.root ? prev.rootLabel : undefined),
    }
    if (!next.id && !next.draft && prev.id && prev.root === next.root && (!next.slug || next.slug === prev.slug)) return
    if (sameTarget(prev, next) && prev.title === next.title && prev.project === next.project && prev.rootLabel === next.rootLabel && prev.view === next.view)
      return
    const duplicate = cur.tabs.find((t) => t.key !== tab.key && (next.id || next.launchId || next.terminalKey) && sameTarget(t.target, next))
    if (duplicate) {
      commit({ ...cur, activeKey: duplicate.key })
      issuePending(duplicate.target)
      return
    }
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: next } : t)) })
    pushRecent(next)
  }

  const onSessionRemoved = (providerId: string, { root, slug, id }: Target) => {
    const cur = get().state
    const hit = (t: Target | null | undefined) => t?.provider === providerId && t.root === root && t.id === id
    if (cur.tabs.some((t) => hit(t.target))) {
      const tabs = cur.tabs.map((t) => (hit(t.target) ? { ...t, target: { ...t.target, id: null, title: null, slug: t.target?.slug || slug || null } } : t))
      commit({ ...cur, tabs })
      if (hit(cur.tabs.find((t) => t.key === cur.activeKey)?.target)) issuePending(tabs.find((t) => t.key === cur.activeKey)?.target)
    }
    forgetRecent(hit)
    forgetPins(hit)
    setRecent(loadRecent())
  }

  const openSession = (providerId: string, target: Target, opts?: OpenOptions) =>
    openTarget({ provider: providerId, ...target }, target.kind === 'tmux' ? { ...opts, newTab: true } : opts)
  const terminalReady = (entry: TerminalEntry) => {
    if (!entry.key) return
    services.updateTerminal(entry, false)
    adoptTerminals([entry])
  }
  const terminalEnded = (provider: string, key: string) => {
    if (!key) return
    services.updateTerminal({ provider, key }, true)
    setClosedRunning((targets) => targets?.filter((target) => target.provider !== provider || target.terminalKey !== key) || null)
    const cur = get().state
    const tabs = cur.tabs.map((tab) =>
      tab.target?.provider === provider && tab.target.terminalKey === key
        ? { ...tab, target: { ...tab.target, terminalKey: undefined, launchId: undefined, draft: false, title: tab.target.id ? tab.target.title : null } }
        : tab
    )
    const endKey = terminalEntryKey(provider, '', key)
    set({ state: { ...cur, tabs }, terminalEnds: { ...get().terminalEnds, [endKey]: (get().terminalEnds[endKey] || 0) + 1 } })
    const selected = tabs.find((tab) => tab.key === cur.activeKey)
    if (selected && selected !== cur.tabs.find((tab) => tab.key === cur.activeKey)) issuePending(selected.target)
  }
  const dashboardEnded = (id: string) => {
    for (const tab of get().state.tabs) if (tab.target?.kind === 'dashboard' && tab.target.dashboardId === id) closeTab(tab.key)
  }
  const openDeckView = (target: Target) => {
    if (isDeckTarget(target)) openTarget(target, { newTab: true })
  }
  const openTerminal = (target: Target) => {
    if (target.provider) openSession(target.provider, target)
  }
  const requestHandoff = (request: HandoffRequest) => {
    if (request.source?.id && ['send', 'export'].includes(request.mode)) setHandoffRequest(request)
  }
  const revealFolder = (folderId: string) => {
    if (typeof folderId === 'string') {
      setCollapsed(false)
      setFolderFocus({ folderId })
    }
  }
  store.subscribe((next, previous) => {
    if (next.state !== previous.state) saveTabs(next.state.tabs, next.state.activeKey)
    if (next.collapsed !== previous.collapsed) saveJson('agentdeck_collapsed', next.collapsed ? 1 : 0)
    if (next.sidebarW !== previous.sidebarW) saveJson('agentdeck_sidebarW', next.sidebarW)
  })
  return {
    store,
    actions: {
      dismissClosedRunning,
      commit,
      issuePending,
      consumedPending,
      adoptTerminals,
      openTarget,
      setScope,
      openHome,
      updateHome,
      onScope,
      activateTab,
      notifyClosed,
      closeTab,
      closeOthers,
      closeRight,
      moveTab,
      newTab,
      copyLink,
      onNavigate,
      onSessionRemoved,
      openSession,
      setClosedRunning,
      setSearchOpen,
      setShowLive,
      setFoldersOpen,
      setHandoffRequest,
      setRecent,
      setSticky,
      setCollapsed,
      setFolderFocus,
      setSidebarW,
      setSearchNewTab,
      terminalReady,
      terminalEnded,
      dashboardEnded,
      openDeckView,
      openTerminal,
      requestHandoff,
      revealFolder,
      initialize: () => set(initialData(providerIds)),
      connect: (next: Services) => {
        services = next
        return () => {
          if (services === next) services = { readTerminals: () => [], updateTerminal: () => {} }
        }
      },
    },
  }
}
export const shell = createShellStore()
export const shellActions = shell.actions
export const useShell = <T>(selector: (state: ShellData) => T) => useStore(shell.store, selector)
