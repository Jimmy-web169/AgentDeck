import type { Target } from '../../shared/types.d.ts'
import { useCallback, useMemo } from 'react'
import { useNavIndex, useProviderCommand } from '../api/index.ts'
import { useShell, useLiveKeys, shellActions } from '../store/index.ts'
import { terminalTabKeys } from './tabs.ts'
import { liveSessionKey } from '../../shared/identity.ts'
import { baseName } from './paths.ts'
import useActiveSessions from './useActiveSessions.ts'

export interface ShellProvider {
  id: string
  label: string
}
export interface Scope {
  provider: string
  root: string
}
interface Session {
  id: string
}

// Shared observers read one Query cache. Sidebar and shell subscribe directly;
// neither owns a copied inventory or forwards the other's server data as props.
export function useShellNavigation(providers: readonly ShellProvider[], { enabled = true } = {}) {
  const state = useShell((data) => data.state)
  const sticky = useShell((data) => data.sticky)
  const index = useNavIndex(providers, { enabled })
  const live = useLiveKeys()
  const activeSessions = useActiveSessions(providers, { enabled })
  const activeTab = state.tabs.find((tab) => tab.key === state.activeKey) || state.tabs[0]
  const activeTarget = activeTab?.target || null
  const drafts = useMemo(() => state.tabs.map((tab) => tab.target).filter((target): target is Target => !!(target?.provider && target.draft)), [state.tabs])
  const termKeys = useMemo(() => {
    const keys = terminalTabKeys(activeSessions.tmux)
    for (const terminal of activeSessions.tmux) {
      if (terminal.provider && terminal.root && terminal.id) keys.add(liveSessionKey(terminal.provider, terminal.root, terminal.id))
    }
    return keys
  }, [activeSessions.tmux])
  const scope = useMemo(() => {
    const has = (value: Scope | null) => value && index.scopes.some((item) => item.provider === value.provider && item.root === value.root)
    if (activeTarget?.provider && activeTarget.root && has({ provider: activeTarget.provider, root: activeTarget.root }))
      return { provider: activeTarget.provider, root: activeTarget.root }
    if (activeTarget?.provider) {
      const found = index.scopes.find((item) => item.provider === activeTarget.provider)
      if (found) return { provider: found.provider, root: found.root }
    }
    if (has(sticky)) return sticky
    return index.scopes[0] ? { provider: index.scopes[0].provider, root: index.scopes[0].root } : null
  }, [activeTarget, sticky, index.scopes])
  const command = useProviderCommand()
  const deleteOne = useCallback(
    async (selected: Scope, slug: string, session: Session) => {
      await command(selected.provider, 'deleteSession', { ref: { root: selected.root, slug, id: session.id } })
      shellActions.onSessionRemoved(selected.provider, { root: selected.root, slug, id: session.id })
    },
    [command]
  )
  const afterDelete = useCallback(
    (selected: Scope, slug: string) => {
      index.loadSessions(selected.provider, selected.root, slug, { force: true })
      index.refresh(true)
    },
    [index.loadSessions, index.refresh]
  )
  const deleteSessions = useCallback(
    async (selected: Scope, slug: string, sessions: Session[]) => {
      // Sequential: each delete may spawn a recycle helper.
      for (const session of sessions) {
        try {
          await deleteOne(selected, slug, session)
        } catch (error) {
          if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) console.error(error)
        }
      }
      afterDelete(selected, slug)
    },
    [deleteOne, afterDelete]
  )
  const deleteSession = useCallback((selected: Scope, slug: string, session: Session) => deleteSessions(selected, slug, [session]), [deleteSessions])
  const newProject = useCallback(
    (selected: Scope, cwd: string) =>
      shellActions.openTarget({
        provider: selected.provider,
        root: selected.root,
        cwd,
        project: baseName(cwd),
        draft: true,
        title: 'New conversation',
        newConversation: true,
      }),
    []
  )
  return { state, sticky, index, live, activeSessions, activeTab, activeTarget, drafts, termKeys, scope, deleteSession, deleteSessions, newProject }
}
