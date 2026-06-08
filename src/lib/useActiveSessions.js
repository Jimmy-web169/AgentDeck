import { useEffect, useState } from 'react'

// Single source of truth for the unified "Live" view across the whole app: the
// running tmux terminal sessions (real persistent background processes — the
// only kind of session that survives a browser refresh / server restart, so the
// only kind worth tracking globally). Both the right-hand Live button and the
// Dashboard read from this, so the count/list are always consistent regardless
// of which provider is active. The tmux pool is global, so polling any one
// provider's /active-sessions returns the complete cross-provider set.
export default function useActiveSessions(providers = [], { enabled = true, intervalMs = 4000 } = {}) {
  const [tmux, setTmux] = useState([])

  useEffect(() => {
    if (!enabled || !providers.length) return
    let cancelled = false
    const probe = providers[0].id // any provider returns the whole shared set
    const load = () => {
      fetch(`/api/${probe}/active-sessions`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return
          setTmux(Array.isArray(d.tmux) ? d.tmux : [])
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [enabled, providers, intervalMs])

  return { tmux, count: tmux.length }
}

// Normalize tmux entries into the shared "manager item" shape the LiveSessionsPanel
// / Dashboard render. Kept here so every caller agrees.
export function toManagerItems({ tmux = [] }) {
  const last2 = (p) => String(p || '').split('/').filter(Boolean).slice(-2).join('/')
  return tmux.map((t) => ({
    key: t.key,
    kind: 'tmux',
    provider: t.provider,
    root: t.root,
    slug: t.slug,
    id: t.id,
    cwd: t.cwd,
    tmuxName: t.tmuxName,
    attached: t.attached,
    title: t.title || last2(t.cwd || t.slug) || (t.id ? String(t.id).slice(0, 8) : 'terminal'),
  }))
}
