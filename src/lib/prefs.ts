export type Preferences = {
  theme: string
  density: string
  fontSize: number
  sidebarMode: string
  showUnavailableFolders: boolean
  folderExcludedProviders: string[]
  folderExcludedRoots: string[]
  showWorkspaces: boolean
  showPinned: boolean
  showSuggestions: boolean
  showLatestPrompt: boolean
  inlineSubagents: boolean
  providerColors: Record<string, string>
  customAccents: string[]
  statusColors: Record<string, string>
  pathDepth: number
  homeSessions: number
  homeProjects: number
}

import { useSyncExternalStore } from 'react'
import { normalizeColor } from './accent.ts'
import { normalizeHomeScope } from './homeScope.ts'

// User preferences — the knobs the Preferences popover exposes. Stored in
// localStorage and applied to <html> as data attributes so plain CSS can react
// (theme tokens, row density). `agentdeck_theme` is kept as its own key
// because index.html reads it before React mounts (no flash of wrong theme).
const KEY = 'agentdeck_prefs'
const THEME_KEY = 'agentdeck_theme'

export const THEMES = [
  { k: 'midnight', label: 'Midnight', hint: 'cool slate' },
  { k: 'graphite', label: 'Graphite', hint: 'neutral dark, the default' },
  { k: 'light', label: 'Paper', hint: 'warm light' },
]
export const DENSITIES = [
  { k: 'comfortable', label: 'Comfortable' },
  { k: 'compact', label: 'Compact' },
]
export const SIDEBAR_MODES = [
  { k: 'source', label: 'Provider / root' },
  { k: 'folder', label: 'Folder mode' },
]
// 100% preserves the existing 16px root and all legacy UI text sizes.
// Terminal viewers are separate documents and keep their own font settings.
export const FONT_SIZES = [90, 100, 110, 125, 150].map((k) => ({ k, label: `${k}%` }))

// inlineSubagents: sub-agent threads expand under the tool call that spawned
// them in the Conversation view (off = the pre-2.0 view, Sub-agents tab only).
// providerColors: { <providerId>: <hex> } — the user's override of a provider's
// shell accent (see lib/providerColors.js); absent = the registry default.
// customAccents: the user's own saved swatches (hex), shown in every colour picker.
// statusColors: { terminal?: hex, writing?: hex } — the pulsing status dots (a session
// with a running terminal / a transcript being written); absent = the built-in red / green.
// showSuggestions: the "Suggested · same folder in several places" box under Workspaces.
// pathDepth: how many trailing folders a project path shows (sidebar, Ctrl+K, Stats,
// Home) — 1…4, or 0 for the whole path. Windows and POSIX paths alike (lib/paths.js).
export const PATH_DEPTHS = [
  { k: 1, label: '1', hint: 'folder name only — AgentDeck' },
  { k: 2, label: '2', hint: 'parent/name — Jimmy/AgentDeck' },
  { k: 3, label: '3', hint: 'three folders — Desktop/Jimmy/AgentDeck' },
  { k: 4, label: '4', hint: 'four folders' },
  { k: 0, label: 'Full', hint: 'the whole path' },
]
// homeSessions / homeProjects: rows per page in Home › Activity › Latest sessions (5–15)
// and Recent projects (5–10); longer lists page, they never grow the page.
export const HOME_PROJECTS = [
  { k: 5, label: '5' },
  { k: 10, label: '10' },
]
export const HOME_SESSIONS = [
  { k: 5, label: '5' },
  { k: 10, label: '10' },
  { k: 15, label: '15' },
]
// Recent projects follow sidebarMode; there is no independent display mode.
const DEFAULTS: Preferences = {
  theme: 'graphite',
  density: 'comfortable',
  fontSize: 100,
  sidebarMode: 'source',
  showUnavailableFolders: false,
  folderExcludedProviders: [],
  folderExcludedRoots: [],
  showWorkspaces: true,
  showPinned: true,
  showSuggestions: true,
  showLatestPrompt: true,
  inlineSubagents: true,
  providerColors: {},
  customAccents: [],
  statusColors: {},
  pathDepth: 2,
  homeSessions: 10,
  homeProjects: 5,
}
const MAX_SWATCHES = 24

