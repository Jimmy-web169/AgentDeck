import { readStorage, writeStorage } from '../store/persistence.ts'
export type Target = import('../../shared/types.js').Target

export type Terminal = import('../../shared/types.js').TerminalEntry & { requestedTarget?: Target; terminalKey?: string }

export type Tab = { key: string; target: Target | null }

export type TabState = { tabs: Tab[]; activeKey: string | null }

import { isDeckTarget, targetKey, legacyDraftKey } from '../../shared/identity.ts'
export { isDeckTarget, targetKey }
// Tab model for the shell's Chrome-style tab strip.
//
// A tab = { key, target }. `target` says where the tab is:
//   { provider, root, rootLabel, slug, id, title, project, cwd, draft, view }
// Everything is optional. No provider → Home: `view` picks the page
// (activity, stats, insights, history, plugins, resources); reports use their
// own source filters. A provider without a session shows that
// provider's app as it is. `draft` marks a not-yet-saved "new conversation".
// `view` remembers which in-app tab (conversation / sub-agents / raw / memory /
// config) the tab was on, so switching back lands where you left. Tabs persist
// in localStorage.

import { shortPath } from './paths.ts'
import { normalizeHomeScope, normalizeHomeSource } from './homeScope.ts'

export const TABS_KEY = 'agentdeck_tabs'
export const RECENT_KEY = 'agentdeck_recent'
const RECENT_MAX = 40

// Home pages — every entry gets a button in Home's header.
export const HOME_VIEWS = [
  { k: 'activity', label: 'Activity' },
  { k: 'stats', label: 'Stats' },
  { k: 'insights', label: 'Insights' },
  { k: 'history', label: 'History' },
  { k: 'plugins', label: 'Plugins' },
  { k: 'resources', label: 'Resources' },
]
// Views that no longer exist, so old deep links (#/home/<view>) and persisted
// tabs still land on Home. Folder browsing lives in the sidebar; tracked
// sources are managed with its "+" button.
const LEGACY_VIEWS: Record<string, string> = { overview: 'activity', memory: 'activity', context: 'activity', dashboards: 'activity', folders: 'activity' }
export const normalizeView = (v: string | null | undefined): string =>
  HOME_VIEWS.some((x) => x.k === v) ? v || 'activity' : LEGACY_VIEWS[v || ''] || 'activity'
export const homeViewLabel = (k: string | null | undefined) => HOME_VIEWS.find((v) => v.k === normalizeView(k))?.label || ''

export const newKey = () => Math.random().toString(36).slice(2, 10)

export const sameTarget = (a: Target | null | undefined, b: Target | null | undefined) => {
  if (isDeckTarget(a) || isDeckTarget(b)) return isDeckTarget(a) && isDeckTarget(b) && targetKey(a) === targetKey(b)
  if (a?.provider !== b?.provider || a?.root !== b?.root) return false
  if (a?.terminalKey && a.terminalKey === b?.terminalKey) return true
  if (a?.launchId && a.launchId === b?.launchId) return true
  return targetKey(a) === targetKey(b)
}

export const newDraft = <T extends Target>(target: T) => ({ ...target, draft: true, launchId: crypto.randomUUID() })

export function liveTarget(t: Terminal) {
  return {
    provider: t.provider,
    root: t.root,
    slug: t.slug,
    id: t.id,
    cwd: t.cwd,
    title: t.title,
    launchId: t.launchId,
    terminalKey: t.key || t.terminalKey,
    draft: !t.id,
    kind: 'tmux',
  }
}

// Status follows exact identities, never a folder shared by several drafts.
export function terminalTabKeys(terminals: Terminal[]) {
  const keys = new Set<string>()
  for (const terminal of terminals) {
    const t = liveTarget(terminal)
    if (!t.provider || !t.root) continue
    if (t.id) keys.add(targetKey(t))
    if (t.terminalKey) keys.add(targetKey({ ...t, id: null }))
    if (t.launchId) keys.add(targetKey({ ...t, id: null, terminalKey: null }))
  }
  return keys
}

