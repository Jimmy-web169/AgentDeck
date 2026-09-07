// Tab model for the shell's Chrome-style tab strip.
//
// A tab = { key, target }. `target` says where the tab is:
//   { provider, root, rootLabel, slug, id, title, project, cwd, draft, view }
// Everything is optional. No provider → Home (the logo page: overview, stats,
// history, memory, plugins, resources, folders — `view` picks the page and
// `scope` = { provider, root } picks the folder for the per-folder pages).
// A provider without a session shows that provider's app as it is. `draft`
// marks a not-yet-saved "new conversation". `view` remembers which in-app tab
// (conversation / sub-agents / raw / config) the tab was on, so switching back
// lands where you left. Tabs persist in localStorage.

export const TABS_KEY = 'agentdeck_tabs'
export const RECENT_KEY = 'agentdeck_recent'
const RECENT_MAX = 40

export const HOME_VIEWS = [
  { k: 'overview', label: 'Overview' },
  { k: 'stats', label: 'Stats' },
  { k: 'history', label: 'History' },
  { k: 'memory', label: 'Memory' },
  { k: 'plugins', label: 'Plugins' },
  { k: 'resources', label: 'Resources' },
  { k: 'folders', label: 'Folders' },
]
export const homeViewLabel = (k) => HOME_VIEWS.find((v) => v.k === k)?.label || ''

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
  if (!target?.provider) {
    const v = target?.view && target.view !== 'overview' ? homeViewLabel(target.view) : ''
    return { primary: 'Home', secondary: v }
  }
  const providerLabel = providers.find((p) => p.id === target.provider)?.label || target.provider
  const project = target.project || ''
  if (target.draft) return { primary: project || target.title || providerLabel, secondary: target.title || 'New conversation' }
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
      .map((t) => ({ key: typeof t.key === 'string' && t.key ? t.key : newKey(), target: t.target && typeof t.target === 'object' ? t.target : null }))
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

// ---- recent (MRU) sessions for the quick switcher's empty state ----
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