function load() {
  let prefs = { ...DEFAULTS }
  try {
    prefs = { ...prefs, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'graphite' || t === 'midnight') prefs.theme = t
    else if (t === 'dark') prefs.theme = 'midnight' // pre-2.0 value
  } catch {}
  if (!THEMES.some((x) => x.k === prefs.theme)) prefs.theme = DEFAULTS.theme
  if (!DENSITIES.some((x) => x.k === prefs.density)) prefs.density = DEFAULTS.density
  if (!SIDEBAR_MODES.some((x) => x.k === prefs.sidebarMode)) prefs.sidebarMode = DEFAULTS.sidebarMode
  if (typeof prefs.showUnavailableFolders !== 'boolean') prefs.showUnavailableFolders = false
  prefs.folderExcludedProviders = [
    ...new Set((Array.isArray(prefs.folderExcludedProviders) ? prefs.folderExcludedProviders : []).filter((p) => typeof p === 'string' && p.length > 0)),
  ]
  prefs.folderExcludedRoots = normalizeHomeScope({ excludedRoots: prefs.folderExcludedRoots }).excludedRoots || []
  if (!FONT_SIZES.some((x) => x.k === prefs.fontSize)) prefs.fontSize = DEFAULTS.fontSize
  delete (prefs as Preferences & { showFirstPrompt?: unknown }).showFirstPrompt // retired; keep the existing latest-question choice
  if (typeof prefs.showLatestPrompt !== 'boolean') prefs.showLatestPrompt = DEFAULTS.showLatestPrompt
  if (!PATH_DEPTHS.some((x) => x.k === prefs.pathDepth)) prefs.pathDepth = DEFAULTS.pathDepth
  if (!HOME_SESSIONS.some((x) => x.k === prefs.homeSessions)) prefs.homeSessions = DEFAULTS.homeSessions
  if (!HOME_PROJECTS.some((x) => x.k === prefs.homeProjects)) prefs.homeProjects = DEFAULTS.homeProjects
  delete (prefs as Preferences & { recentProjectsBy?: unknown }).recentProjectsBy
  // colours are stored as hex; legacy palette names from before still resolve
  const pc = prefs.providerColors && typeof prefs.providerColors === 'object' ? prefs.providerColors : {}
  prefs.providerColors = Object.fromEntries(
    Object.entries(pc)
      .map(([k, v]) => [k, normalizeColor(v)])
      .filter(([, v]) => v !== null)
  )
  const sc = prefs.statusColors && typeof prefs.statusColors === 'object' ? prefs.statusColors : {}
  prefs.statusColors = Object.fromEntries(
    Object.entries(sc)
      .filter(([k]) => k === 'terminal' || k === 'writing')
      .map(([k, v]) => [k, normalizeColor(v)])
      .filter(([, v]) => v)
  )
  const seen = new Set()
  prefs.customAccents = (Array.isArray(prefs.customAccents) ? prefs.customAccents : [])
    .map(normalizeColor)
    .filter((c) => c !== null)
    .filter((c) => !seen.has(c) && !!seen.add(c))
    .slice(-MAX_SWATCHES)
  return prefs
}

let prefs = load()
const subs: Set<() => void> = new Set()
const emit = () =>
  subs.forEach((fn) => {
    fn()
  })
const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => subs.delete(fn)
}

function apply() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = prefs.theme
  el.dataset.density = prefs.density
  el.style.fontSize = `${prefs.fontSize}%`
}
apply()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== THEME_KEY) return
    prefs = load()
    apply()
    emit()
  })
}

export const getPrefs = () => prefs
export const subscribePrefs = subscribe
export function usePrefs() {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs)
}
export function setPref(k: string, v: unknown) {
  if (k === 'folderExcludedRoots') v = normalizeHomeScope({ excludedRoots: v }).excludedRoots || []
  if (k === 'showUnavailableFolders' && typeof v !== 'boolean') return
  if (k === 'folderExcludedProviders') {
    if (!Array.isArray(v)) return
    v = [...new Set(v.filter((p) => typeof p === 'string' && p.length > 0))]
  }
  if (k === 'sidebarMode' && !SIDEBAR_MODES.some((x) => x.k === v)) return
  if (k === 'showFirstPrompt' || k === 'recentProjectsBy') return
  if (k === 'fontSize' && !FONT_SIZES.some((x) => x.k === v)) return
  prefs = { ...prefs, [k]: v }
  persistPrefs(k)
}
// Commit both filter levels together so readers never request an intermediate scope.
export function setFolderFilter(value: unknown) {
  const scope = normalizeHomeScope(value)
  prefs = { ...prefs, folderExcludedProviders: scope.excluded, folderExcludedRoots: scope.excludedRoots || [] }
  persistPrefs()
}
function persistPrefs(k?: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
    if (k === 'theme') localStorage.setItem(THEME_KEY, prefs.theme)
  } catch {}
  apply()
  emit()
}