export function adoptTerminal(target: Target, terminal: Terminal) {
  if (!target?.provider) return target
  const legacy =
    target.draft &&
    !target.launchId &&
    !target.terminalKey &&
    terminal.provider === target.provider &&
    terminal.root === target.root &&
    [target.cwd, target.slug].some((p) => !!p && !!target.root && terminal.key === legacyDraftKey(target.root, p))
  const requested = terminal.requestedTarget && sameTarget(target, { ...terminal.requestedTarget, provider: terminal.provider })
  if (!legacy && !requested && !sameTarget(target, liveTarget(terminal))) return target
  return {
    ...target,
    terminalKey: terminal.key,
    launchId: terminal.launchId || target.launchId,
    id: terminal.id || target.id,
    slug: terminal.slug || target.slug,
    cwd: terminal.cwd || target.cwd,
    title: (!target.id && terminal.id ? terminal.title : target.title) || target.title || terminal.title,
    draft: !(terminal.id || target.id),
  }
}

export function adoptTerminalsFor(target: Target, entries: Terminal[]) {
  if (target?.draft && !target.launchId && !target.terminalKey) {
    const matches = entries.filter((e) => adoptTerminal(target, e) !== target)
    if (new Set(matches.map((e) => e.key)).size > 1) return target
  }
  return entries.reduce(adoptTerminal, target)
}

// Preserve the active tab when persisted/late-resolved aliases converge.
export function dedupeTabs(tabs: Tab[], activeKey: string | null) {
  const groups: Tab[][] = []
  for (const tab of tabs) {
    const known = isDeckTarget(tab.target) || (tab.target?.provider && (tab.target.id || tab.target.launchId || tab.target.terminalKey))
    const matches = known ? groups.filter((g) => g.some((t) => sameTarget(t.target, tab.target))) : []
    if (!matches.length) groups.push([tab])
    else {
      // A newly learned alias can bridge two previously independent groups.
      matches[0].push(...matches.slice(1).flat(), tab)
      for (const group of matches.slice(1)) groups.splice(groups.indexOf(group), 1)
    }
  }
  return groups.map((group) => {
    if (group.length === 1) return group[0]
    const winner = group.find((t) => t.key === activeKey) || group[0]
    const defined = (t: Tab) => Object.fromEntries(Object.entries(t.target || {}).filter(([, v]) => v !== undefined))
    const target = Object.assign({}, ...group.map(defined), defined(winner))
    if (target.id) target.draft = false
    return { ...winner, target }
  })
}
export const isHome = (t: Target | null | undefined) => !t?.provider && !isDeckTarget(t)
export const isEmpty = isHome

export function emptyTab(target: import('../../shared/types.js').Target | null = null) {
  return { key: newKey(), target }
}

// All entry points use the same navigation policy. Live terminals open beside
// the current tab; every known alias focuses its existing tab instead.
export function openTabState(state: TabState, target: Target, { newTab = false } = {}) {
  if (target?.kind === 'folder') target = { provider: null, view: 'activity' }
  const stored = target
    ? Object.fromEntries(
        Object.entries(target).filter(([k, v]) => v !== undefined && !['newConversation', 'at'].includes(k) && (k !== 'kind' || isDeckTarget(target)))
      )
    : { provider: null, view: 'activity' }
  const existing =
    isDeckTarget(target) || (target?.provider && (target.id || target.draft || target.terminalKey))
      ? state.tabs.find((t) => sameTarget(t.target, target))
      : null
  if (existing) {
    const merged = { ...existing.target, ...stored, view: target.view || existing.target?.view }
    return { tabs: state.tabs.map((t) => (t.key === existing.key ? { ...t, target: merged } : t)), activeKey: existing.key }
  }
  if (newTab || target?.kind === 'tmux' || !state.tabs.length) {
    const tab = emptyTab(stored)
    const tabs = [...state.tabs]
    tabs.splice(tabs.findIndex((t) => t.key === state.activeKey) + 1, 0, tab)
    return { tabs, activeKey: tab.key }
  }
  return { ...state, tabs: state.tabs.map((t) => (t.key === state.activeKey ? { ...t, target: stored } : t)) }
}

