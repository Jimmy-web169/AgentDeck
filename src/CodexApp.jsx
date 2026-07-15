import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import Sidebar from './components/shared/Sidebar.jsx'
import Conversation from './components/codex/Conversation.jsx'
import RawView from './components/shared/RawView.jsx'
import Stats from './components/codex/Stats.jsx'
import HistoryView from './components/shared/HistoryView.jsx'
import ResourcesView from './components/codex/ResourcesView.jsx'
import SubagentsView from './components/codex/SubagentsView.jsx'
import MultiSession from './components/codex/MultiSession.jsx'
import MemoryView from './components/codex/MemoryView.jsx'
import PluginsView from './components/codex/PluginsView.jsx'
import ChatComposer from './components/shared/ChatComposer.jsx'
import TerminalPanel from './components/codex/TerminalPanel.jsx'
import OpenAppButtons from './components/shared/OpenAppButtons.jsx'
import LiveSessionsPanel from './components/shared/LiveSessionsPanel.jsx'
import RootsManager from './components/shared/RootsManager.jsx'
import RateLimitsBar from './components/codex/RateLimitsBar.jsx'
import InfoDot from './components/shared/InfoDot.jsx'
import ContextMeter from './components/codex/ContextMeter.jsx'
import useLiveChatStore, { keyOf as liveKeyOf } from './lib/store.codex.js'
import useActiveSessions, { toManagerItems } from './lib/useActiveSessions.js'
import { ActivityIcon } from './components/shared/icons.jsx'

const LIVE_MS = 8000

// codex chat modes (sandbox/approval) for the shared ChatComposer
const CODEX_MODES = [
  { v: 'read-only', label: 'Read-only (safe)' },
  { v: 'auto', label: 'Auto (workspace-write)' },
  { v: 'full-access', label: 'Full access (danger)' },
]
// codex raw-record discriminator (records are wrapped: response_item/event_msg)
const CODEX_RAW_TYPE = (rec) => {
  if (rec?.type === 'response_item' || rec?.type === 'event_msg') return `${rec.type}:${rec.payload?.type || '?'}`
  if (rec?.type) return rec.type
  return rec?.payload?.type || 'other'
}

// Session/project-scoped tabs. `need: 'session'` requires an open session;
// `need: 'project'` only requires an open project (cwd group) — e.g. Config,
// which shows that project's project-scoped .codex/ config.
const SESSION_TABS = [
  { k: 'conversation', need: 'session', label: 'Conversation' },
  { k: 'subagents', need: 'session', label: 'Sub-agents' },
  { k: 'raw', need: 'session', label: 'Raw' },
  { k: 'config', need: 'project', label: 'Config' },
]
// Folder(user)-scoped views — properties of the whole Codex home.
const GLOBAL_VIEWS = [
  { k: 'stats', label: 'Stats' },
  { k: 'history', label: 'History' },
  { k: 'memory', label: 'Memory' },
  { k: 'plugins', label: 'Plugins' },
  { k: 'resources', label: 'Resources' },
]

