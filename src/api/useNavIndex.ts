import type { RootInfo as Root, SessionDetails } from './models.ts'
export type NavIndex = ReturnType<typeof useNavIndex>
export type NavProject = NavIndex['projects'][number]
export type NavSession = NonNullable<ReturnType<NavIndex['sessionsFor']>>[number]
export type NavScope = NavIndex['scopes'][number]
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Project, ChangeEvent } from '../../shared/types.js'
import type { QueryRef } from './queryPolicy.ts'
import { liveProjectKey, queryIdentity } from '../../shared/identity.ts'
import { projectName, shortPath } from '../lib/paths.ts'
import { usePrefs } from '../lib/prefs.ts'
import { providerQueryOptions } from './queries.ts'
import { matchesChange } from './queryPolicy.ts'

interface Provider {
  id: string
  label: string
}
const combineRoots = (results: UseQueryResult<{ roots: Root[] }>[]) => ({
  data: results.map((result) => result.data?.roots || []),
  loading: results.some((result) => result.isPending && result.isFetching),
})
const combineProjects = (results: UseQueryResult<{ projects: Project[] }>[]) => ({
  data: results.map((result) => result.data?.projects || []),
  loading: results.some((result) => result.isPending && result.isFetching),
})
const keyOf = (ref: QueryRef) => liveProjectKey(ref.provider, ref.root, ref.slug || '')
const sessionOptions = (ref: QueryRef, enabled = true) => ({ ...providerQueryOptions('sessions', ref, { enabled }), staleTime: 15000 })
function sessionRows(ref: QueryRef, sessions: SessionDetails[]) {
  return sessions
    .filter((session) => !session.isSubagent)
    .map((session) => ({
      ...session,
      provider: ref.provider,
      root: ref.root,
      slug: ref.slug,
      title: session.title || session.id.slice(0, 8) || '(untitled)',
      firstPrompt: session.firstPrompt || '',
      lastUserPrompt: session.lastUserPrompt || '',
      lastUserPromptTs: session.lastUserPromptTs || null,
      lastTs: session.lastTs || null,
      toolCalls: session.toolCalls || 0,
      userTurns: session.userTurns || 0,
      oversized: !!session.oversized,
      isSubagent: !!session.isSubagent,
      agentRole: session.agentRole || null,
      childCount: session.childCount || 0,
      hasSubagents: !!session.hasSubagents,
    }))
}

