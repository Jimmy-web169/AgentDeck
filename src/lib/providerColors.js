import { getPrefs } from './prefs.js'

// Named accents used by the shell chrome (tab dots, the active tab's top bar,
// quick-switcher rows, folder chips, workspace icons). Every accent maps to
// theme tokens (`--<name>-400` etc. in index.css, one value per theme), never a
// hex value, so all three themes stay consistent. The classes are spelled out
// here so Tailwind's scanner sees them.
const COLORS = {
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', bar: 'rgb(var(--emerald-400))' },
  teal: { dot: 'bg-teal-400', text: 'text-teal-300', bar: 'rgb(var(--teal-400))' },
  lime: { dot: 'bg-lime-400', text: 'text-lime-300', bar: 'rgb(var(--lime-400))' },
  cyan: { dot: 'bg-cyan-400', text: 'text-cyan-300', bar: 'rgb(var(--cyan-400))' },
  sky: { dot: 'bg-sky-400', text: 'text-sky-300', bar: 'rgb(var(--sky-400))' },
  indigo: { dot: 'bg-indigo-400', text: 'text-indigo-300', bar: 'rgb(var(--indigo-400))' },
  violet: { dot: 'bg-violet-400', text: 'text-violet-300', bar: 'rgb(var(--violet-400))' },
  fuchsia: { dot: 'bg-fuchsia-400', text: 'text-fuchsia-300', bar: 'rgb(var(--fuchsia-400))' },
  pink: { dot: 'bg-pink-400', text: 'text-pink-300', bar: 'rgb(var(--pink-400))' },
  rose: { dot: 'bg-rose-400', text: 'text-rose-300', bar: 'rgb(var(--rose-400))' },
  red: { dot: 'bg-red-400', text: 'text-red-300', bar: 'rgb(var(--red-400))' },
  orange: { dot: 'bg-orange-400', text: 'text-orange-300', bar: 'rgb(var(--orange-400))' },
  amber: { dot: 'bg-amber-400', text: 'text-amber-300', bar: 'rgb(var(--amber-400))' },
  zinc: { dot: 'bg-zinc-500', text: 'text-zinc-400', bar: 'rgb(var(--zinc-500))' },
}

// what a colour picker offers (Preferences › Colours, a workspace's ⋯ menu),
// in hue order so neighbours look related
export const ACCENTS = [
  { k: 'emerald', label: 'Emerald' },
  { k: 'teal', label: 'Teal' },
  { k: 'lime', label: 'Lime' },
  { k: 'cyan', label: 'Cyan' },
  { k: 'sky', label: 'Sky' },
  { k: 'indigo', label: 'Indigo' },
  { k: 'violet', label: 'Violet' },
  { k: 'fuchsia', label: 'Fuchsia' },
  { k: 'pink', label: 'Pink' },
  { k: 'rose', label: 'Rose' },
  { k: 'red', label: 'Red' },
  { k: 'orange', label: 'Orange' },
  { k: 'amber', label: 'Amber' },
  { k: 'zinc', label: 'Grey' },
]
export const ACCENT_NAMES = ACCENTS.map((a) => a.k)
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
