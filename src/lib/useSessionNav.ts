import { useCallback, useEffect, useRef, useState } from 'react'
import type { Target } from '../../shared/types.js'
import { pendingOpenSignature } from '../../shared/identity.ts'
import { useRoots, useSessions } from '../api/index.ts'

type Pending = Target & { seq?: number; newConversation?: boolean }
type Selection = Target & { root: string | null; slug: string | null; id: string | null; view: string }
export interface SessionNavOptions {
  provider: string
  addressing: 'id' | 'slug+id'
  active: boolean
  views: readonly string[]
  pending?: Pending | null
  onConsumed?: () => void
  onNavigate?: (provider: string, target: Target) => void
}
const empty = (root: string | null): Selection => ({ root, slug: null, id: null, view: 'conversation' })

// Query owns all fetched data. This hook owns only navigation intent; in
// particular it never holds a second transcript/list cache or starts a request.
export function useSessionNav({ provider, addressing, active, views, pending, onConsumed, onNavigate }: SessionNavOptions) {
  const [selection, setSelection] = useState<Selection>(() => empty(null))
  const [error, setError] = useState<string | null>(null)
  const rootsQuery = useRoots(provider, { enabled: active })
  const roots = rootsQuery.data
  const sessions = useSessions({ provider, root: selection.root || '', slug: selection.slug }, { enabled: active && addressing === 'slug+id' })
  const consumed = useRef<string | null>(null)
  const current = useRef(selection)
  current.current = selection

  useEffect(() => {
    if (!active || pending?.root || !roots) return
    if (selection.root && roots.roots.some((item) => item.id === selection.root)) return
    const root = roots.default || roots.roots[0]?.id || null
    if (root !== selection.root) {
      setSelection(empty(root))
      setError(null)
    }
  }, [active, pending?.root, roots, selection.root])

  useEffect(() => {
    if (!active || !pending) {
      consumed.current = null
      return
    }
    const root = pending.root || selection.root
    if (!root) return
    const signature = pendingOpenSignature({
      root,
      slug: pending.slug || undefined,
      id: pending.id || undefined,
      view: pending.view || undefined,
      seq: pending.seq,
    })
    if (consumed.current === signature) return
    if (root !== selection.root) {
      setSelection(empty(root))
      setError(null)
      return
    }
    const view = pending.view && views.includes(pending.view) ? pending.view : null
    const isDraft = !pending.id && (pending.draft || pending.kind === 'tmux' || pending.newConversation) && (pending.slug || pending.cwd)
    if (isDraft) {
      setSelection({
        ...pending,
        root,
        slug: pending.slug || null,
        id: null,
        draft: true,
        cwd: pending.cwd || (addressing === 'id' ? pending.slug : null),
        title: pending.title || (pending.slug ? 'New conversation' : 'New project'),
        view: 'conversation',
      })
      setError(null)
      if (pending.newConversation) onNavigate?.(provider, { ...pending, draft: true, title: 'New conversation', view: 'conversation' })
    } else if (pending.id) {
      const slug = pending.slug || (root === selection.root ? selection.slug : null)
      if (addressing === 'slug+id' && slug !== selection.slug) {
        setSelection({ ...empty(root), slug })
        setError(null)
        return
      }
      let title = pending.title
      if (addressing === 'slug+id' && pending.id !== selection.id) {
        const listed = sessions.data?.sessions.find((item) => item.id === pending.id)
        if (!listed && !pending.terminalKey && !sessions.isSuccess) return
        if (!listed && !pending.terminalKey) {
          setError(`Session ${pending.id.slice(0, 8)}… is no longer in this project (trashed?)`)
          consumed.current = signature
          onConsumed?.()
          return
        }
        title = listed?.title || title
      }
      setSelection({
        ...pending,
        root,
        slug,
        id: pending.id,
        draft: false,
        title,
        view: view || (pending.id === selection.id ? selection.view : 'conversation'),
      })
      setError(null)
    } else {
      setSelection({ ...empty(root), slug: pending.slug || selection.slug, view: view === 'config' || view === 'memory' ? view : 'conversation' })
      setError(null)
    }
    consumed.current = signature
    onConsumed?.()
  }, [active, pending, selection, views, addressing, sessions, onConsumed, onNavigate, provider])

  const changeView = useCallback(
    (view: string) => {
      if (!views.includes(view)) return
      const next = { ...current.current, view }
      setSelection(next)
      onNavigate?.(provider, next)
    },
    [views, provider, onNavigate]
  )
  const select = useCallback(
    (target: Target) => {
      const next: Selection = {
        ...target,
        root: target.root || current.current.root,
        slug: target.slug || null,
        id: target.id || null,
        view: target.view && views.includes(target.view) ? target.view : 'conversation',
      }
      setSelection(next)
      setError(null)
      onNavigate?.(provider, next)
    },
    [views, provider, onNavigate]
  )
  const enrich = useCallback(
    (target: Target) => {
      const previous = current.current
      if (target.root !== previous.root || target.id !== previous.id) return
      const next = {
        ...previous,
        slug: target.slug || previous.slug,
        title: target.title || previous.title,
        cwd: target.cwd || previous.cwd,
        project: target.project ?? previous.project,
        rootLabel: target.rootLabel ?? previous.rootLabel,
      }
      if (
        next.slug === previous.slug &&
        next.title === previous.title &&
        next.cwd === previous.cwd &&
        next.project === previous.project &&
        next.rootLabel === previous.rootLabel
      )
        return
      setSelection(next)
      onNavigate?.(provider, next)
    },
    [provider, onNavigate]
  )
  const clearError = useCallback(() => setError(null), [])
  return { selection, error, changeView, select, enrich, clearError, roots: rootsQuery, sessions }
}
