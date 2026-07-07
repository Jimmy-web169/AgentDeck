import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Sidebar from './components/shared/Sidebar.jsx'
import Conversation from './components/claude/Conversation.jsx'
import RawView from './components/shared/RawView.jsx'
import Stats from './components/shared/Stats.jsx'
import SubagentsView from './components/claude/SubagentsView.jsx'
import Resources from './components/claude/Resources.jsx'
import RootsManager from './components/shared/RootsManager.jsx'
import MemoryView from './components/claude/MemoryView.jsx'
import HistoryView from './components/shared/HistoryView.jsx'
import PluginsView from './components/claude/PluginsView.jsx'
import MultiSession from './components/claude/MultiSession.jsx'
import ChatComposer from './components/shared/ChatComposer.jsx'
import TerminalPanel from './components/claude/TerminalPanel.jsx'
import LiveSessionsPanel from './components/shared/LiveSessionsPanel.jsx'
import useLiveChatStore, { keyOf as liveKeyOf } from './lib/store.claude.js'
import useActiveSessions, { toManagerItems } from './lib/useActiveSessions.js'
import { ActivityIcon } from './components/shared/icons.jsx'
import RateLimitsBar from './components/claude/RateLimitsBar.jsx'
import InfoDot from './components/shared/InfoDot.jsx'

const LIVE_MS = 8000

// Session/project-scoped views — shown in the main tab bar when a session is
// open. Kept identical to the Codex session tabs.
const SESSION_TABS = [
  { k: 'conversation', need: 'session', label: 'Conversation' },
  { k: 'subagents', need: 'subagents', label: 'Sub-agents' },
  { k: 'raw', need: 'session', label: 'Raw' },
  { k: 'config', need: 'project', label: 'Config' },
]

// Folder(root)-scoped views — reached from the sidebar, not the per-session tab
// bar. Order kept in sync with the Codex global views. Memory lives here even
// though Claude stores it per project (projects/<slug>/memory/) — the view just
// picks a project; the per-project data model is unchanged.
const GLOBAL_VIEWS = [
  { k: 'stats', label: 'Stats' },
  { k: 'history', label: 'History' },
  { k: 'memory', label: 'Memory' },
  { k: 'plugins', label: 'Plugins' },
  { k: 'resources', label: 'Resources' },
]

// identity of an open multi-session entry (stable across tab close + cross-root)
const mkKey = (s) => `${s.root}|${s.slug}|${s.id}`

