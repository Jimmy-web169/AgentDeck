import { useSyncExternalStore } from 'react'

// Pinned projects and sessions — a small, cross-provider list in localStorage
// shared by the sidebar, the quick switcher and the Home overview. A pin is a
// target { provider, root, rootLabel, slug, id?, title?, project, cwd }: with an
// id it pins a session, without one it pins the whole project.
const KEY = 'agentdeck_pins'
const MAX = 60

function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((p) => p && p.provider && p.root && (p.slug || p.id)) : []
  } catch {
    return []
  }
}

let pins = load()
const subs = new Set()
const emit = () => subs.forEach((fn) => fn())
const subscribe = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    pins = load()
    emit()
  })
}

function save(next) {
  pins = next.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(pins))
  } catch {}
  emit()
}

export const pinKey = (t) => `${t?.provider || ''}|${t?.root || ''}|${t?.slug || ''}|${t?.id || ''}`

export const getPins = () => pins
export const isPinned = (t) => {
  const k = pinKey(t)
  return pins.some((p) => pinKey(p) === k)
}

export function togglePin(t) {
  if (!t?.provider || !t.root || !(t.slug || t.id)) return
  const k = pinKey(t)
  if (pins.some((p) => pinKey(p) === k)) {
    save(pins.filter((p) => pinKey(p) !== k))
    return false
  }
  const entry = {
    provider: t.provider,
    root: t.root,
    rootLabel: t.rootLabel || '',
    slug: t.slug || null,
    id: t.id || null,
    title: t.id ? t.title || null : null,
    project: t.project || null,
    cwd: t.cwd || null,
    at: Date.now(),
  }
  save([entry, ...pins])
  return true
}

// drop pins that match (e.g. a trashed session)
export function forgetPins(match) {
  const next = pins.filter((p) => !match(p))
  if (next.length !== pins.length) save(next)
}

// React binding: re-renders when the pin list changes (this tab or another)
export function usePins() {
  return useSyncExternalStore(subscribe, getPins, getPins)
}
