import { getPrefs } from './prefs.js'

// Named accents used by the shell chrome (tab dots, the active tab's top bar,
// quick-switcher rows, folder chips, workspace icons). Every accent maps to
// theme tokens (`--<name>-400` in index.css), never a hex value, so all three
// themes stay consistent. The classes are spelled out here so Tailwind's
// scanner sees them.
const COLORS = {
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', bar: 'rgb(var(--emerald-400))' },
  sky: { dot: 'bg-sky-400', text: 'text-sky-300', bar: 'rgb(var(--sky-400))' },
  violet: { dot: 'bg-violet-400', text: 'text-violet-300', bar: 'rgb(var(--violet-400))' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', bar: 'rgb(var(--amber-400))' },
  red: { dot: 'bg-red-400', text: 'text-red-300', bar: 'rgb(var(--red-400))' },
  zinc: { dot: 'bg-zinc-500', text: 'text-zinc-400', bar: 'rgb(var(--zinc-500))' },
}

// what a colour picker offers (Preferences › Colours, a workspace's ⋯ menu)
export const ACCENTS = [
  { k: 'emerald', label: 'Emerald' },
  { k: 'sky', label: 'Sky' },
  { k: 'violet', label: 'Violet' },
  { k: 'amber', label: 'Amber' },
  { k: 'red', label: 'Red' },
  { k: 'zinc', label: 'Grey' },
]
export const isAccent = (name) => Object.prototype.hasOwnProperty.call(COLORS, name)
export const accentClasses = (name, fallback = 'zinc') => COLORS[name] || COLORS[fallback]

// A provider's accent: the user's choice (Preferences › Colours, stored in
// prefs.providerColors) wins over the registry default (`color` in
// src/providers/<id>.jsx). Callers re-render on pref changes through usePrefs.
export function providerColorName(providers, id) {
  const chosen = getPrefs().providerColors?.[id]
  if (chosen && isAccent(chosen)) return chosen
  return providers?.find((p) => p.id === id)?.color || 'zinc'
}
export function providerColor(providers, id) {
  return accentClasses(providerColorName(providers, id))
}

export function providerLabel(providers, id) {
  return providers?.find((p) => p.id === id)?.label || id || ''
}
