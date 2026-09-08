// Tab model for the shell's Chrome-style tab strip.
//
// A tab = { key, target }. `target` says where the tab is:
//   { provider, root, rootLabel, slug, id, title, project, cwd, draft, view }
// Everything is optional. No provider → Home: `view` picks the page
// (activity, stats, insights, history, plugins, resources); the per-folder
// pages use the sidebar's scope. A provider without a session shows that
// provider's app as it is. `draft` marks a not-yet-saved "new conversation".
// `view` remembers which in-app tab (conversation / sub-agents / raw / memory /
// config) the tab was on, so switching back lands where you left. Tabs persist
// in localStorage.

import { shortPath } from './paths.js'

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
// tabs still land on Home. `folders` became FoldersDialog (the "+" next to
// the folder chips).
const LEGACY_VIEWS = { overview: 'activity', memory: 'activity', folders: 'activity' }
export const normalizeView = (v) => (HOME_VIEWS.some((x) => x.k === v) ? v : LEGACY_VIEWS[v] || 'activity')
export const homeViewLabel = (k) => HOME_VIEWS.find((v) => v.k === normalizeView(k))?.label || ''

export const newKey = () => Math.random().toString(36).slice(2, 10)

// identity of a target — what "the same place" means for switch-to-tab and
// dedupe. The in-app view is deliberately NOT part of it.
export const targetKey = (t) =>
  t?.provider ? `${t.provider}|${t.root || ''}|${t.slug || ''}|${t.id || ''}${t.draft ? '|draft' : ''}` : ''

export const sameTarget = (a, b) => targetKey(a) === targetKey(b)
export const isHome = (t) => !t?.provider
export const isEmpty = isHome

export const emptyTab = (target = null) => ({ key: newKey(), target })

// What the strip prints for a tab: a primary (project) and secondary (session) part.
export function tabLabel(target, providers = []) {
  if (!target?.provider) return { primary: homeViewLabel(target?.view), secondary: '' }
  const providerLabel = providers.find((p) => p.id === target.provider)?.label || target.provider
  const project = target.project || ''
  // a draft has no session yet: the project name on top, the folder it will land in below
  if (target.draft) return { primary: project || target.title || providerLabel, secondary: target.cwd || target.slug ? `new · ${shortPath(target.cwd || target.slug)}` : target.title || 'New conversation' }
  if (target.id) return project ? { primary: project, secondary: target.title || '' } : { primary: target.title || target.id.slice(0, 8), secondary: '' }
  if (target.slug || target.cwd) return { primary: project || target.slug, secondary: '' }
  return { primary: providerLabel, secondary: target.rootLabel || '' }
}

// ---- persistence ----
export function loadTabs() {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) || 'null')
    if (!raw || !Array.isArray(raw.tabs)) return null
    const tabs = raw.tabs
      .filter((t) => t && typeof t === 'object')
      .map((t) => {
        let target = t.target && typeof t.target === 'object' ? t.target : null
        if (target && !target.provider) target = { provider: null, view: normalizeView(target.view), focus: target.focus || null }
        return { key: typeof t.key === 'string' && t.key ? t.key : newKey(), target }
      })
    if (!tabs.length) return null
    const activeKey = tabs.some((t) => t.key === raw.activeKey) ? raw.activeKey : tabs[0].key
    return { tabs, activeKey }
  } catch {
    return null
  }
}

export function saveTabs(tabs, activeKey) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeKey }))
  } catch {}
}

// ---- recent (MRU) sessions for the quick switcher / Activity ----
export function loadRecent() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((t) => t && t.provider) : []
  } catch {
    return []
  }
}

export function pushRecent(target) {
  if (!target?.provider || target.draft || !target.id) return
  const k = targetKey(target)
  const { view, ...rest } = target
  const next = [{ ...rest, at: Date.now() }, ...loadRecent().filter((t) => targetKey(t) !== k)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

// drop a target from the MRU list (e.g. after it was trashed)
export function forgetRecent(match) {
  const next = loadRecent().filter((t) => !match(t))
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}
