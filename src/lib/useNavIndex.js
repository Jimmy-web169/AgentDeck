import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { projectName, shortPath } from './paths.js'
import { usePrefs } from './prefs.js'

// Cross-provider, cross-root navigation index for the quick switcher, the
// scope menus and Home.
//
// `roots` (per provider) and `projects` (every provider × every tracked folder)
// are loaded up front and refreshed in the background, so opening the switcher
// never waits on the network. Session lists are fetched lazily per project and
// cached; while a list is in flight `sessionsFor` returns null and the hook
// re-renders its consumer once the data lands.
const INDEX_TTL = 45000
const SESSIONS_TTL = 15000

const sessionsKey = (provider, root, slug) => `${provider}|${root}|${slug}`

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export default function useNavIndex(providers, { enabled = true } = {}) {
  const [rawProjects, setProjects] = useState([])
  // `path` is display-only and follows Preferences › Paths, so it is derived here
  // (not stored at fetch time) and every consumer re-renders when the depth changes
  const { pathDepth } = usePrefs()
  const projects = useMemo(() => rawProjects.map((p) => ({ ...p, path: shortPath(p.cwd || p.slug, pathDepth) })), [rawProjects, pathDepth])
  const [roots, setRoots] = useState({}) // providerId -> [{ id, label, dir, exists, … }]
  const [loading, setLoading] = useState(false)
  const loadedAt = useRef(0)
  const inflight = useRef(null)
  const sessionCache = useRef(new Map()) // key -> { at, data, promise }
  const [, bump] = useState(0)

  const refresh = useCallback(
    (force = false) => {
      if (inflight.current) return inflight.current
      if (!force && Date.now() - loadedAt.current < INDEX_TTL) return Promise.resolve()
      setLoading(true)
      const run = (async () => {
        const out = []
        const rootsOut = {}
        await Promise.all(
          providers.map(async (p) => {
            try {
              const rr = await getJson(`/api/${p.id}/roots`)
              const list = rr?.roots || []
              rootsOut[p.id] = list
              await Promise.all(
                list
                  .filter((r) => r.exists !== false)
                  .map(async (r) => {
                    try {
                      const pr = await getJson(`/api/${p.id}/projects?root=${encodeURIComponent(r.id)}`)
                      for (const proj of pr?.projects || []) {
                        out.push({
                          provider: p.id,
                          providerLabel: p.label,
                          root: r.id,
                          rootLabel: r.label,
                          slug: proj.slug,
                          cwd: proj.cwd || null,
                          name: projectName(proj.cwd, proj.slug),
                          sessionCount: proj.sessionCount ?? proj.sessions ?? 0,
                          lastActivity: Number(proj.lastActivity) || 0,
                        })
                      }
                    } catch {
                      // skip this root
                    }
                  })
              )
            } catch {
              // skip this provider
            }
          })
        )
        out.sort((a, b) => b.lastActivity - a.lastActivity)
        loadedAt.current = Date.now()
        setProjects(out)
        setRoots(rootsOut)
        setLoading(false)
      })()
      inflight.current = run.finally(() => {
        inflight.current = null
      })
      return inflight.current
    },
    [providers]
  )

  useEffect(() => {
    if (!enabled) return
    refresh(true)
    const t = setInterval(() => refresh(false), INDEX_TTL)
    return () => clearInterval(t)
  }, [enabled, refresh])

  // every provider × folder, in provider order — what the scope menus list
  const scopes = useMemo(
    () =>
      providers.flatMap((p) =>
        (roots[p.id] || []).map((r) => ({
          provider: p.id,
          providerLabel: p.label,
          root: r.id,
          rootLabel: r.label,
          exists: r.exists !== false,
          probe: r.probe || null, // format-drift status from the server's probe (chip badge)
        }))
      ),
    [providers, roots]
  )

  // Promise of a project's session list (cached).
  const loadSessions = useCallback((provider, root, slug, { force = false } = {}) => {
    const k = sessionsKey(provider, root, slug)
    const hit = sessionCache.current.get(k)
    if (hit && !force && (hit.promise || Date.now() - hit.at < SESSIONS_TTL)) return hit.promise || Promise.resolve(hit.data)
    const promise = getJson(`/api/${provider}/sessions?root=${encodeURIComponent(root)}&slug=${encodeURIComponent(slug)}`)
      .then((d) =>
        (d?.sessions || [])
          .filter((s) => !s.isSubagent)
          .map((s) => ({
            provider,
            root,
            slug,
            id: s.id,
            title: s.title || (s.id ? String(s.id).slice(0, 8) : '(untitled)'),
            firstPrompt: s.firstPrompt || '',
            lastTs: s.lastTs || null,
            toolCalls: s.toolCalls || 0,
            userTurns: s.userTurns || 0,
            oversized: !!s.oversized,
            isSubagent: !!s.isSubagent,
            agentRole: s.agentRole || null,
            childCount: s.childCount || 0,
            hasSubagents: !!s.hasSubagents,
          }))
      )
      .catch(() => [])
      .then((list) => {
        sessionCache.current.set(k, { at: Date.now(), data: list, promise: null })
        bump((n) => n + 1)
        return list
      })
    sessionCache.current.set(k, { at: Date.now(), data: hit?.data || null, promise })
    return promise
  }, [])

  // Synchronous view of a project's session list: the cached list (possibly
  // stale, refreshing in the background) or null while the first load is in flight.
  const sessionsFor = useCallback(
    (provider, root, slug) => {
      const k = sessionsKey(provider, root, slug)
      const hit = sessionCache.current.get(k)
      if (!hit || (!hit.promise && Date.now() - hit.at >= SESSIONS_TTL)) loadSessions(provider, root, slug)
      return sessionCache.current.get(k)?.data || null
    },
    [loadSessions]
  )

  // Live change → mark the touched session lists stale and let the project
  // index refresh soon (last-activity ordering, new projects).
  const known = useRef(new Set())
  useEffect(() => {
    known.current = new Set(rawProjects.map((p) => sessionsKey(p.provider, p.root, p.slug)))
  }, [rawProjects])
  const soon = useRef(null)
  const invalidate = useCallback(
    (changes) => {
      let unknown = false
      for (const c of changes || []) {
        const k = sessionsKey(c.provider, c.root, c.slug)
        const hit = sessionCache.current.get(k)
        if (hit) hit.at = 0
        if (!c.slug || !known.current.has(k)) unknown = true
      }
      loadedAt.current = Math.min(loadedAt.current, Date.now() - INDEX_TTL + 4000)
      // a write for a project the index has never listed (a brand-new conversation
      // in a new folder, or one whose cwd is not resolved yet) must not wait for the
      // 45 s tick — refetch shortly, coalescing the burst of writes a new session makes
      if (unknown && !soon.current) {
        soon.current = setTimeout(() => {
          soon.current = null
          refresh(true)
        }, 1200)
      }
    },
    [refresh]
  )
  useEffect(() => () => soon.current && clearTimeout(soon.current), [])

  // the current display label of a tracked folder (pins / workspaces store a
  // snapshot; the live one wins)
  const labelOf = useCallback((provider, root, fallback = '') => scopes.find((s) => s.provider === provider && s.root === root)?.rootLabel || fallback, [scopes])

  return { projects, roots, scopes, loading, refresh, loadSessions, sessionsFor, invalidate, labelOf }
}