// Inventories and lazy session lists share the same Query entries as SessionApp.
// Only the set of demanded project scopes is local UI bookkeeping.
export default function useNavIndex(providers: readonly Provider[], { enabled = true } = {}) {
  const client = useQueryClient()
  const { pathDepth } = usePrefs()
  const [requested, setRequested] = useState<Map<string, QueryRef>>(() => new Map())
  const pending = useRef(new Map<string, QueryRef>())
  const scheduled = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const rootResults = useQueries({
    queries: providers.map((provider) => ({
      ...providerQueryOptions('roots', { provider: provider.id, root: '' }, { enabled }),
      staleTime: 45000,
      refetchInterval: 45000,
    })),
    combine: combineRoots,
  })
  const roots: Record<string, Root[]> = useMemo(
    () => Object.fromEntries(providers.map((provider, i) => [provider.id, rootResults.data[i]])),
    [providers, rootResults.data]
  )
  const scopes = useMemo(
    () =>
      providers.flatMap((provider) =>
        roots[provider.id].map((root) => ({
          provider: provider.id,
          providerLabel: provider.label,
          root: root.id,
          rootLabel: root.label,
          exists: root.exists !== false,
          probe: root.probe || null,
        }))
      ),
    [providers, roots]
  )
  const tracked = useMemo(() => scopes.filter((scope) => scope.exists), [scopes])
  const projectResults = useQueries({
    queries: tracked.map((ref) => ({
      ...providerQueryOptions('projects', ref, { enabled }),
      staleTime: 45000,
      refetchInterval: 45000,
    })),
    combine: combineProjects,
  })
  const projects = useMemo(
    () =>
      tracked
        .flatMap((ref, i) =>
          projectResults.data[i].map((project) => ({
            ...ref,
            slug: project.slug,
            cwd: project.cwd || null,
            name: projectName(project.cwd, project.slug),
            path: shortPath(project.cwd || project.slug, pathDepth),
            sessionCount: project.sessionCount ?? (Number(project.sessions) || 0),
            lastActivity: Number(project.lastActivity) || 0,
          }))
        )
        .sort((a, b) => b.lastActivity - a.lastActivity),
    [tracked, projectResults.data, pathDepth]
  )
  const refs = [...requested.values()]
  const sessionResults = useQueries({ queries: refs.map((ref) => sessionOptions(ref, enabled)) })
  const lists = new Map(
    refs.map((ref, i) => [keyOf(ref), sessionResults[i].data ? sessionRows(ref, sessionResults[i].data.sessions) : sessionResults[i].isError ? [] : null])
  )

  // Legacy projections may render in a child without rerendering this owner.
  // Batch demand registration after that render; the read itself starts no I/O.
  const scheduleDemand = () => {
    if (scheduled.current) return
    scheduled.current = true
    queueMicrotask(() => {
      scheduled.current = false
      const additions = new Map(pending.current)
      pending.current.clear()
      if (!mounted.current) return
      setRequested((previous) => {
        const next = new Map(previous)
        for (const [key, ref] of additions) next.set(key, ref)
        return next.size === previous.size ? previous : next
      })
    })
  }
  const sessionsFor = (provider: string, root: string, slug: string) => {
    const ref = { provider, root, slug },
      key = keyOf(ref)
    if (!requested.has(key)) {
      pending.current.set(key, ref)
      scheduleDemand()
    }
    return lists.get(key) ?? null
  }
  const loadSessions = useCallback(
    async (provider: string, root: string, slug: string, { force = false } = {}) => {
      const ref = { provider, root, slug },
        key = keyOf(ref)
      setRequested((previous) => (previous.has(key) ? previous : new Map(previous).set(key, ref)))
      const data = await client.fetchQuery({ ...sessionOptions(ref), staleTime: force ? 0 : 15000 })
      return sessionRows(ref, data.sessions)
    },
    [client]
  )
  const providerIds = useMemo(() => new Set(providers.map((provider) => provider.id)), [providers])
  const refresh = useCallback(
    async (force = true) => {
      if (force)
        await client.invalidateQueries({
          predicate: (query) => {
            const ref = queryIdentity(query.queryKey)
            return ref?.owner === 'provider' && providerIds.has(ref.provider || '') && (ref.kind === 'roots' || ref.kind === 'projects')
          },
        })
    },
    [client, providerIds]
  )
  const invalidate = useCallback(
    (changes: ChangeEvent[]) => client.invalidateQueries({ predicate: (query) => changes.some((change) => matchesChange(query.queryKey, change)) }),
    [client]
  )
  const cachedSessions = () => [...lists.values()].flatMap((list) => list || [])
  const labelOf = (provider: string, root: string, fallback = '') =>
    scopes.find((scope) => scope.provider === provider && scope.root === root)?.rootLabel || fallback
  const loading = enabled && (rootResults.loading || projectResults.loading)
  const published = useRef(false)
  useEffect(() => {
    if (enabled && !loading) published.current = true
  }, [enabled, loading])
  const initialLoading = loading && !published.current
  // Publish the initial inventory together, as the previous Promise.all index
  // did. Otherwise faster providers seed search candidates before their peers,
  // making equal-score result ordering depend on network timing.
  return {
    projects: initialLoading ? [] : projects,
    roots: initialLoading ? {} : roots,
    scopes: initialLoading ? [] : scopes,
    loading,
    refresh,
    loadSessions,
    sessionsFor,
    cachedSessions,
    invalidate,
    labelOf,
  }
}
