export type Pin = import('../../shared/types.js').Target & { folderId?: string; name?: string | null; at?: number }

import { folderItemKey, projectSessionKey } from '../../shared/identity.ts'
import { useSyncExternalStore } from 'react'
import { shellActions } from '../store/index.ts'

// Pinned projects and sessions — a small, cross-provider list in localStorage
// shared by the sidebar, the quick switcher and the Home overview. A pin is a
// target { provider, root, rootLabel, slug, id?, title?, project, cwd }: with an
// id it pins a session, without one it pins the whole project.
const KEY = 'agentdeck_pins'
const MAX = 60
export const isFolderPin = (p: Pin | null | undefined): p is Pin & { folderId: string } => p?.kind === 'folder' && typeof p.folderId === 'string'
const validFolderPin = (p: Pin) => isFolderPin(p) && typeof p.folderId === 'string' && !!p.folderId && typeof p.cwd === 'string' && !!p.cwd
export const pinsForMode = (pins: Pin[], mode: string) => pins.filter((p) => !isFolderPin(p) || mode === 'folder')
export const folderPinTarget = (folder: { id: string; cwd: string | null; name?: string }) => ({
  kind: 'folder',
  folderId: folder.id,
  cwd: folder.cwd,
  name: folder.name || folder.cwd,
})
export function revealPinnedFolder(pin: Pin) {
  if (validFolderPin(pin)) shellActions.revealFolder(pin.folderId || '')
}

function load(): Pin[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((p) => (isFolderPin(p) ? validFolderPin(p) : p?.provider && p.root && (p.slug || p.id))) : []
  } catch {
    return []
  }
}

let pins = load()
const subs: Set<() => void> = new Set()
const emit = () =>
  subs.forEach((fn) => {
    fn()
  })
const subscribe = (fn: () => void) => {
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

function save(next: Pin[]) {
  pins = next.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(pins))
  } catch {}
  emit()
}

export const pinKey = (t: Pin) => (isFolderPin(t) ? folderItemKey(t.folderId || '') : projectSessionKey(t))

export const getPins = () => pins
export const isPinned = (t: Pin) => {
  const k = pinKey(t)
  return pins.some((p) => pinKey(p) === k)
}

export function togglePin(t: Pin) {
  if (isFolderPin(t) ? !validFolderPin(t) : !t?.provider || !t.root || !(t.slug || t.id)) return
  const k = pinKey(t)
  if (pins.some((p) => pinKey(p) === k)) {
    save(pins.filter((p) => pinKey(p) !== k))
    return false
  }
  const entry = isFolderPin(t)
    ? { kind: 'folder', folderId: t.folderId, cwd: t.cwd, name: t.name || t.cwd, at: Date.now() }
    : {
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
export function forgetPins(match: (pin: Pin) => boolean) {
  const next = pins.filter((p) => !match(p))
  if (next.length !== pins.length) save(next)
}

// React binding: re-renders when the pin list changes (this tab or another)
export function usePins() {
  return useSyncExternalStore(subscribe, getPins, getPins)
}