export default function App({ active: appActive = true, provider, onProvider, providers, onLogo, onOpenSession, pendingOpen, onConsumedPending }) {
  const [roots, setRoots] = useState([])
  const [root, setRoot] = useState(null)
  const [projects, setProjects] = useState([])
  const [openSlug, setOpenSlug] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [active, setActive] = useState(null)
  const [sessionData, setSessionData] = useState(null)
  const [raw, setRaw] = useState(null)
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState(null)
  const [usage, setUsage] = useState(null)
  const [tab, setTab] = useState('conversation')
  const [statsFocus, setStatsFocus] = useState(null) // {slug,id} deep-link into the Stats tab (Session → Stats); fresh object per click
  const [liveIds, setLiveIds] = useState(() => new Set())
  const [conn, setConn] = useState('connecting')
  const [lastEvent, setLastEvent] = useState(0)
  const [error, setError] = useState(null)
  const [showRoots, setShowRoots] = useState(false)
  const [showLive, setShowLive] = useState(false)
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem('cxm_sidebarW'))
    return v >= 220 && v <= 600 ? v : 320
  })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('cxm_collapsed') === '1')
  const [chatMode, setChatMode] = useState(() => localStorage.getItem('cxm_chatMode') || 'auto')
  const [engine, setEngine] = useState(() => localStorage.getItem('cxm_engine') || 'sdk')
  const [draftKey, setDraftKey] = useState(null)
  const [termDraft, setTermDraft] = useState(null)
  const [terminals, setTerminals] = useState([])
  // multi-session (split-pane compare) workspace
  const [multiMode, setMultiMode] = useState(false)
  const [openSessions, setOpenSessions] = useState([]) // [{ root, id, title, cwd }]
  const [panes, setPanes] = useState(1)
  const [paneKeys, setPaneKeys] = useState([]) // key (`root|id`) shown in each pane
  const [sessionVersions, setSessionVersions] = useState({}) // id -> bump counter for live refetch

  const rootRef = useRef(null)
  const activeRef = useRef(null)
  const openSlugRef = useRef(null)
  const tabRef = useRef(tab)
  const mainRef = useRef(null)
  const stickBottom = useRef(true)
  const refetchTimer = useRef(null)
  const listTimer = useRef(null)
  const liveTimers = useRef(new Map())
  const liveSessionsRef = useRef({})
  const activeKeyRef = useRef(null)
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
    setStats(null)
    setStatsFocus(null) // a stale focus would drill into a slug that isn't in the new folder
    setHistory(null)
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
    setDraftKey(null)
    setTermDraft(null)
    setOpenSlug(slug)
    if (slug) loadSessions(root, slug)
  }

  const selectSession = (s) => {
    setMultiMode(false)
    setDraftKey(null)
    setTermDraft(null)
    setActive(s)
    setSessionData(null)
    setRaw(null)
    setTab('conversation')
    stickBottom.current = true
    if (liveSessionsRef.current[liveKeyOf({ root, id: s.id })]) return // live store owns it
    api.session(root, s.id).then((d) => setSessionData(d)).catch((e) => setError(e.message))
  }

  const refetchActive = useCallback(() => {
    if (liveSessionsRef.current[activeKeyRef.current]) return // live store owns this transcript
    const a = activeRef.current
    if (!a) return
    api.session(rootRef.current, a.id).then((d) => setSessionData(d)).catch(() => {})
  }, [])

  // ---- continue-conversation chat (persistent store) ----
  useEffect(() => localStorage.setItem('cxm_chatMode', chatMode), [chatMode])

  const live = useLiveChatStore()
  useEffect(() => void (liveSessionsRef.current = live.sessions), [live.sessions])

  // terminal mode: keep the running-terminals list fresh
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

  // ---- multi-session workspace ----
  const mkKey = (s) => `${s.root}|${s.id}`
  const addToWorkspace = (s) => {
    const entry = { root, id: s.id, title: s.title || (s.id ? s.id.slice(0, 8) : 'session'), cwd: s.cwd || openSlug || null }
    setOpenSessions((prev) => (prev.some((x) => mkKey(x) === mkKey(entry)) ? prev : [...prev, entry]))
    setMultiMode(true)
  }
  const setPaneKeyAt = (i, k) => setPaneKeys((prev) => { const next = [...prev]; next[i] = k; return next })
  const closeOpenSession = (k) => setOpenSessions((prev) => prev.filter((s) => mkKey(s) !== k))
  // keep paneKeys valid as the open set / split count change
  useEffect(() => {
    setPaneKeys((prev) => {
      const keys = openSessions.map(mkKey)
      const next = []
      for (let i = 0; i < panes; i++) {
        const cur = prev[i]
        next[i] = cur && keys.includes(cur) ? cur : keys.find((k) => !next.includes(k)) || ''
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessions, panes])
  // exit the workspace once it's empty
  useEffect(() => {
    if (multiMode && openSessions.length === 0) setMultiMode(false)
  }, [multiMode, openSessions.length])

  const activeKey = active ? liveKeyOf({ root, id: active.id }) : null
  useEffect(() => void (activeKeyRef.current = activeKey), [activeKey])
  const activeSlice = activeKey ? live.sessions[activeKey] : null
  const rootLabels = Object.fromEntries(roots.map((r) => [r.id, r.label]))

  // Unified Live source (server-side, cross-provider, persistent) — same list as
  // the right-hand Live button, the composer's Live button and the Dashboard.
  const activeSessions = useActiveSessions(providers, { enabled: appActive })
  const liveCount = activeSessions.count
  const managerItems = toManagerItems(activeSessions)
  // A target is "reattachable" if a ttyd is already running for it (in-memory
  // pool) OR a detached tmux session is alive for it — the latter survives a
  // server restart / browser close and is what the Live panel lists. The server
  // keys a resumed terminal as `${root}|${id}`; opening the panel re-attaches a
  // ttyd to the existing tmux, so "Enter" actually shows the terminal instead of
  // leaving the user on an "Open terminal" button.
  const runningTermKeys = new Set([
    ...terminals.map((t) => t.key),
    ...activeSessions.tmux.map((t) => t.key).filter(Boolean),
  ])

  const switchEngine = (e) => {
    if (e === engine) return
    localStorage.setItem('cxm_engine', e)
    setDraftKey(null)
    setTermDraft(null)
    setEngine(e)
  }

  // Enter any item (possibly another provider's): hand off to the shell.
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

  // open a session by its id (from Stats/History/manager): fetch it, then sync the
  // sidebar to its project (cwd) so the session list shows it selected.
  const openSessionById = useCallback((id) => {
    const r = rootRef.current
    if (!r || !id) return
    setMultiMode(false)
    setDraftKey(null)
    setTermDraft(null)
    setTab('conversation')
    setSessionData(null)
    stickBottom.current = true
    api
      .session(r, id)
      .then((d) => {
        setSessionData(d)
        setActive({ id, title: d.summary.title })
        setOpenSlug(d.slug)
        loadSessions(r, d.slug)
      })
      .catch((e) => setError(e.message))
  }, [loadSessions])

  // Session → Stats: jump to this session's token stats (mirror of Stats' "Open
  // conversation →"). A fresh focus object each call re-drills even to the same
  // session after the user has navigated back up the Stats breadcrumb.
  const viewSessionStats = () => {
    if (!active) return
    const slug = openSlug || sessionData?.slug
    if (!slug) return
    setMultiMode(false)
    setStatsFocus({ slug, id: active.id })
    setTab('stats')
  }

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
    // 0. switch engine (terminal vs sdk) so the right surface shows
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
    // 3. open the target. Codex is id-addressed (apiAddr: 'id') — a live
    //    terminal's meta carries no slug, so a slug-based openProject() would
    //    never load the session list and the session could never be selected.
    //    Open by id instead: it fetches the session, derives its project (cwd)
    //    and loads the sidebar list. Fall back to the project view only when
    //    there's no id (e.g. a slug-only "new conversation" entry).
    if (pendingOpen.id) {
      if (!active || active.id !== pendingOpen.id) openSessionById(pendingOpen.id)
    } else if (pendingOpen.slug && openSlug !== pendingOpen.slug) {
      openProject(pendingOpen.slug)
    }
    consumedPendingRef.current = sig
    onConsumedPending?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appActive, pendingOpen, root, openSlug, sessions, active])

  // ---- lazy tab data ----
  useEffect(() => {
    if (tab === 'raw' && active && (!raw || raw.id !== active.id)) {
      api.raw(root, active.id).then(setRaw).catch((e) => setError(e.message))
    }
    if (tab === 'stats' && root) api.stats(root).then(setStats).catch((e) => setError(e.message))
    if (tab === 'history' && root) api.history(root).then(setHistory).catch((e) => setError(e.message))
    // 'config' (ResourcesView) self-fetches and manages its own user/project scope
  }, [tab, active, root, raw])

  // ---- account usage limits for the top bar (5-hour / weekly) ----
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
  // refresh right after live activity so a finished turn updates the meters
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
      // bump per-session versions for EVERY changed id (across roots) so live
      // multi-session panes refetch — do this before the current-root filter.
      setSessionVersions((prev) => {
        let changed = false
        const next = { ...prev }
        for (const c of msg.changes) if (c.id) { next[c.id] = (next[c.id] || 0) + 1; changed = true }
        return changed ? next : prev
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
      const hitsActive = a && relevant.some((c) => c.id === a.id)
      const hitsOpenProject = slug && relevant.some((c) => c.slug === slug)
      // The session you're watching refetches fast (terminal mode mirrors the
      // rollout on disk — keep it snappy); the project/session lists can lag a bit.
      if (hitsActive) {
        if (refetchTimer.current) clearTimeout(refetchTimer.current)
        refetchTimer.current = setTimeout(refetchActive, 120)
      }
      if (listTimer.current) clearTimeout(listTimer.current)
      listTimer.current = setTimeout(() => {
        if (hitsOpenProject) loadSessions(rootRef.current, slug)
        loadProjects(rootRef.current)
      }, 400)
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
  }, [sessionData, tab, activeSlice?.items, viewSlice?.items])

  // persist + drag-to-resize the sidebar
  useEffect(() => localStorage.setItem('cxm_sidebarW', String(sidebarW)), [sidebarW])
  useEffect(() => localStorage.setItem('cxm_collapsed', collapsed ? '1' : '0'), [collapsed])
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
  const isGlobal = GLOBAL_VIEWS.some((g) => g.k === tab)
  const rootLabel = roots.find((r) => r.id === root)?.label || ''
  const disabledTab = (t) => (t.need === 'session' && !active) || (t.need === 'project' && !openSlug)

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
            rootStatusField="hasSessions"
            projects={projects}
            openSlug={openSlug}
            onOpenProject={openProject}
            sessions={sessions}
            activeSession={active}
            onSelectSession={selectSession}
            onAddSession={addToWorkspace}
            loadingSessions={loadingSessions}
            liveIds={liveIds}
            onManageRoots={() => setShowRoots(true)}
            globalViews={GLOBAL_VIEWS}
            activeGlobal={isGlobal ? tab : null}
            onGlobalView={(k) => { setMultiMode(false); setStatsFocus(null); setTab(k) }}
            onNewConversation={startNewConversation}
            onNewProject={startNewProject}
          />
        </div>
      )}
      {!collapsed && <div onMouseDown={startDrag} className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-sky-500/60" title="Drag to resize sidebar" />}

      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800 bg-ink-900/70 overflow-x-auto whitespace-nowrap [&>*]:shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} title={`${collapsed ? 'Show' : 'Hide'} sidebar  (⌘/Ctrl+B)`} className="text-zinc-500 hover:text-zinc-200 text-[15px] leading-none px-1 shrink-0">
            {collapsed ? '»' : '«'}
          </button>
          {multiMode ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-zinc-100 font-medium">Multi-session</span>
              <span className="text-zinc-600">· {openSessions.length} open</span>
              <div className="flex items-center rounded border border-zinc-700 overflow-hidden ml-1" title="Split into N panes">
                {[1, 2, 3].map((n) => (
                  <button key={n} onClick={() => setPanes(n)} className={`px-2 py-0.5 text-[11px] ${panes === n ? 'bg-ink-500 text-zinc-100' : 'bg-ink-800 text-zinc-500 hover:text-zinc-300'}`}>{n}</button>
                ))}
              </div>
              <button onClick={() => setMultiMode(false)} className="ml-1 text-[12px] text-sky-400 hover:text-sky-300">exit ←</button>
            </div>
          ) : isGlobal ? (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-zinc-100 font-medium">{GLOBAL_VIEWS.find((g) => g.k === tab)?.label}</span>
              <span className="text-zinc-600">· {rootLabel}</span>
              {active && <button onClick={() => setTab('conversation')} className="ml-2 text-[12px] text-sky-400 hover:text-sky-300">← back to session</button>}
            </div>
          ) : (
            <div className="flex gap-1 items-center">
              {SESSION_TABS.map((t) => (
                <button key={t.k} onClick={() => setTab(t.k)} disabled={disabledTab(t)} className={`text-[13px] px-3 py-1.5 rounded-md ${tab === t.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                  {t.label}
                </button>
              ))}
              {active && (
                <button onClick={viewSessionStats} disabled={disabledTab({ need: 'session' })} title="View this session's token stats" className="ml-1 text-[13px] px-3 py-1.5 rounded-md text-sky-400/90 hover:text-sky-300 hover:bg-ink-700/40 disabled:opacity-30 disabled:cursor-not-allowed">
                  Stats →
                </button>
              )}
            </div>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <RateLimitsBar usage={usage?.rateLimits} ts={usage?.ts} />
            <InfoDot text="Codex writes usage (5h / weekly) into each session's rollout log, so this is the newest snapshot from disk — not live. It reflects your quota at the moment of the last session activity; if the window has since reset, your real remaining quota is higher (the meter shows ↺ when that reading's window has already reset)." />
          </div>
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
          <a href="https://developers.openai.com/codex" target="_blank" rel="noreferrer" className="text-[12px] text-zinc-500 hover:text-sky-400" title="Codex documentation">docs ↗</a>
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
              setPaneKey={setPaneKeyAt}
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
              onOpenSession={openSessionById}
            />
          </div>
        ) : tab === 'conversation' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div ref={mainRef} onScroll={onMainScroll} className="flex-1 overflow-y-auto">
              {engine === 'terminal' ? (
                termDraft ? (
                  <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-4">New conversation — interact in the terminal below.</div>
                ) : sessionData ? (
                  <Conversation data={sessionData} onOpenSession={openSessionById} />
                ) : (
                  <Empty active={active} />
                )
              ) : convData ? (
                <Conversation data={convData} live={viewSlice ? { items: viewSlice.items } : null} onOpenSession={openSessionById} />
              ) : (
                <Empty active={active} />
              )}
            </div>

            {engine === 'terminal' ? (
              termDraft ? (
                <TerminalPanel root={termDraft.root} slug={termDraft.slug} cwd={termDraft.cwd} title={termDraft.title} isNew runningKeys={runningTermKeys} onClose={() => setTermDraft(null)} onChange={refreshTerminals} onOpenTool={(what) => api.open(termDraft.root, null, what, termDraft.cwd, termDraft.slug)} />
              ) : active ? (
                // TerminalPanel self-manages open/collapsed + reattaches by key, so it
                // survives session switches (only "stop ✕" actually kills it).
                <TerminalPanel root={root} id={active.id} title={active.title} contextSummary={sessionData?.summary} runningKeys={runningTermKeys} onChange={refreshTerminals} onOpenTool={(what) => api.open(root, active.id, what)} />
              ) : null
            ) : draftKey ? (
              <ChatComposer
                slice={viewSlice}
                contextSummary={viewSlice?.transcript?.summary}
                onClose={() => { live.close(draftKey); setDraftKey(null) }}
                mode={chatMode}
                onMode={setChatMode}
                modes={CODEX_MODES}
                onSend={(t) => live.send(draftKey, t, chatMode)}
                onOpenTool={(what) => api.open(viewSlice?.root || root, viewSlice?.id || null, what, viewSlice?.cwd)}
              />
            ) : (
              active && (activeSlice?.transcript || sessionData) && (
                <ChatComposer
                  slice={activeSlice}
                  contextSummary={activeSlice?.transcript?.summary || sessionData?.summary}
                  onOpen={() => live.open({ root, id: active.id, title: active.title, slug: openSlug }, activeSlice?.transcript || sessionData)}
                  onClose={() => { live.close(activeKey); api.session(root, active.id).then(setSessionData).catch(() => {}) }}
                  mode={chatMode}
                  onMode={setChatMode}
                  modes={CODEX_MODES}
                  onSend={(t) => live.send(activeKey, t, chatMode)}
                  onOpenTool={(what) => api.open(root, active.id, what)}
                />
              )
            )}
          </div>
        ) : tab === 'resources' || tab === 'config' ? (
          // two-pane master/detail — let ResourcesView own its panes' scrolling
          <div className="flex-1 min-h-0">
            {tab === 'resources' && <ResourcesView key={`res-${root}`} root={root} scope="user" />}
            {tab === 'config' && <ResourcesView key={`cfg-${root}-${openSlug}`} root={root} scope="project" slug={openSlug} />}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {tab === 'subagents' && active && <SubagentsView root={root} parent={active} versions={sessionVersions} onOpenSession={openSessionById} />}
            {tab === 'raw' && raw && <RawView records={raw.records} typeOf={CODEX_RAW_TYPE} />}
            {tab === 'stats' && <Stats root={root} stats={stats} focus={statsFocus} onOpenSession={openSessionById} />}
            {tab === 'history' && <HistoryView data={history} onOpenSession={openSessionById} />}
            {tab === 'memory' && <MemoryView root={root} />}
            {tab === 'plugins' && <PluginsView root={root} />}
          </div>
        )}
      </main>

      {showRoots && (
        <RootsManager
          roots={roots}
          rootStatusField="hasSessions"
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
        <div className="text-[12px] mt-1 text-zinc-700">Live updates stream in as Codex writes rollouts to disk.</div>
      </div>
    </div>
  )
}