// What the strip prints for a tab: a primary (project) and secondary (session) part.
export function tabLabel(target: Target | null, providers: readonly { id: string; label: string }[] = []) {
  if (isDeckTarget(target)) return { primary: target?.title || 'Dashboard', secondary: 'Live tmux' }
  if (!target?.provider)
    return {
      primary: homeViewLabel(target?.view),
      secondary: target?.homeSource
        ? `${providers.find((p) => p.id === target.homeSource?.provider)?.label || target.homeSource.provider} / ${target.homeSource.rootLabel || target.homeSource.root}`
        : '',
    }
  const providerLabel = providers.find((p) => p.id === target.provider)?.label || target.provider
  const project = target.project || ''
  // a draft has no session yet: the project name on top, the folder it will land in below
  if (target.draft)
    return {
      primary: project || target.title || providerLabel,
      secondary: target.cwd || target.slug ? `new · ${shortPath(target.cwd || target.slug)}` : target.title || 'New conversation',
    }
  if (target.id) return project ? { primary: project, secondary: target.title || '' } : { primary: target.title || target.id.slice(0, 8), secondary: '' }
  if (target.slug || target.cwd) return { primary: project || target.slug, secondary: '' }
  return { primary: providerLabel, secondary: target.rootLabel || '' }
}

// ---- persistence ----
export function loadTabs(): TabState | null {
  try {
    const raw = JSON.parse(readStorage(TABS_KEY) || 'null')
    if (!raw || !Array.isArray(raw.tabs)) return null
    const tabs: Tab[] = raw.tabs
      .filter((t: Tab) => t && typeof t === 'object')
      .map((t: Tab) => {
        let target = t.target && typeof t.target === 'object' ? t.target : { provider: null, view: 'activity' }
        if (target?.kind === 'context' || target?.kind === 'folder') target = { provider: null, view: 'activity' }
        if (target && isHome(target))
          target = {
            provider: null,
            view: normalizeView(target.view),
            focus: target.focus || null,
            ...(target.homeScope ? { homeScope: normalizeHomeScope(target.homeScope) } : {}),
            ...(normalizeHomeSource(target.homeSource) ? { homeSource: normalizeHomeSource(target.homeSource) } : {}),
          }
        return { key: typeof t.key === 'string' && t.key ? t.key : newKey(), target }
      })
    if (!tabs.length) return null
    const activeKey = tabs.some((t) => t.key === raw.activeKey) ? raw.activeKey : tabs[0].key
    return { tabs: dedupeTabs(tabs, activeKey), activeKey }
  } catch {
    return null
  }
}

export function saveTabs(tabs: Tab[], activeKey: string | null) {
  try {
    writeStorage(TABS_KEY, JSON.stringify({ tabs, activeKey }))
  } catch {}
}

// ---- recent (MRU) sessions for the quick switcher / Activity ----
export function loadRecent(): Target[] {
  try {
    const arr = JSON.parse(readStorage(RECENT_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((t) => t?.provider) : []
  } catch {
    return []
  }
}

export function pushRecent(target: Target) {
  if (!target?.provider || target.draft || !target.id) return
  const k = targetKey(target)
  const { view, ...rest } = target
  const next = [{ ...rest, at: Date.now() }, ...loadRecent().filter((t) => targetKey(t) !== k)].slice(0, RECENT_MAX)
  try {
    writeStorage(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

// drop a target from the MRU list (e.g. after it was trashed)
export function forgetRecent(match: (target: Target) => boolean) {
  const next = loadRecent().filter((t) => !match(t))
  try {
    writeStorage(RECENT_KEY, JSON.stringify(next))
  } catch {}
}
