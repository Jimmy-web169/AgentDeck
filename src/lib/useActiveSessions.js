import { useCallback, useSyncExternalStore } from 'react'
import { createLiveTerminalStore } from './liveTerminalStore.js'
import { shortPath } from './paths.js'
import { liveTarget } from './tabs.js'

// Single source of truth for the unified "Live" view across the whole app: the
// running tmux terminal sessions (real persistent background processes — the
// only kind of session that survives a browser refresh / server restart, so the
// only kind worth tracking globally). Both the right-hand Live button and the
// Dashboard read from this, so the count/list are always consistent regardless
// of which provider is active. The tmux pool is global, so polling any one
// provider's /active-sessions returns the complete cross-provider set.
let probe = 'claude'
let users = 0
let cleanup = null
const store = createLiveTerminalStore(async () => {
  const response = await fetch(`/api/${probe}/active-sessions`)
  if (!response.ok) throw new Error('Live sessions unavailable')
  const data = await response.json()
  return Array.isArray(data.tmux) ? data.tmux : []
})

function subscribe(listener, provider, intervalMs) {
  probe = provider
  const unsubscribe = store.subscribe(listener)
  if (users++ === 0) {
    const changed = () => store.schedule()
    const ready = (e) => store.upsert(e.detail)
    const ended = (e) => store.remove(e.detail?.key)
    const visible = () => { if (document.visibilityState === 'visible') store.refresh() }
    window.addEventListener('agentdeck:files-changed', changed)
    window.addEventListener('agentdeck:terminal-ready', ready)
    window.addEventListener('agentdeck:terminal-ended', ended)
    window.addEventListener('focus', changed)
    document.addEventListener('visibilitychange', visible)
    const interval = setInterval(store.refresh, intervalMs)
    cleanup = () => {
      clearInterval(interval)
      store.cancel()
      window.removeEventListener('agentdeck:files-changed', changed)
      window.removeEventListener('agentdeck:terminal-ready', ready)
      window.removeEventListener('agentdeck:terminal-ended', ended)
      window.removeEventListener('focus', changed)
      document.removeEventListener('visibilitychange', visible)
    }
    store.refresh()
  }
  return () => { unsubscribe(); if (--users === 0) cleanup?.() }
}

export default function useActiveSessions(providers = [], { enabled = true, intervalMs = 4000 } = {}) {
  const provider = providers[0]?.id
  const listen = useCallback((fn) => enabled && provider ? subscribe(fn, provider, intervalMs) : () => {}, [enabled, provider, intervalMs])
  const tmux = useSyncExternalStore(listen, store.getSnapshot, store.getSnapshot)
  return { tmux, count: tmux.length }
}

// Normalize tmux entries into the shared "manager item" shape the LiveSessionsPanel
// / Dashboard render. Kept here so every caller agrees.
export function toManagerItems({ tmux = [] }) {
  return tmux.map((t) => ({
    ...liveTarget(t),
    key: t.key,
    kind: 'tmux',
    provider: t.provider,
    root: t.root,
    slug: t.slug,
    id: t.id,
    cwd: t.cwd,
    tmuxName: t.tmuxName,
    attached: t.attached,
    title: t.title || (t.cwd || t.slug ? shortPath(t.cwd || t.slug) : '') || (t.id ? String(t.id).slice(0, 8) : 'terminal'),
  }))
}
