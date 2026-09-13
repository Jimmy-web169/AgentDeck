import { shell, shellActions, useShell } from '../store/index.ts'
import { useEffect, useMemo } from 'react'
import type { TerminalEntry } from '../../shared/types.js'
import { useShellNavigation, type ShellProvider } from './useShellNavigation.ts'
import { createApi, useEventStream, useShellQueries } from '../api/index.ts'
import { announceTerminalEnd } from './terminalTarget.ts'
import { isDeckTarget } from './tabs.ts'
import { groupTabs, isHome, isTerminalTab, loadRecent, normalizeView, sameTarget, targetKey, unitEntry } from './tabs.ts'
import { fromHash, replaceHash, toHash } from './route.ts'

// Connect the shell to browser gestures and the shared Query inventories.
// Navigation state and actions themselves live in store/shell.ts.
export default function useAppShell(PROVIDER_LIST: ShellProvider[]) {
  const PROVIDER_IDS = useMemo(() => PROVIDER_LIST.map((provider) => provider.id), [PROVIDER_LIST])

  useEventStream()
  useShellQueries(PROVIDER_LIST[0]?.id || '')
  const pendingOpen = useShell((state) => state.pendingOpen)
  const closedRunning = useShell((state) => state.closedRunning)
  const searchOpen = useShell((state) => state.searchOpen)
  const showLive = useShell((state) => state.showLive)
  const foldersOpen = useShell((state) => state.foldersOpen)
  const handoffRequest = useShell((state) => state.handoffRequest)
  const recent = useShell((state) => state.recent)
  const collapsed = useShell((state) => state.collapsed)
  const searchNewTab = useShell((state) => state.searchNewTab)
  const {
    dismissClosedRunning,
    commit,
    issuePending,
    consumedPending,
    adoptTerminals,
    openTarget,
    openHome,
    updateHome,
    onScope,
    activateTab,
    closeTab,
    closeOthers,
    closeRight,
    moveTab,
    newTab,
    copyLink,
    onNavigate,
    openSession,
    setSearchOpen,
    setShowLive,
    setFoldersOpen,
    setHandoffRequest,
    setRecent,
    setCollapsed,
    setSearchNewTab,
  } = shellActions
  const apis = useMemo(() => Object.fromEntries(PROVIDER_LIST.map((p) => [p.id, createApi(p.id)])), [PROVIDER_LIST])

  const { state, index, live, activeSessions, termKeys, scope, activeTarget, activeTab } = useShellNavigation(PROVIDER_LIST)
  const { tabs, activeKey } = state
  useEffect(() => adoptTerminals(activeSessions.tmux), [activeSessions.tmux])

  // a relabelled folder renames the tabs that show it
  useEffect(() => {
    if (!index.scopes.length) return
    const cur = shell.store.getState().state
    let changed = false
    const next = cur.tabs.map((t) => {
      const tg = t.target
      if (!tg?.provider || !tg.root) return t
      const s = index.scopes.find((x) => x.provider === tg.provider && x.root === tg.root)
      if (!s || s.rootLabel === tg.rootLabel) return t
      changed = true
      return { ...t, target: { ...tg, rootLabel: s.rootLabel } }
    })
    if (changed) commit({ ...cur, tabs: next })
  }, [index.scopes])

  // ---- persistence + deep link ----
  useEffect(() => replaceHash(toHash(activeTarget)), [activeTarget])
  useEffect(() => {
    issuePending(shell.store.getState().state.tabs.find((t) => t.key === shell.store.getState().state.activeKey)?.target || null)
  }, [])

  // ---- deep links typed / pasted into the address bar ----
  useEffect(() => {
    const onHash = () => {
      const t = fromHash(location.hash, PROVIDER_IDS)
      if (!t) return
      const cur = shell.store.getState().state
      const act = cur.tabs.find((x) => x.key === cur.activeKey)?.target || null
      if (t.provider || isDeckTarget(t)) {
        if (!sameTarget(act, t)) openTarget(t)
      } else if (!isHome(act) || normalizeView(act?.view) !== normalizeView(t.view) || toHash(act) !== toHash(t))
        openHome({ ...t, view: normalizeView(t.view) })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [PROVIDER_IDS])

  useEffect(bindShellShortcuts, [])

  useEffect(() => {
    if (searchOpen) setRecent(loadRecent())
  }, [searchOpen])

  const openTabKeys = useMemo(() => new Set(tabs.map((t) => targetKey(t.target)).filter(Boolean)), [tabs])
  const showHome = isHome(activeTarget)

  const stopLiveTerminal = async (terminal: TerminalEntry) => {
    await apis[terminal.provider || ''].terminalStop({ key: terminal.key })
    announceTerminalEnd(terminal.provider || '', terminal.key)
  }

  return {
    state,
    pendingOpen,
    closedRunning,
    searchOpen,
    showLive,
    foldersOpen,
    handoffRequest,
    recent,
    collapsed,
    searchNewTab,
    index,
    live,
    activeSessions,
    termKeys,
    scope,
    activeTarget,
    activeTab,
    tabs,
    activeKey,
    openTabKeys,
    showHome,
    stopLiveTerminal,
    dismissClosedRunning,
    consumedPending,
    openTarget,
    openHome,
    updateHome,
    onScope,
    activateTab,
    closeTab,
    closeOthers,
    closeRight,
    moveTab,
    newTab,
    copyLink,
    onNavigate,
    openSession,
    setSearchOpen,
    setShowLive,
    setFoldersOpen,
    setHandoffRequest,
    setCollapsed,
    setSearchNewTab,
  }
}

// One browser binding shared by the hook and its keyboard regression tests.
export function bindShellShortcuts() {
  const { setSearchNewTab, setSearchOpen, setCollapsed, newTab, closeTab, activateTab } = shellActions
  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
      e.preventDefault()
      setSearchNewTab(false)
      setSearchOpen((o) => !o)
      return
    }
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyB') {
      e.preventDefault()
      setCollapsed((c) => !c)
      return
    }
    if (!e.altKey || mod || e.shiftKey) return
    if (e.target instanceof Element && e.target.closest('.xterm, input, textarea, select, [contenteditable="true"]')) return
    // Tab shortcuts step over units (a conversation with its terminal sub-tab is
    // one), landing on the segment last used there; Alt+↑/↓ move inside a unit.
    const { state: cur, lastSegment } = shell.store.getState()
    const units = groupTabs(cur.tabs)
    const idx = units.findIndex((u) => u.tab.key === cur.activeKey || u.terminal?.key === cur.activeKey)
    const unit = units[idx]
    const active = cur.tabs.find((t) => t.key === cur.activeKey)
    const enter = (u: (typeof units)[number] | undefined) => u && activateTab(unitEntry(u, lastSegment))
    if (e.code === 'KeyT') newTab()
    else if (e.code === 'KeyW') closeTab(cur.activeKey)
    // Alt+←/→ walk the big tabs, Alt+↑/↓ the small ones inside a unit; Alt+[ ] stay as the older pair.
    else if (e.code === 'BracketLeft' || e.code === 'ArrowLeft') enter(units[(idx - 1 + units.length) % units.length])
    else if (e.code === 'BracketRight' || e.code === 'ArrowRight') enter(units[(idx + 1) % units.length])
    else if (e.code === 'ArrowDown') {
      if (!unit?.terminal || isTerminalTab(active?.target)) return
      activateTab(unit.terminal.key)
    } else if (e.code === 'ArrowUp') {
      if (!unit || !isTerminalTab(active?.target)) return
      activateTab(unit.tab.key)
    } else if (/^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5))
      enter(n === 9 ? units[units.length - 1] : units[n - 1])
    } else return
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