export default function App({ active: appActive = true, provider, onProvider, providers, onLogo, onOpenSession, pendingOpen, onConsumedPending }) {
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
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState(null)
  const [plugins, setPlugins] = useState(null)
  const [usage, setUsage] = useState(null)
  const [tab, setTab] = useState('conversation')
  const [statsFocus, setStatsFocus] = useState(null) // {slug,id} deep-link into the Stats tab (Session → Stats); fresh object per click
  const [liveIds, setLiveIds] = useState(() => new Set())
  const [conn, setConn] = useState('connecting')
  const [lastEvent, setLastEvent] = useState(0)
  const [error, setError] = useState(null)
  const [showRoots, setShowRoots] = useState(false)
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem('cm_sidebarW'))
    return v >= 220 && v <= 600 ? v : 320
  })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('cm_collapsed') === '1')
  const [multiMode, setMultiMode] = useState(false)
  const [openSessions, setOpenSessions] = useState([]) // [{root, slug, id, title}] — root per entry
  const [sessionVersions, setSessionVersions] = useState({}) // id -> bump count (live refetch)
  const [panes, setPanes] = useState(2) // multi-session split count
  const [paneKeys, setPaneKeys] = useState([]) // which open session each pane shows
  // continue-conversation chat: default permission mode persists; live chats are
  // held in a persistent store (survive navigation); showLive = manager modal.
  const [chatMode, setChatMode] = useState(() => localStorage.getItem('cm_chatMode') || 'acceptEdits')
  const [showLive, setShowLive] = useState(false)
  const [draftKey, setDraftKey] = useState(null) // a "new conversation" being composed (not yet a saved session)
  const [engine, setEngine] = useState(() => localStorage.getItem('cm_engine') || 'sdk') // 'sdk' | 'terminal'; in-app toggle persists, .env is just the first-run default
  const [termDraft, setTermDraft] = useState(null) // terminal-mode new conversation target { slug? cwd? }
  const [terminals, setTerminals] = useState([]) // running ttyd terminals (terminal mode) — for the manager

  const rootRef = useRef(null)
  const activeRef = useRef(null)
  const openSlugRef = useRef(null)
  const tabRef = useRef(tab)
  const mainRef = useRef(null)
  const stickBottom = useRef(true)
  const refetchTimer = useRef(null)
  const liveTimers = useRef(new Map())
  const liveSessionsRef = useRef({}) // mirror of live.sessions for refs-based callbacks
  const activeKeyRef = useRef(null)
  const pendingJump = useRef(null) // cross-root live-log jump, consumed after root switches
  const engineRef = useRef('sdk')

  useEffect(() => void (rootRef.current = root), [root])
  useEffect(() => void (activeRef.current = active), [active])
  useEffect(() => void (openSlugRef.current = openSlug), [openSlug])
  useEffect(() => void (tabRef.current = tab), [tab])
  useEffect(() => void (engineRef.current = engine), [engine])

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

  const loadProjects = useCallback((r) => {
    if (!r) return
    api.projects(r).then((d) => setProjects(d.projects)).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!appActive) return
    if (!root) return
    loadProjects(root)
    setOpenSlug(null)
    setSessions([])
    setActive(null)
    setSessionData(null)
    setSubagents(null)
    setStats(null)
    setStatsFocus(null) // a stale focus would drill into a slug that isn't in the new folder
    setHistory(null)
    setPlugins(null)
  }, [root, loadProjects, appActive])

  // ---- sessions ----
  const loadSessions = useCallback((r, slug) => {
    setLoadingSessions(true)
    api
      .sessions(r, slug)
      .then((d) => setSessions(d.sessions))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingSessions(false))
  }, [])

  const openProject = (slug) => {
    setDraftKey(null) // stop viewing a draft when changing projects (it keeps running)
    setTermDraft(null)
    setOpenSlug(slug)
    if (slug) loadSessions(root, slug)
  }

  const selectSession = (s) => {
    setMultiMode(false) // selecting a session leaves the compare workspace
    setDraftKey(null) // stop viewing any draft (its live chat keeps running in the store)
    setTermDraft(null)
    setActive(s)
    setSessionData(null)
    setSubagents(null)
    setRaw(null)
    setTab('conversation')
    stickBottom.current = true
    // if this session has a live chat, the store owns its transcript — don't refetch
    if (liveSessionsRef.current[liveKeyOf({ root, slug: openSlug, id: s.id })]) return
    api.session(root, openSlug, s.id).then((d) => setSessionData(d)).catch((e) => setError(e.message))
  }

  // move a session to the OS trash (recoverable), then clear it everywhere it
  // might be open — the active pane, and the multi-session workspace
  const removeSession = async (s) => {
    try {
      await api.deleteSession(root, openSlug, s.id)
    } catch (e) {
      setError(e.message)
      return
    }
    if (activeRef.current?.id === s.id) {
      setActive(null)
      setSessionData(null)
      setSubagents(null)
      setRaw(null)
    }
    setOpenSessions((prev) => prev.filter((x) => !(x.root === root && x.slug === openSlug && x.id === s.id)))
    loadSessions(root, openSlug)
    loadProjects(root)
  }

  // add a session to the multi-session workspace (captures the current root)
  const addToWorkspace = (s) => {
    const entry = { root, slug: openSlug, id: s.id, title: s.title }
    setOpenSessions((prev) =>
      prev.some((x) => x.root === entry.root && x.slug === entry.slug && x.id === entry.id) ? prev : [...prev, entry]
    )
    setMultiMode(true)
  }
  const setPaneKey = (i, k) => setPaneKeys((prev) => prev.map((x, j) => (j === i ? k || null : x)))
  const closeOpenSession = (k) => setOpenSessions((prev) => prev.filter((s) => mkKey(s) !== k))

  // keep pane assignments valid as the open set / split count changes
  useEffect(() => {
    setPaneKeys((prev) => {
      const openKeys = openSessions.map(mkKey)
      const openSet = new Set(openKeys)
      const next = prev.slice(0, panes)
      while (next.length < panes) next.push(null)
      for (let i = 0; i < next.length; i++) if (next[i] && !openSet.has(next[i])) next[i] = null
      const used = new Set(next.filter(Boolean))
      for (let i = 0; i < next.length; i++) {
        if (!next[i]) {
          const cand = openKeys.find((k) => !used.has(k))
          if (cand) {
            next[i] = cand
            used.add(cand)
          }
        }
      }
      return next
    })
  }, [openSessions, panes])

  const refetchActive = useCallback(() => {
    if (liveSessionsRef.current[activeKeyRef.current]) return // live store owns this session's transcript
    const a = activeRef.current
    const r = rootRef.current
    const slug = openSlugRef.current
    if (!a || !slug) return
    api.session(r, slug, a.id).then((d) => setSessionData(d)).catch(() => {})
    if (tabRef.current === 'subagents') {
      api.subagents(r, slug, a.id).then((d) => setSubagents({ ...d, _for: a.id })).catch(() => {})
    }
  }, [])

  // ---- continue-conversation chat (persistent store) ----
  useEffect(() => localStorage.setItem('cm_chatMode', chatMode), [chatMode])

  const live = useLiveChatStore()
  useEffect(() => void (liveSessionsRef.current = live.sessions), [live.sessions])

  // terminal mode: keep the running-terminals list fresh for the manager + auto-reattach
  const refreshTerminals = useCallback(() => {
    api.terminals().then((d) => setTerminals(d.terminals || [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (!appActive) return
    if (engine !== 'terminal') {
      setTerminals([])
      return
    }
    refreshTerminals()
    const t = setInterval(refreshTerminals, 4000)
    return () => clearInterval(t)
  }, [engine, refreshTerminals, appActive])

  // Fallback poll: keep the conversation you're viewing fresh even if a file-watch
  // event is missed or the CLI buffers its writes to disk. SSE stays the fast path;
  // this only guarantees the open transcript never goes stale. refetchActive already
  // no-ops for live-SDK chats (the store owns those) and when nothing is open.
  useEffect(() => {
    if (!appActive || !active) return
    const t = setInterval(refetchActive, 3000)
    return () => clearInterval(t)
  }, [appActive, active, refetchActive])

  const activeKey = active && openSlug ? liveKeyOf({ root, slug: openSlug, id: active.id }) : null
  useEffect(() => void (activeKeyRef.current = activeKey), [activeKey])
  const activeSlice = activeKey ? live.sessions[activeKey] : null
  const rootLabels = Object.fromEntries(roots.map((r) => [r.id, r.label]))

  // Unified Live source (server-side, cross-provider, persistent): running tmux
  // terminals + persisted SDK continue-chats. The right-hand Live button, the
  // composer's Live button and the Dashboard all read this same list/count, so
  // they're consistent regardless of which provider/engine is active.
  const activeSessions = useActiveSessions(providers, { enabled: appActive })
  const liveCount = activeSessions.count
  const managerItems = toManagerItems(activeSessions)
  // A target is "reattachable" if a ttyd is already running for it (in-memory
  // pool) OR a detached tmux session is alive for it — the latter survives a
  // server restart / browser close and is what the Live panel lists. Opening the
  // panel re-attaches a ttyd to the existing tmux, so "Enter" actually shows the
  // terminal instead of leaving the user on an "Open terminal" button.
  const runningTermKeys = new Set([
    ...terminals.map((t) => t.key),
    ...activeSessions.tmux.map((t) => t.key).filter(Boolean),
  ])

  // switch chat engine in-app (persists to localStorage; no server restart / .env edit)
  const switchEngine = (e) => {
    if (e === engine) return
    localStorage.setItem('cm_engine', e)
    setDraftKey(null)
    setTermDraft(null)
    setEngine(e)
  }

  // Enter a terminal (possibly another provider's): hand off to the shell, which
  // switches provider + tells that app to open it in terminal mode (reattaches).
  const onManagerEnter = (it) => {
    setShowLive(false)
    onOpenSession?.(it.provider, { root: it.root, slug: it.slug, id: it.id, cwd: it.cwd, title: it.title, kind: 'tmux', engine: 'terminal' })
  }
  // End a terminal: kill its tmux session (its own provider, cross-provider).
  const onManagerClose = (it) => {
    fetch(`/api/${it.provider}/terminal?key=${encodeURIComponent(it.key)}`, { method: 'DELETE' })
      .then(refreshTerminals)
      .catch(refreshTerminals)
  }

  // what the conversation pane shows: a "new conversation" draft takes precedence
  // over the selected session; both render the same way (transcript + overlay).
  const viewKey = draftKey || activeKey
  const viewSlice = viewKey ? live.sessions[viewKey] : null
  const convData = viewSlice?.transcript || (draftKey ? null : sessionData)

  const startNewConversation = useCallback((slug) => {
    const r = rootRef.current
    if (!r || !slug) return
    setMultiMode(false)
    setTab('conversation')
    stickBottom.current = true
    if (engineRef.current === 'terminal') setTermDraft({ root: r, slug, title: 'New conversation' })
    else setDraftKey(live.openNew({ root: r, slug, title: 'New conversation' }))
  }, [live])

  // start a brand-new conversation in an arbitrary folder (new project)
  const startNewProject = useCallback((cwd) => {
    const r = rootRef.current
    if (!r || !cwd) return
    setMultiMode(false)
    setTab('conversation')
    stickBottom.current = true
    const title = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).slice(-1)[0] || 'New project'
    if (engineRef.current === 'terminal') setTermDraft({ root: r, cwd, title })
    else setDraftKey(live.openNew({ root: r, cwd, title }))
  }, [live])

  // jump back to a session from the live-log (may live under a different root)
  const jumpToSession = useCallback((e) => {
    if (!e) return
    setMultiMode(false)
    setTab('conversation')
    if (e.root && e.root !== rootRef.current) {
      pendingJump.current = e
      setRoot(e.root)
      return
    }
    setOpenSlug(e.slug)
    loadSessions(e.root, e.slug)
    setActive({ id: e.id, title: e.title })
    setSessionData(null)
    stickBottom.current = true
    api.session(e.root, e.slug, e.id).then(setSessionData).catch(() => {})
  }, [loadSessions])

  // Session → Stats: jump to this session's token stats (mirror of Stats' "Open
  // session ↗"). A fresh focus object each call re-drills even to the same session
  // after the user has navigated back up the Stats breadcrumb.
  const viewSessionStats = () => {
    if (!active || !openSlug) return
    setMultiMode(false)
    setStatsFocus({ slug: openSlug, id: active.id })
    setTab('stats')
  }

  // finish a cross-root jump once the root switch has cleared state
  useEffect(() => {
    const e = pendingJump.current
    if (e && e.root === root) {
      pendingJump.current = null
      setOpenSlug(e.slug)
      loadSessions(e.root, e.slug)
      setActive({ id: e.id, title: e.title })
      setSessionData(null)
      stickBottom.current = true
      api.session(e.root, e.slug, e.id).then(setSessionData).catch(() => {})
    }
  }, [root, loadSessions])

  // ---- consume a cross-provider Dashboard "open this" request ----
  // Drives root → project → session in steps as the async loads settle; guards
  // against firing onConsumedPending more than once per request.
  const consumedPendingRef = useRef(null)
  useEffect(() => {
    if (!appActive || !pendingOpen) {
      consumedPendingRef.current = null
      return
    }
    const sig = `${pendingOpen.root}|${pendingOpen.slug}|${pendingOpen.id || ''}`
    if (consumedPendingRef.current === sig) return
    // 0. switch engine (terminal vs sdk) so the right surface shows; terminal
    //    auto-reattaches its tmux by key, sdk shows the transcript (read from
    //    disk) and reconnects when you send the next message.
    if (pendingOpen.engine && engine !== pendingOpen.engine) switchEngine(pendingOpen.engine)
    // 1. switch root if needed (reloads projects/sessions async)
    if (pendingOpen.root && root !== pendingOpen.root) {
      setRoot(pendingOpen.root)
      return
    }
    // 2. id-less terminal entry (a "new conversation"/"new project" terminal from
    //    the Live panel): there is no saved session to select, so show its draft
    //    and let TerminalPanel mount + reattach the running tmux. Rebuild the same
    //    key postTerminal used — slug-keyed → `${root}|new|${slug}`, else cwd-keyed
    //    → `${root}|new|${cwd}` — so it reattaches the SAME session, not a new one.
    if (pendingOpen.engine === 'terminal' && !pendingOpen.id && (pendingOpen.slug || pendingOpen.cwd)) {
      if (pendingOpen.slug && openSlug !== pendingOpen.slug) openProject(pendingOpen.slug)
      setTermDraft(
        pendingOpen.slug
          ? { root: pendingOpen.root, slug: pendingOpen.slug, title: pendingOpen.title || 'New conversation' }
          : { root: pendingOpen.root, cwd: pendingOpen.cwd, title: pendingOpen.title || 'New project' }
      )
      setTab('conversation')
      consumedPendingRef.current = sig
      onConsumedPending?.()
      return
    }
    // 3. open the project once the root matches
    if (openSlug !== pendingOpen.slug) {
      openProject(pendingOpen.slug)
      return
    }
    // 4. project is open — try to select the exact session, then consume
    if (pendingOpen.id) {
      const s = sessions.find((x) => x.id === pendingOpen.id)
      if (s) selectSession(s)
      else return // wait for sessions to load
    }
    consumedPendingRef.current = sig
    onConsumedPending?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appActive, pendingOpen, root, openSlug, sessions])

  // ---- lazy tab data ----
  useEffect(() => {
    if (tab === 'raw' && active && (!raw || raw.id !== active.id)) {
      api.raw(root, openSlug, active.id).then(setRaw).catch((e) => setError(e.message))
    }
    if (tab === 'subagents' && active && subagents?._for !== active.id) {
      api.subagents(root, openSlug, active.id).then((d) => setSubagents({ ...d, _for: active.id })).catch((e) => setError(e.message))
    }
    if (tab === 'stats' && root) {
      api.stats(root).then(setStats).catch((e) => setError(e.message))
    }
    if (tab === 'history' && root) {
      api.history(root).then(setHistory).catch((e) => setError(e.message))
    }
    if (tab === 'plugins' && root) {
      api.plugins(root).then(setPlugins).catch((e) => setError(e.message))
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
  // refresh shortly after live activity (e.g. a terminal turn refreshed the file)
  useEffect(() => {
    if (!appActive) return
    if (lastEvent) loadUsage()
  }, [lastEvent, loadUsage, appActive])

  // ---- live SSE ----
  useEffect(() => {
    if (!appActive) return
    const es = new EventSource('/events')
    es.onopen = () => setConn('live')
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
      setLastEvent(Date.now())
      // bump version for every changed session id (any root) so multi-session
      // panes — including cross-folder ones — refetch live.
      setSessionVersions((v) => {
        const n = { ...v }
        for (const c of msg.changes) if (c.id) n[c.id] = (n[c.id] || 0) + 1
        return n
      })
      const r = rootRef.current
      const relevant = msg.changes.filter((c) => c.root === r)
      if (!relevant.length) return

      setLiveIds((prev) => {
        const next = new Set(prev)
        for (const c of relevant) {
          if (!c.id) continue
          next.add(c.id)
          const old = liveTimers.current.get(c.id)
          if (old) clearTimeout(old)
          liveTimers.current.set(
            c.id,
            setTimeout(() => {
              setLiveIds((p) => {
                const n = new Set(p)
                n.delete(c.id)
                return n
              })
              liveTimers.current.delete(c.id)
            }, LIVE_MS)
          )
        }
        return next
      })

      const a = activeRef.current
      const slug = openSlugRef.current
      const hitsActive = a && relevant.some((c) => c.slug === slug && c.id === a.id)
      const hitsOpenProject = slug && relevant.some((c) => c.slug === slug)
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => {
        if (hitsActive) refetchActive()
        if (hitsOpenProject) loadSessions(rootRef.current, slug)
        loadProjects(rootRef.current)
      }, 300)
    }
    return () => es.close()
  }, [refetchActive, loadSessions, loadProjects, appActive])

  // ---- auto-scroll on live tail ----
  const onMainScroll = () => {
    const el = mainRef.current
    if (!el) return
    stickBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
  }
  useEffect(() => {
    if (tab === 'conversation' && stickBottom.current && mainRef.current) {
      mainRef.current.scrollTop = mainRef.current.scrollHeight
    }
  }, [sessionData, tab, activeSlice?.items])

  // persist + drag-to-resize the sidebar
  useEffect(() => localStorage.setItem('cm_sidebarW', String(sidebarW)), [sidebarW])
  useEffect(() => localStorage.setItem('cm_collapsed', collapsed ? '1' : '0'), [collapsed])
  // ⌘/Ctrl+B toggles the sidebar (VS Code-style)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const startDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarW
    document.body.style.userSelect = 'none'
    const move = (ev) => setSidebarW(Math.min(600, Math.max(220, startW + ev.clientX - startX)))
    const up = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const sinceEvent = lastEvent ? Math.round((Date.now() - lastEvent) / 1000) : null
  // current terminal session's context% used — only when the bridge snapshot's
  // session_id matches the session whose terminal is on screen.
  const termCtxUsed =
    usage?.sessionId && active && usage.sessionId === active.id && typeof usage.contextWindow?.used_percentage === 'number'
      ? Math.min(100, Math.round(usage.contextWindow.used_percentage))
      : null
  const isGlobal = GLOBAL_VIEWS.some((g) => g.k === tab)
  const rootLabel = roots.find((r) => r.id === root)?.label || ''
  const disabledTab = (t) =>
    (t.need === 'session' && !active) ||
    (t.need === 'subagents' && !(active && active.hasSubagents)) ||
    (t.need === 'project' && !openSlug)

  return (
    <div className="h-full flex">
      {!collapsed && (
        <div style={{ width: sidebarW }} className="shrink-0 h-full min-w-0">
          <Sidebar
        providers={providers}
        provider={provider}
        onProvider={onProvider}
        onLogo={onLogo}
        roots={roots}
        root={root}
        onRoot={setRoot}
        projects={projects}
        openSlug={openSlug}
        onOpenProject={openProject}
        sessions={sessions}
        activeSession={active}
        onSelectSession={selectSession}
        loadingSessions={loadingSessions}
        liveIds={liveIds}
        onManageRoots={() => setShowRoots(true)}
        globalViews={GLOBAL_VIEWS}
        activeGlobal={!multiMode && isGlobal ? tab : null}
        onGlobalView={(k) => {
          setMultiMode(false) // a folder view leaves the compare workspace
          setStatsFocus(null) // a sidebar Stats click starts at the folder level
          setTab(k)
        }}
        onAddSession={addToWorkspace}
        onDeleteSession={removeSession}
        onNewConversation={startNewConversation}
        onNewProject={startNewProject}
          />
        </div>
      )}
      {!collapsed && (
        <div onMouseDown={startDrag} className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-sky-500/60" title="Drag to resize sidebar" />
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800 bg-ink-900/70 overflow-x-auto whitespace-nowrap [&>*]:shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} title={`${collapsed ? 'Show' : 'Hide'} sidebar  (⌘/Ctrl+B)`} className="text-zinc-500 hover:text-zinc-200 text-[15px] leading-none px-1 shrink-0">
            {collapsed ? '»' : '«'}
          </button>
          {multiMode ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-zinc-100 font-medium">Multi-session</span>
              <span className="text-zinc-600">· {openSessions.length} open</span>
              <span className="ml-1 text-[11px] text-zinc-600">split</span>
              {[1, 2, 3].map((n) => (
                <button key={n} onClick={() => setPanes(n)} className={`w-6 h-6 rounded text-[12px] ${panes === n ? 'bg-ink-600 text-zinc-100' : 'bg-ink-700 text-zinc-400 hover:text-zinc-200'}`}>
                  {n}
                </button>
              ))}
              <button onClick={() => setMultiMode(false)} className="ml-2 text-[12px] text-sky-400 hover:text-sky-300">exit ←</button>
            </div>
          ) : isGlobal ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-zinc-100 font-medium">{GLOBAL_VIEWS.find((g) => g.k === tab)?.label}</span>
              <span className="text-zinc-600">· folder {rootLabel}</span>
              {active && (
                <button onClick={() => setTab('conversation')} className="ml-2 text-[12px] text-sky-400 hover:text-sky-300">
                  ← back to session
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-1 items-center">
              {SESSION_TABS.map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  disabled={disabledTab(t)}
                  className={`text-[13px] px-3 py-1.5 rounded-md ${tab === t.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  {t.label}
                </button>
              ))}
              {active && (
                <button
                  onClick={viewSessionStats}
                  title="View this session's token stats"
                  className="ml-1 text-[13px] px-3 py-1.5 rounded-md text-sky-400/90 hover:text-sky-300 hover:bg-ink-700/40"
                >
                  Stats →
                </button>
              )}
            </div>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <RateLimitsBar usage={usage?.rateLimits} />
            <InfoDot text="Claude never writes usage to disk — it only exposes rate limits to the status line. Install the usage-bar skill, then an active Claude session has to hit the status line before the 5h / 7d meters appear here." />
          </div>
          {/* chat engine toggle — switch instantly, no .env / restart */}
          <div className="flex items-center rounded border border-zinc-700 overflow-hidden text-[11px]" title="Continue-conversation engine">
            <button onClick={() => switchEngine('sdk')} className={`px-2 py-0.5 ${engine === 'sdk' ? 'bg-ink-500 text-zinc-100' : 'bg-ink-800 text-zinc-500 hover:text-zinc-300'}`}>SDK chat</button>
            <button onClick={() => switchEngine('terminal')} className={`px-2 py-0.5 ${engine === 'terminal' ? 'bg-ink-500 text-zinc-100' : 'bg-ink-800 text-zinc-500 hover:text-zinc-300'}`}>Terminal</button>
          </div>
          {liveCount > 0 && (
            <button onClick={() => setShowLive(true)} title="Manage live conversations" className="flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25">
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
        {multiMode ? (
          <div className="flex-1 min-h-0">
            <MultiSession
              openSessions={openSessions}
              panes={panes}
              paneKeys={paneKeys}
              setPaneKey={setPaneKey}
              onCloseSession={closeOpenSession}
              sessionVersions={sessionVersions}
              rootLabels={rootLabels}
              live={live}
              chatMode={chatMode}
              onChatMode={setChatMode}
              liveCount={liveCount}
              onOpenManager={() => setShowLive(true)}
              engine={engine}
              runningKeys={runningTermKeys}
              onTermChange={refreshTerminals}
            />
          </div>
        ) : tab === 'conversation' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div ref={mainRef} onScroll={onMainScroll} className="flex-1 overflow-y-auto">
              {engine === 'terminal' ? (
                termDraft ? (
                  <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-4">New conversation — interact in the terminal below.</div>
                ) : sessionData ? (
                  <Conversation data={sessionData} />
                ) : (
                  <Empty active={active} />
                )
              ) : convData ? (
                <Conversation
                  data={convData}
                  live={viewSlice ? { items: viewSlice.items, onPerm: (r, bh, scope, answers) => live.respondPerm(viewKey, r, bh, scope, answers) } : null}
                />
              ) : (
                <Empty active={active} />
              )}
            </div>
            {engine === 'terminal' ? (
              termDraft ? (
                <TerminalPanel root={termDraft.root} slug={termDraft.slug} cwd={termDraft.cwd} title={termDraft.title} isNew onClose={() => setTermDraft(null)} onChange={refreshTerminals} runningKeys={runningTermKeys} onOpenTool={(what) => api.open(termDraft.root, termDraft.slug || null, null, what, termDraft.cwd)} />
              ) : active ? (
                <TerminalPanel root={root} slug={openSlug} id={active.id} title={active.title} contextUsed={termCtxUsed} onChange={refreshTerminals} runningKeys={runningTermKeys} onOpenTool={(what) => api.open(root, openSlug, active.id, what)} />
              ) : null
            ) : draftKey ? (
              <ChatComposer
                slice={viewSlice}
                onClose={() => { live.close(draftKey); setDraftKey(null) }}
                mode={chatMode}
                onMode={setChatMode}
                onSend={(t) => live.send(draftKey, t, chatMode)}
                onOpenTool={(what) => api.open(viewSlice?.root || root, viewSlice?.slug || openSlug, viewSlice?.id || null, what, viewSlice?.cwd)}
              />
            ) : (
              active && (activeSlice?.transcript || sessionData) && (
                <ChatComposer
                  slice={activeSlice}
                  onOpen={() => live.open({ root, slug: openSlug, id: active.id, title: active.title }, activeSlice?.transcript || sessionData)}
                  onClose={() => { live.close(activeKey); api.session(root, openSlug, active.id).then(setSessionData).catch(() => {}) }}
                  mode={chatMode}
                  onMode={setChatMode}
                  onSend={(t) => live.send(activeKey, t, chatMode)}
                  onOpenTool={(what) => api.open(root, openSlug, active.id, what)}
                />
              )
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {tab === 'subagents' && <SubagentsView data={subagents} />}
            {tab === 'raw' && raw && <RawView records={raw.records} />}
            {tab === 'memory' && <MemoryView root={root} projects={projects} />}
            {tab === 'stats' && <Stats stats={stats} root={root} focus={statsFocus} onOpenSession={(slug, s) => jumpToSession({ root, slug, id: s.id, title: s.title })} />}
            {tab === 'resources' && root && <Resources key={`res-${root}`} root={root} />}
            {tab === 'config' && root && openSlug && <Resources key={`cfg-${root}-${openSlug}`} root={root} slug={openSlug} />}
            {tab === 'history' && <HistoryView data={history} />}
            {tab === 'plugins' && <PluginsView data={plugins} />}
          </div>
        )}
      </main>

      {showRoots && (
        <RootsManager
          roots={roots}
          onClose={() => setShowRoots(false)}
          onChanged={async () => {
            await reloadRoots()
            loadProjects(rootRef.current)
          }}
        />
      )}

      {showLive && (
        <LiveSessionsPanel
          items={managerItems}
          providers={providers}
          title="Live sessions"
          onEnter={onManagerEnter}
          onClose={onManagerClose}
          onClosePanel={() => setShowLive(false)}
        />
      )}
    </div>
  )
}

function Empty({ active }) {
  return (
    <div className="h-full flex items-center justify-center text-center text-zinc-600">
      <div>
        <div className="flex justify-center mb-3 text-zinc-700"><ActivityIcon className="w-10 h-10" /></div>
        <div className="text-sm">{active ? 'Loading session…' : 'Pick a project on the left, then a session.'}</div>
        <div className="text-[12px] mt-1 text-zinc-700">Live updates stream in as Claude writes to disk.</div>
      </div>
    </div>
  )
}
