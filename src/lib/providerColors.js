import { getPrefs, subscribePrefs } from './prefs.js'
import { NAMED, hexToHsl, normalizeColor } from './accent.js'

// Per-provider accent used by the shell chrome (tab dots, the active tab's top
// bar, quick-switcher rows, folder chips, source tags). A provider names a
// default colour in its registry entry (`color`, a legacy name or a hex); the
// user's choice in Preferences › Colours (prefs.providerColors, any hex) wins.
//
// Consumers get *class names* (`ac-<id>-dot`, `ac-<id>-text`) and a bar colour.
// The classes are written into a <style> element at runtime — one rule pair per
// registered provider, reading `--ac-<id>-h` / `--ac-<id>-s` from <html> — so a
// colour change repaints everything without any component knowing about hex
// values, and the theme still owns the lightness (--accent-l-* in index.css).

let registered = []
const cls = (id) => String(id || '').replace(/[^a-z0-9_-]/gi, '_')
const NEUTRAL = { hex: NAMED.zinc, dot: 'bg-zinc-500', text: 'text-zinc-400', bar: 'rgb(var(--zinc-500))' }

export function providerDefaultColor(providers, id) {
  return normalizeColor(providers?.find((p) => p.id === id)?.color) || NAMED.zinc
}
export function providerColorValue(providers, id) {
  return normalizeColor(getPrefs().providerColors?.[id]) || providerDefaultColor(providers, id)
}
export function providerColor(providers, id) {
  if (!id || !registered.some((p) => p.id === id)) return NEUTRAL
  const k = cls(id)
  return { hex: providerColorValue(providers, id), dot: `ac-${k}-dot`, text: `ac-${k}-text`, bar: `hsl(var(--ac-${k}-h) var(--ac-${k}-s) var(--accent-l-bar))` }
}

export function providerLabel(providers, id) {
  return providers?.find((p) => p.id === id)?.label || id || ''
}

// Called once with the provider list (src/providers/index.js); re-applied on
// every preference change.
export function registerProviders(list) {
  registered = Array.isArray(list) ? list : []
  applyProviderAccents()
}
export function applyProviderAccents() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  let css = ''
  for (const p of registered) {
    const k = cls(p.id)
    const { h, s } = hexToHsl(providerColorValue(registered, p.id))
    root.style.setProperty(`--ac-${k}-h`, String(h))
    root.style.setProperty(`--ac-${k}-s`, `${s}%`)
    css += `.ac-${k}-dot{background-color:hsl(var(--ac-${k}-h) var(--ac-${k}-s) var(--accent-l-dot))}\n.ac-${k}-text{color:hsl(var(--ac-${k}-h) var(--ac-${k}-s) var(--accent-l-text))}\n`
  }
  let el = document.getElementById('agentdeck-accents')
  if (!el) {
    el = document.createElement('style')
    el.id = 'agentdeck-accents'
    document.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
}
subscribePrefs(applyProviderAccents)
