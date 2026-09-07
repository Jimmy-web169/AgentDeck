import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { claudeApi as api } from './api.js'
import Conversation from './components/claude/Conversation.jsx'
import RawView from './components/shared/RawView.jsx'
import Stats from './components/shared/Stats.jsx'
import SubagentsView from './components/claude/SubagentsView.jsx'
import Resources from './components/claude/Resources.jsx'
import MemoryView from './components/claude/MemoryView.jsx'
import { ShortcutChips } from './components/shared/ShortcutHints.jsx'
import TerminalPanel from './components/claude/TerminalPanel.jsx'
import LiveSessionsPanel from './components/shared/LiveSessionsPanel.jsx'
import useActiveSessions, { toManagerItems } from './lib/useActiveSessions.js'
import { ActivityIcon } from './components/shared/icons.jsx'
import { projectName } from './lib/paths.js'
import RateLimitsBar from './components/claude/RateLimitsBar.jsx'
import InfoDot from './components/shared/InfoDot.jsx'
import ErrorBoundary from './components/shared/ErrorBoundary.jsx'
import { bumpSessionVersions, createDebounceWithMaxWait, getSessionVersion, hasSubagentsNow, subscribeToPageResume } from './lib/liveSync.js'

const LIVE_MS = 8000

// The Claude provider's main area: a session's Conversation / Sub-agents / Raw
// / Config plus the embedded terminal. Browsing (sidebar) and folder-wide
// views (Home) belong to the shell; this app is steered by `pendingOpen` and
// reports its view changes back with `onNavigate`.
const SESSION_TABS = [
  { k: 'conversation', need: 'session', label: 'Conversation' },
  { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
  { k: 'raw', need: 'session', label: 'Raw' },
  { k: 'stats', need: 'session', label: 'Stats' },
  { k: 'memory', need: 'project', label: 'Memory' },
  { k: 'config', need: 'project', label: 'Config' },
]
const VIEWS = new Set(SESSION_TABS.map((t) => t.k))

export default function App({ active: appActive = true, providers, scopes, onOpenHome, onOpenSession, pendingOpen, onConsumedPending, onNavigate }) {
  const [roots, setRoots] = useState([])
  const [root, setRoot] = useState(null)
  const [projects, setProjects] = useState([])
  const [openSlug, setOpenSlug] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [active, setActive] = useState(null)
  const [sessionData, setSessionData] = useState(null)
  const [subagents, setSubagents] = useState(null)
  const [raw, setRaw] = useState(null)
  const [stats, setStats] = useState(null) // folder stats for the session Stats tab
  const [usage, setUsage] = useState(null)
  const [tab, setTab] = useState('conversation')
  const [conn, setConn] = useState('connecting')
  const [lastEvent, setLastEvent] = useState(0)
  const [error, setError] = useState(null)
  const [sessionVersions, setSessionVersions] = useState({}) // provider|root|id -> live refetch counter
  const [showLive, setShowLive] = useState(false) // the Live manager modal
  const [termDraft, setTermDraft] = useState(null) // a "new conversation" terminal target { slug? cwd? }
  const [terminals, setTerminals] = useState([]) // running ttyd terminals — for auto-reattach

  const rootRef = useRef(null)
  const activeRef = useRef(null)
  const openSlugRef = useRef(null)
  const tabRef = useRef(tab)
  const termDraftRef = useRef(null)
  const mainRef = useRef(null)
  const stickBottom = useRef(true)
  const rootsRef = useRef([])
  const projectsRef = useRef([])
  const onNavigateRef = useRef(onNavigate)

  useEffect(() => void (rootRef.current = root), [root])
  useEffect(() => void (activeRef.current = active), [active])
  useEffect(() => void (openSlugRef.current = openSlug), [openSlug])
  useEffect(() => void (tabRef.current = tab), [tab])
  useEffect(() => void (termDraftRef.current = termDraft), [termDraft])
  const sessionDataRef = useRef(null)
  useEffect(() => void (sessionDataRef.current = sessionData), [sessionData])
  // per-session pane memory: what was loaded and where the reader was, so coming
  // back to a session (another tab, the sidebar) restores it instead of reloading
  // and jumping to the end
  const paneMemo = useRef(new Map())
  const restoreScroll = useRef(null)
  const rememberPane = () => {
    const a = activeRef.current
    if (!a) return
    paneMemo.current.set(a.id, { scrollTop: mainRef.current?.scrollTop ?? 0, data: sessionDataRef.current })
  }
  useEffect(() => void (rootsRef.current = roots), [roots])
  useEffect(() => void (projectsRef.current = projects), [projects])
  useEffect(() => void (onNavigateRef.current = onNavigate), [onNavigate])

  // ---- shell sync: describe "where this app is" for the tab strip ----
  const targetOf = useCallback(({ slug, id, title, draft, cwd, view } = {}) => {
    const r = rootRef.current
    const proj = slug ? projectsRef.current.find((p) => p.slug === slug) : null
    const c = cwd || proj?.cwd || null
    return {
      root: r,
      rootLabel: rootsRef.current.find((x) => x.id === r)?.label || '',
      slug: slug || null,
      id: id || null,
      title: title || null,
      project: slug || c ? projectName(c, slug) : null,
      cwd: c,
      draft: !!draft,
      view: view || tabRef.current || 'conversation',
    }
  }, [])
  const report = useCallback((t, opts) => onNavigateRef.current?.('claude', targetOf(t), opts), [targetOf])
  const currentTarget = useCallback((view) => {
    const d = termDraftRef.current
    const a = activeRef.current
    const slug = openSlugRef.current
    if (d) return { slug: d.slug, cwd: d.cwd, draft: true, title: d.title || 'New conversation', view }
    if (a && slug) return { slug, id: a.id, title: a.title, view }
    return slug ? { slug, view } : { view }
  }, [])
  const changeTab = (k) => {
    setTab(k)
    tabRef.current = k
    report(currentTarget(k))
  }

  // ---- inline sub-agent threads (Conversation) ----
  // memoised on ids only — a new object here would re-render the (memo) Conversation
  const activeId = active?.id || null
  const subagentCtx = useMemo(() => (root && openSlug && activeId ? { root, slug: openSlug, id: activeId } : null), [root, openSlug, activeId])

  // ---- roots + projects ----
  const reloadRoots = useCallback(async () => {
    const d = await api.roots()
    setRoots(d.roots)
    setRoot((cur) => (cur && d.roots.some((r) => r.id === cur) ? cur : d.default || d.roots[0]?.id || null))
    return d
  }, [])
  useEffect(() => {
    if (!appActive) return
    reloadRoots().catch((e) => setError(e.message))
  }, [reloadRoots, appActive])
  // tracked folders can change in the Tracked folders dialog — pick them up
  useEffect(() => {
    if (!appActive) return
    const list = (scopes || []).filter((s) => s.provider === 'claude')
    const sig = (xs, id, label) => xs.map((x) => `${x[id]}:${x[label]}`).sort().join('|')
    if (list.length && sig(list, 'root', 'rootLabel') !== sig(roots, 'id', 'label')) reloadRoots().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopes, appActive])

  const loadProjects = useCallback((r) => {
    if (!r) return
    api.projects(r).then((d) => setProjects(d.projects)).catch((e) => setError(e.message))
  }, [])

  const shownRootRef = useRef(null)
  useEffect(() => {
    if (!appActive) return
    if (!root) return
    loadProjects(root)
    // re-shown by the shell (a tab switch) with the same folder: keep what's on
    // screen — only an actual folder change resets the selection below
    if (shownRootRef.current === root) return
    shownRootRef.current = root
    setOpenSlug(null)
    setSessions([])
    loadedSessionsFor.current = null
    sessionsReqId.current++
    rememberPane()
    setActive(null)
    setSessionData(null)
    setSubagents(null)
    setTermDraft(null)
  }, [root, loadProjects, appActive])

  // ---- sessions ----
  const loadedSessionsFor = useRef(null)
  const sessionsReqId = useRef(0)
  const loadSessions = useCallback((r, slug) => {
    const key = `${r}|${slug}`
    const isRefresh = loadedSessionsFor.current === key
    const reqId = ++sessionsReqId.current
    if (!isRefresh) setLoadingSessions(true)
    api
      .sessions(r, slug)
      .then((d) => {
        if (sessionsReqId.current !== reqId) return
        loadedSessionsFor.current = key
        setSessions(d.sessions)
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!isRefresh && sessionsReqId.current === reqId) setLoadingSessions(false)
      })
  }, [])

  const openProject = (slug) => {
    setOpenSlug(slug)
    if (slug) loadSessions(root, slug)
  }

  const selectSession = (s, { view } = {}) => {
    const v = view && VIEWS.has(view) ? view : 'conversation'
    rememberPane()
    setTermDraft(null)
    setActive(s)
    const memo = paneMemo.current.get(s.id)
    if (memo?.data) {
      // seen before: show it exactly as it was, refresh quietly underneath
      setSessionData(memo.data)
      restoreScroll.current = memo.scrollTop
      stickBottom.current = false
    } else {
      setSessionData(null)
      stickBottom.current = true
    }
    setSubagents(null)
    setRaw(null)
    setTab(v)
    tabRef.current = v
    report({ slug: openSlug, id: s.id, title: s.title, view: v })
    if (s.oversized) return
    api.session(root, openSlug, s.id).then((d) => setSessionData(d)).catch((e) => setError(e.message))
  }

  const refetchActive = useCallback(() => {
    const a = activeRef.current
    const r = rootRef.current
    const slug = openSlugRef.current
    if (!a || !slug) return
    api.session(r, slug, a.id).then((d) => setSessionData(d)).catch(() => {})
    if (tabRef.current === 'subagents') api.subagents(r, slug, a.id).then((d) => setSubagents({ ...d, _for: a.id })).catch(() => {})
    if (tabRef.current === 'raw') api.raw(r, slug, a.id).then(setRaw).catch(() => {})
  }, [])

  // the session Stats tab: this folder's stats, drilled to the open session
  useEffect(() => {
    if (!appActive || tab !== 'stats' || !root) return
    let cancelled = false
    api.stats(root).then((d) => !cancelled && setStats(d)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [appActive, tab, root, active?.id])
  const statsFocus = useMemo(() => (active && openSlug ? { slug: openSlug, id: active.id } : null), [active?.id, openSlug])

  // ---- terminals: keep the running list fresh for auto-reattach ----
  const refreshTerminals = useCallback(() => {
    api.terminals().then((d) => setTerminals(d.terminals || [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (!appActive) return
    refreshTerminals()
    const t = setInterval(refreshTerminals, 4000)
    return () => clearInterval(t)
  }, [refreshTerminals, appActive])

  useEffect(() => {
    if (!appActive || !active) return
    const t = setInterval(refetchActive, 3000)
    return () => clearInterval(t)
  }, [appActive, active, refetchActive])

  useEffect(() => {
    if (!appActive) return
    return subscribeToPageResume(() => {
      const r = rootRef.current
      const slug = openSlugRef.current
      refetchActive()
      if (!r) return
      loadProjects(r)
      if (slug) loadSessions(r, slug)
    })
  }, [appActive, loadProjects, loadSessions, refetchActive])

  const activeSessions = useActiveSessions(providers, { enabled: appActive })
  const liveCount = activeSessions.count
  const managerItems = toManagerItems(activeSessions)
  const runningTermKeys = new Set([...terminals.map((t) => t.key), ...activeSessions.tmux.map((t) => t.key).filter(Boolean)])
  const runningSig = [...runningTermKeys].sort().join('|')
  // one TerminalPanel per session that has a terminal, kept mounted while it runs:
  // switching tabs and coming back finds the same iframe instead of a reconnect.
  // The open session always has a panel (collapsed until started).
  const [termPanes, setTermPanes] = useState([])
  const curTermKey = active && root && openSlug ? `${root}|${openSlug}|${active.id}` : null
  useEffect(() => {
    setTermPanes((ps) => {
      const cur = curTermKey ? { key: curTermKey, root, slug: openSlug, id: active.id, title: active.title } : null
      let next = ps.filter((p) => runningTermKeys.has(p.key) || (cur && p.key === cur.key))
      if (cur && !next.some((p) => p.key === cur.key)) next = [...next, cur]
      return next.length === ps.length && next.every((p, i) => p === ps[i]) ? ps : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningSig, curTermKey])
  const shownPanes = curTermKey && !termPanes.some((p) => p.key === curTermKey) ? [...termPanes, { key: curTermKey, root, slug: openSlug, id: active.id, title: active.title }] : termPanes

  const onManagerEnter = (it) => {
    setShowLive(false)
    onOpenSession?.(it.provider, { root: it.root, slug: it.slug, id: it.id, cwd: it.cwd, title: it.title, kind: 'tmux', draft: !it.id })
  }
  const onManagerClose = (it) => {
    fetch(`/api/${it.provider}/terminal?key=${encodeURIComponent(it.key)}`, { method: 'DELETE' })
      .then(refreshTerminals)
      .catch(refreshTerminals)
  }


  // tell the shell where this app is whenever it's on screen without being
  // steered by it (first paint, folder switch) so the tab label matches
  useEffect(() => {
    if (!appActive || pendingOpen || !root) return
    report(currentTarget(tabRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appActive, root])

  // ---- consume a shell "show this" request ----
  const consumedPendingRef = useRef(null)
  useEffect(() => {
    if (!appActive || !pendingOpen) {
      consumedPendingRef.current = null
      return
    }
    const sig = `${pendingOpen.root}|${pendingOpen.slug}|${pendingOpen.id || ''}|${pendingOpen.view || ''}|${pendingOpen.seq || ''}`
    if (consumedPendingRef.current === sig) return
    const done = () => {
      consumedPendingRef.current = sig
      onConsumedPending?.()
    }
    const view = VIEWS.has(pendingOpen.view) ? pendingOpen.view : null
    // 1. switch root if needed (reloads projects/sessions async)
    if (pendingOpen.root && root !== pendingOpen.root) {
      if (!rootsRef.current.some((r) => r.id === pendingOpen.root)) reloadRoots().catch(() => {})
      setRoot(pendingOpen.root)
      return
    }
    // 2. a "new conversation" draft: show it and let TerminalPanel reattach its
    //    tmux by the same key postTerminal used
    if (!pendingOpen.id && (pendingOpen.draft || pendingOpen.kind === 'tmux' || pendingOpen.newConversation) && (pendingOpen.slug || pendingOpen.cwd)) {
      if (pendingOpen.slug && openSlug !== pendingOpen.slug) openProject(pendingOpen.slug)
      rememberPane()
      setActive(null)
      setSessionData(null)
      setTermDraft(
        pendingOpen.slug
          ? { root: pendingOpen.root, slug: pendingOpen.slug, title: pendingOpen.title || 'New conversation' }
          : { root: pendingOpen.root, cwd: pendingOpen.cwd, title: pendingOpen.title || 'New project' }
      )
      setTab('conversation')
      tabRef.current = 'conversation'
      if (pendingOpen.newConversation) report({ slug: pendingOpen.slug, cwd: pendingOpen.cwd, draft: true, title: 'New conversation', view: 'conversation' })
      done()
      return
    }
    // 3. open the project once the root matches
    if (pendingOpen.slug && openSlug !== pendingOpen.slug) {
      openProject(pendingOpen.slug)
      return
    }
    // 4. select the exact session (unless already on screen), restore the view
    if (pendingOpen.id && active?.id !== pendingOpen.id) {
      const s = sessions.find((x) => x.id === pendingOpen.id)
      if (s) selectSession(s, { view })
      else if (loadedSessionsFor.current === `${root}|${openSlug}` && !loadingSessions) setError(`Session ${String(pendingOpen.id).slice(0, 8)}… is no longer in this project (trashed?)`)
      else return
    } else if (pendingOpen.id) {
      if (view && tabRef.current !== view) {
        setTab(view)
        tabRef.current = view
      }
    } else {
      // a folder- or project-level tab shows no session
      if (activeRef.current || termDraftRef.current) {
        rememberPane()
        setActive(null)
        setSessionData(null)
        setSubagents(null)
        setRaw(null)
        setTermDraft(null)
      }
      const v = view === 'config' || view === 'memory' ? view : 'conversation'
      if (tabRef.current !== v) {
        setTab(v)
        tabRef.current = v
      }
    }
    done()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appActive, pendingOpen, root, openSlug, sessions, active, loadingSessions])

  // ---- lazy tab data ----
  useEffect(() => {
    if (tab === 'raw' && active && (!raw || raw.id !== active.id)) {
      api.raw(root, openSlug, active.id).then(setRaw).catch((e) => setError(e.message))
    }
    if (tab === 'subagents' && active && subagents?._for !== active.id) {
      api.subagents(root, openSlug, active.id).then((d) => setSubagents({ ...d, _for: active.id })).catch((e) => setError(e.message))
    }
  }, [tab, active, root, openSlug, raw, subagents])

  // ---- usage limits (5h / weekly), bridged from the status line ----
  const loadUsage = useCallback(() => {
    const r = rootRef.current
    if (!r) return
    api.usage(r).then((d) => setUsage(d)).catch(() => {})
  }, [])
  useEffect(() => {
    if (!appActive) return
    if (!root) {
      setUsage(null)
      return
    }
    loadUsage()
    const t = setInterval(loadUsage, 30000)
    return () => clearInterval(t)
  }, [root, loadUsage, appActive])
  useEffect(() => {
    if (!appActive) return
    if (lastEvent) loadUsage()
  }, [lastEvent, loadUsage, appActive])

  // ---- live SSE ----
  useEffect(() => {
    if (!appActive) return
    const es = new EventSource('/events')
    let pendingActive = false
    let pendingOpenProject = false
    let pendingProjects = false
    const scheduleRefresh = createDebounceWithMaxWait(
      () => {
        const r = rootRef.current
        const slug = openSlugRef.current
        if (pendingActive) refetchActive()
        if (pendingOpenProject && r && slug) loadSessions(r, slug)
        if (pendingProjects && r) loadProjects(r)
        pendingActive = pendingOpenProject = pendingProjects = false
      },
      { waitMs: 300, maxWaitMs: 1000 }
    )
    es.onopen = () => {
      setConn('live')
      const r = rootRef.current
      const slug = openSlugRef.current
      refetchActive()
      if (r) {
        loadProjects(r)
        if (slug) loadSessions(r, slug)
      }
    }
    es.onerror = () => setConn('reconnecting')
    es.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'hello') return setConn('live')
      if (msg.type !== 'change') return
      const providerChanges = (msg.changes || []).filter((c) => c.provider === 'claude')
      if (!providerChanges.length) return
      setLastEvent(Date.now())
      setSessionVersions((prev) => bumpSessionVersions(prev, providerChanges))
      const r = rootRef.current
      const relevant = providerChanges.filter((c) => c.root === r)
      if (!relevant.length) return
      const a = activeRef.current
      const slug = openSlugRef.current
      pendingActive ||= !!(a && relevant.some((c) => c.slug === slug && c.id === a.id))
      pendingOpenProject ||= !!(slug && relevant.some((c) => c.slug === slug))
      pendingProjects = true
      scheduleRefresh()
    }
    return () => {
      scheduleRefresh.cancel()
      es.close()
    }
  }, [refetchActive, loadSessions, loadProjects, appActive])

  // ---- auto-scroll on live tail ----
  const onMainScroll = () => {
    const el = mainRef.current
    if (!el) return
    stickBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
  }
  useLayoutEffect(() => {
    const el = mainRef.current
    if (tab !== 'conversation' || !el || !sessionData) return
    if (restoreScroll.current != null) {
      el.scrollTop = restoreScroll.current
      restoreScroll.current = null
    } else if (stickBottom.current) el.scrollTop = el.scrollHeight
  }, [sessionData, tab])

  const sinceEvent = lastEvent ? Math.round((Date.now() - lastEvent) / 1000) : null
  const termCtxUsed =
    usage?.sessionId && active && usage.sessionId === active.id && typeof usage.contextWindow?.used_percentage === 'number'
      ? Math.min(100, Math.round(usage.contextWindow.used_percentage))
      : null
  const disabledTab = (t) =>
    (t.need === 'session' && !active) || (t.need === 'subagents' && !hasSubagentsNow(active, sessions)) || (t.need === 'project' && !openSlug)

  return (
    <main className="h-full flex flex-col min-w-0">
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800 bg-ink-900/70 overflow-x-auto whitespace-nowrap [&>*]:shrink-0">
        <div className="flex gap-1 items-center">
          {SESSION_TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => changeTab(t.k)}
              disabled={disabledTab(t)}
              className={`text-[13px] px-3 py-1.5 rounded-md ${tab === t.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <RateLimitsBar usage={usage?.rateLimits} />
          <InfoDot text="Claude never writes usage to disk — it only exposes rate limits to the status line. Install the usage-bar skill, then an active Claude session has to hit the status line before the 5h / 7d meters appear here." />
        </div>
        {liveCount > 0 && (
          <button onClick={() => setShowLive(true)} title="Manage running terminals" className="flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live ({liveCount})
          </button>
        )}
        <a href="https://code.claude.com/docs" target="_blank" rel="noreferrer" className="text-[12px] text-zinc-500 hover:text-sky-400" title="Claude Code documentation">docs ↗</a>
        <div className="flex items-center gap-2 text-[12px]">
          <span className={`w-2 h-2 rounded-full ${conn === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className="text-zinc-500">
            {conn === 'live' ? 'live' : 'reconnecting'}
            {sinceEvent != null && conn === 'live' ? ` · ${sinceEvent}s ago` : ''}
          </span>
        </div>
      </div>

      {error && (
        <div className="m-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3 flex justify-between shrink-0">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400">×</button>
        </div>
      )}
      {/* the conversation stays mounted (hidden) while another tab shows, so its
          scroll position and expanded threads are exactly where the reader left them */}
      <ErrorBoundary label="this conversation" resetKey={`conv|${root}|${openSlug || ''}|${active?.id || ''}`}>
        <div className={tab === 'conversation' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
          <div ref={mainRef} onScroll={onMainScroll} className="flex-1 overflow-y-auto">
              {termDraft ? (
                <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-4">New conversation — interact in the terminal below.</div>
              ) : sessionData ? (
                <Conversation key={active?.id} data={sessionData} subagentCtx={subagentCtx} />
              ) : (
                <Empty active={active} />
              )}
            </div>
            {termDraft ? (
              <TerminalPanel root={termDraft.root} slug={termDraft.slug} cwd={termDraft.cwd} title={termDraft.title} isNew onClose={() => setTermDraft(null)} onChange={refreshTerminals} runningKeys={runningTermKeys} onOpenTool={(what) => api.open(termDraft.root, termDraft.slug || null, null, what, termDraft.cwd)} />
            ) : (
              shownPanes.map((p) => {
                const isCur = p.key === curTermKey
                return (
                  <div key={p.key} className={isCur ? 'contents' : 'hidden'}>
                    <TerminalPanel root={p.root} slug={p.slug} id={p.id} title={isCur ? active.title : p.title} contextUsed={isCur ? termCtxUsed : null} onChange={refreshTerminals} runningKeys={runningTermKeys} onOpenTool={(what) => api.open(p.root, p.slug, p.id, what)} />
                  </div>
                )
              })
            )}
        </div>
      </ErrorBoundary>
      {tab !== 'conversation' && (
        <div className="flex-1 overflow-y-auto">
          <ErrorBoundary label="this view" resetKey={`view|${tab}`}>
            {tab === 'subagents' && <SubagentsView key={(active && active.id) || 'none'} data={subagents} version={active ? getSessionVersion(sessionVersions, 'claude', root, active.id) : 0} active={appActive} />}
            {tab === 'raw' && raw && <RawView records={raw.records} />}
            {tab === 'stats' && active && openSlug && <Stats apiClient={api} root={root} stats={stats} focus={statsFocus} onOpenSession={(slug, s) => onOpenSession?.('claude', { root, slug, id: s.id, title: s.title })} />}
            {tab === 'memory' && root && openSlug && <MemoryView key={`mem-${root}-${openSlug}`} root={root} slug={openSlug} />}
            {tab === 'config' && root && openSlug && <Resources key={`cfg-${root}-${openSlug}`} root={root} slug={openSlug} />}
          </ErrorBoundary>
        </div>
      )}

      {showLive && <LiveSessionsPanel items={managerItems} providers={providers} title="Live sessions" onEnter={onManagerEnter} onClose={onManagerClose} onClosePanel={() => setShowLive(false)} />}
    </main>
  )
}

function Empty({ active }) {
  if (active?.oversized) {
    return (
      <div className="h-full flex items-center justify-center text-center text-zinc-600 px-6">
        <div>
          <div className="flex justify-center mb-3 text-amber-400/80 text-3xl">⚠</div>
          <div className="text-sm text-zinc-400">{active.title}</div>
          <div className="text-[12px] mt-1 text-zinc-600">This transcript exceeds the parse limit, so it can't be displayed. Other sessions are unaffected.</div>
        </div>
      </div>
    )
  }
  return (
    <div className="h-full flex items-center justify-center text-center text-zinc-600">
      <div>
        <div className="flex justify-center mb-3 text-zinc-700"><ActivityIcon className="w-10 h-10" /></div>
        <div className="text-sm">{active ? 'Loading session…' : 'Pick a project on the left, or press Ctrl+K to jump anywhere.'}</div>
        <div className="text-[12px] mt-1 text-zinc-700">Live updates stream in as Claude writes to disk.</div>
        {!active && <ShortcutChips className="justify-center mt-5 max-w-lg mx-auto" />}
      </div>
    </div>
  )
}
