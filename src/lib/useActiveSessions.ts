import type { TerminalEntry } from '../../shared/types.d.ts'
import { useActiveSessions as useLiveSessions } from '../api/index.ts'
import { shortPath } from './paths.ts'
import { liveTarget } from './tabs.ts'
const EMPTY: TerminalEntry[] = []

// Every consumer uses the first provider for the global terminal inventory.
export default function useActiveSessions(providers: readonly { id: string }[] = [], { enabled = true } = {}) {
  const provider = providers[0]?.id || ''
  const { data } = useLiveSessions(provider, { enabled: enabled && !!provider })
  const tmux = data?.tmux || EMPTY
  return { tmux, count: tmux.length }
}

// Normalize tmux entries into the shared "manager item" shape the LiveSessionsPanel
// / Dashboard render. Kept here so every caller agrees.
export function toManagerItems({ tmux = [] }: { tmux?: TerminalEntry[] }) {
  return tmux.map((t) => ({
    ...liveTarget(t),
    key: t.key,
    kind: 'tmux',
    provider: t.provider,
    root: t.root,
    slug: t.slug,
    id: t.id,
    cwd: t.cwd,
    tmuxName: typeof t.tmuxName === 'string' ? t.tmuxName : undefined,
    attached: !!t.attached,
    title: t.title || (t.cwd || t.slug ? shortPath(t.cwd || t.slug) : '') || (t.id ? String(t.id).slice(0, 8) : 'terminal'),
  }))
}
