import { useSyncExternalStore } from 'react'

// User preferences — the knobs the Preferences popover exposes. Stored in
// localStorage and applied to <html> as data attributes so plain CSS can react
// (theme tokens, row density). `agentdeck_theme` is kept as its own key
// because index.html reads it before React mounts (no flash of wrong theme).
const KEY = 'agentdeck_prefs'
const THEME_KEY = 'agentdeck_theme'

export const THEMES = [
  { k: 'midnight', label: 'Midnight', hint: 'cool slate, the default' },
  { k: 'graphite', label: 'Graphite', hint: 'neutral dark' },
  { k: 'light', label: 'Paper', hint: 'warm light' },
]
export const DENSITIES = [
  { k: 'comfortable', label: 'Comfortable' },
  { k: 'compact', label: 'Compact' },
]

// inlineSubagents: sub-agent threads expand under the tool call that spawned
// them in the Conversation view (off = the pre-2.0 view, Sub-agents tab only).
// providerColors: { <providerId>: <accent name> } — the user's override of a
// provider's shell accent (see lib/providerColors.js); absent = the registry default.
const DEFAULTS = { theme: 'midnight', density: 'comfortable', showWorkspaces: true, showPinned: true, showFirstPrompt: true, inlineSubagents: true, providerColors: {} }
const ACCENT_NAMES = ['emerald', 'sky', 'violet', 'amber', 'red', 'zinc']

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
  const pc = prefs.providerColors && typeof prefs.providerColors === 'object' ? prefs.providerColors : {}
  prefs.providerColors = Object.fromEntries(Object.entries(pc).filter(([, v]) => ACCENT_NAMES.includes(v)))
  return prefs
}

let prefs = load()
const subs = new Set()
const emit = () => subs.forEach((fn) => fn())
const subscribe = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}

function apply() {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = prefs.theme
  el.dataset.density = prefs.density
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
export function usePrefs() {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs)
}
export function setPref(k, v) {
  prefs = { ...prefs, [k]: v }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
    if (k === 'theme') localStorage.setItem(THEME_KEY, v)
  } catch {}
  apply()
  emit()
}
