import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createApi } from './api.js'
import HomeView from './components/shared/HomeView.jsx'
import AppSidebar from './components/shared/AppSidebar.jsx'
import TabStrip from './components/shared/TabStrip.jsx'
import QuickSwitcher from './components/shared/QuickSwitcher.jsx'
import { PROVIDER_LIST } from './providers/index.js'
import { emptyTab, forgetRecent, isHome, loadRecent, loadTabs, normalizeView, pushRecent, sameTarget, saveTabs, targetKey } from './lib/tabs.js'
import { forgetPins } from './lib/pins.js'
import { baseName } from './lib/paths.js'
import { currentHash, fromHash, replaceHash, toHash } from './lib/route.js'
import useActiveSessions from './lib/useActiveSessions.js'
import useLiveKeys, { liveSessionKey } from './lib/useLiveKeys.js'
import useNavIndex from './lib/useNavIndex.js'

// Shell: a Chrome-style tab strip; below it one sidebar and the main area that
// shows Home or a provider's app depending on the active tab.
//
// Each tab holds a target (see lib/tabs.js). A target with a provider shows
// that provider's app; without one it shows Home (activity / stats / history /
// plugins / resources / folders — `view` says which). The apps stay mounted at
// all times (their terminals + sockets survive a switch), so a tab switch is
// instant.
//
// The sidebar's folder chips (every provider's folders, colour-coded) pick the
// "scope" that the project list and Home's per-folder pages use; it follows the
// active tab, and on Home it is whatever was picked last. The sidebar is the
// shell's, so it is identical on every tab. Clicking in it navigates the
// current tab, like a link click in Chrome; Ctrl/middle-click opens a new tab.
//
// Two directions of sync with the apps:
//   shell → app   `pendingOpen`: "show this target". The app walks root →
//                 project → session → view and calls onConsumedPending.
//   app → shell   `onNavigate`: "I'm now showing this" (view change, new
//                 conversation). The active tab follows.
//
// Closing a tab ends the terminal(s) running for its session, so a tmux
// session never outlives the tab you were driving it from. A tab whose session
// has a terminal running shows a red dot.

const PROVIDER_IDS = PROVIDER_LIST.map((p) => p.id)
const identity = (t) => `${t?.root || ''}|${t?.slug || ''}|${t?.id || ''}|${t?.draft ? 'd' : ''}`
const HOME = { provider: null, view: 'activity' }
const SCOPE_KEY = 'agentdeck_scope'

function initialState() {
  const saved = loadTabs()
  let tabs = saved?.tabs || []
  let activeKey = saved?.activeKey || null
  if (!tabs.length) {
    tabs = [emptyTab({ ...HOME })]
    activeKey = tabs[0].key
  }
  // a deep link opens (or focuses) its own tab
  const linked = fromHash(currentHash(), PROVIDER_IDS)
  if (linked) {
    const target = linked.provider ? linked : { ...HOME, view: normalizeView(linked.view) }
    const existing = target.provider ? tabs.find((t) => sameTarget(t.target, target)) : tabs.find((t) => isHome(t.target) && normalizeView(t.target?.view) === target.view)
    if (existing) activeKey = existing.key
    else {
      const t = emptyTab(target)
      tabs = [...tabs, t]
      activeKey = t.key
    }
  }
  return { tabs, activeKey }
}

const loadJson = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback
  } catch {
    return fallback
  }
}
const saveJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {}
}

// End every terminal that belongs to a session / draft target (called when its
// tab closes). Both the ttyd pool and the detached tmux list are consulted so
// a terminal that outlived a server restart is ended too.
async function endTerminalsFor(t) {
  if (!t?.provider || !t.root || !(t.id || t.draft)) return
  try {
    const [live, pool] = await Promise.all([
      fetch(`/api/${t.provider}/active-sessions`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/${t.provider}/terminals`).then((r) => r.json()).catch(() => ({})),
    ])
    const entries = [...(live?.tmux || []).filter((x) => !x.provider || x.provider === t.provider), ...(pool?.terminals || [])]
    const hit = (x) => {
      if (x.root !== t.root) return false
      if (t.id) return x.id === t.id
      if (x.id) return false
      return (t.slug && x.slug === t.slug) || (t.cwd && x.cwd === t.cwd)
    }
    const keys = [...new Set(entries.filter(hit).map((x) => x.key).filter(Boolean))]
    await Promise.all(keys.map((k) => fetch(`/api/${t.provider}/terminal?key=${encodeURIComponent(k)}`, { method: 'DELETE' }).catch(() => {})))
  } catch {
    // best effort
  }
}

export default function App() {
  const [state, setState] = useState(initialState)
  const stateRef = useRef(state)
  const [pendingOpen, setPendingOpen] = useState(null)
  const pendingRef = useRef(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [recent, setRecent] = useState(loadRecent)
  const [sticky, setSticky] = useState(() => loadJson(SCOPE_KEY, null)) // last scope picked while on Home
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('agentdeck_collapsed') === '1')
  const [sidebarW, setSidebarW] = useState(() => {
    const v = Number(localStorage.getItem('agentdeck_sidebarW'))
    return v >= 240 && v <= 600 ? v : 300
  })
  const seq = useRef(0)
  const apis = useMemo(() => Object.fromEntries(PROVIDER_LIST.map((p) => [p.id, createApi(p.id)])), [])

  const commit = (next) => {
    stateRef.current = next
    setState(next)
  }
  const issuePending = (target) => {
    const p = target?.provider ? { ...target, seq: ++seq.current } : null
    pendingRef.current = p
    setPendingOpen(p)
  }
  const consumedPending = useCallback(() => {
    pendingRef.current = null
    setPendingOpen(null)
  }, [])

  const { tabs, activeKey } = state
  const activeTab = tabs.find((t) => t.key === activeKey) || tabs[0]
  const activeTarget = activeTab?.target || null

  // ---- cross-provider index (sidebar, quick switcher, Home), live dots, terminals ----
  const index = useNavIndex(PROVIDER_LIST)
  const live = useLiveKeys({ onChange: index.invalidate })
  const activeSessions = useActiveSessions(PROVIDER_LIST)
  // sessions / drafts with a terminal running right now (red dots)
  const termKeys = useMemo(() => {
    const s = new Set()
    for (const t of activeSessions.tmux) {
      if (!t.provider || !t.root) continue
      if (t.id) s.add(liveSessionKey(t.provider, t.root, t.id))
      else {
        if (t.slug) s.add(`${t.provider}|${t.root}|new|${t.slug}`)
        if (t.cwd) s.add(`${t.provider}|${t.root}|new|${t.cwd}`)
      }
    }
    return s
  }, [activeSessions.tmux])

  // the sidebar's scope: the active tab's folder, else the last one picked
  const scope = useMemo(() => {
    const has = (s) => s && index.scopes.some((x) => x.provider === s.provider && x.root === s.root)
    const t = activeTarget
    if (t?.provider && t.root && has({ provider: t.provider, root: t.root })) return { provider: t.provider, root: t.root }
    if (t?.provider) {
      const s = index.scopes.find((x) => x.provider === t.provider)
      if (s) return { provider: s.provider, root: s.root }
    }
    if (has(sticky)) return sticky
    return index.scopes[0] ? { provider: index.scopes[0].provider, root: index.scopes[0].root } : null
  }, [activeTarget, sticky, index.scopes])

  // ---- persistence + deep link ----
  useEffect(() => saveTabs(tabs, activeKey), [tabs, activeKey])
  useEffect(() => replaceHash(toHash(activeTarget)), [activeTarget])
  useEffect(() => localStorage.setItem('agentdeck_collapsed', collapsed ? '1' : '0'), [collapsed])
  useEffect(() => localStorage.setItem('agentdeck_sidebarW', String(sidebarW)), [sidebarW])
  useEffect(() => {
    issuePending(stateRef.current.tabs.find((t) => t.key === stateRef.current.activeKey)?.target || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- tab operations ----
  const openTarget = useCallback((target, { newTab = false } = {}) => {
    const cur = stateRef.current
    const stored = target ? { ...target, newConversation: undefined, kind: undefined, at: undefined } : { ...HOME }
    const existing = target?.provider && target.id ? cur.tabs.find((t) => sameTarget(t.target, target)) : null
    if (existing) {
      commit({ ...cur, activeKey: existing.key })
      issuePending({ ...existing.target, view: target.view || existing.target.view })
      return
    }
    if (newTab || !cur.tabs.length) {
      const t = emptyTab(stored)
      const idx = cur.tabs.findIndex((x) => x.key === cur.activeKey)
      const next = [...cur.tabs]
      next.splice(idx + 1, 0, t)
      commit({ tabs: next, activeKey: t.key })
    } else {
      commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === cur.activeKey ? { ...t, target: stored } : t)) })
    }
    issuePending(target)
    if (target?.provider) pushRecent(target)
  }, [])

  const setScope = useCallback((s) => {
    setSticky(s)
    saveJson(SCOPE_KEY, s)
  }, [])

  // Home: navigate the current tab to a Home page; a `scope` in the patch
  // (Session → Stats) also becomes the sidebar's scope
  const openHome = useCallback(
    ({ scope: sc, ...patch } = {}, opts) => {
      if (sc) setScope(sc)
      openTarget({ ...HOME, ...patch }, opts)
    },
    [openTarget, setScope]
  )

  // a Home tab switches page in place
  const updateHome = useCallback((patch) => {
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab || !isHome(tab.target)) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: { ...HOME, ...(t.target || {}), ...patch } } : t)) })
  }, [])

  // scope changes (rail / folder chips): on a provider tab they navigate the
  // tab to that folder; on Home they just re-scope the Home pages
  const onScope = useCallback(
    (s) => {
      setScope(s)
      const cur = stateRef.current
      const t = cur.tabs.find((x) => x.key === cur.activeKey)?.target
      if (t?.provider) openTarget({ provider: s.provider, root: s.root })
    },
    [openTarget, setScope]
  )
  const activateTab = useCallback((key) => {
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === key)
    if (!tab || key === cur.activeKey) return
    commit({ ...cur, activeKey: key })
    issuePending(tab.target)
  }, [])

  const closeTab = useCallback((key) => {
    const cur = stateRef.current
    const idx = cur.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return
    const closing = cur.tabs[idx]
    let tabs = cur.tabs.filter((t) => t.key !== key)
    let activeKey = cur.activeKey
    if (!tabs.length) tabs = [emptyTab({ ...HOME })]
    if (key === cur.activeKey) {
      const nxt = tabs[Math.min(idx, tabs.length - 1)]
      activeKey = nxt.key
      issuePending(nxt.target)
    }
    commit({ tabs, activeKey })
    if (closing.target?.provider && !tabs.some((t) => sameTarget(t.target, closing.target))) endTerminalsFor(closing.target)
  }, [])

  const closeOthers = useCallback((key) => {
    const cur = stateRef.current
    const keep = cur.tabs.find((t) => t.key === key)
    if (!keep) return
    const gone = cur.tabs.filter((t) => t.key !== key)
    commit({ tabs: [keep], activeKey: key })
    if (cur.activeKey !== key) issuePending(keep.target)
    for (const t of gone) if (t.target?.provider && !sameTarget(t.target, keep.target)) endTerminalsFor(t.target)
  }, [])

  const closeRight = useCallback((key) => {
    const cur = stateRef.current
    const idx = cur.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return
    const tabs = cur.tabs.slice(0, idx + 1)
    const gone = cur.tabs.slice(idx + 1)
    let activeKey = cur.activeKey
    if (!tabs.some((t) => t.key === activeKey)) {
      activeKey = key
      issuePending(tabs[idx].target)
    }
    commit({ tabs, activeKey })
    for (const t of gone) if (t.target?.provider && !tabs.some((k) => sameTarget(k.target, t.target))) endTerminalsFor(t.target)
  }, [])

  const moveTab = useCallback((key, toIdx) => {
    const cur = stateRef.current
    const from = cur.tabs.findIndex((t) => t.key === key)
    if (from === -1) return
    const tabs = [...cur.tabs]
    const [tab] = tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(tabs.length, toIdx)), 0, tab)
    commit({ ...cur, tabs })
  }, [])

  const newTab = useCallback(() => {
    openTarget(null, { newTab: true })
    setSearchOpen(true)
  }, [openTarget])

  const copyLink = useCallback((key) => {
    const tab = stateRef.current.tabs.find((t) => t.key === key)
    if (!tab?.target) return
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}${toHash(tab.target)}`).catch(() => {})
  }, [])

  // an app reports where it is now (user navigation inside it, incl. its view)
  const onNavigate = useCallback((providerId, target, { newTab = false } = {}) => {
    const full = { provider: providerId, ...target }
    if (newTab) return openTarget(full, { newTab: true })
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab) return
    if (!tab.target?.provider || tab.target.provider !== providerId) return
    const pend = pendingRef.current
    if (pend && pend.provider === providerId && identity(pend) !== identity(full)) return
    const prev = tab.target || {}
    const next = { ...full, rootLabel: full.rootLabel || (prev.root === full.root ? prev.rootLabel : undefined) }
    if (!next.id && !next.draft && prev.id && prev.root === next.root && (!next.slug || next.slug === prev.slug)) return
    if (sameTarget(prev, next) && prev.title === next.title && prev.project === next.project && prev.rootLabel === next.rootLabel && prev.view === next.view) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: next } : t)) })
    pushRecent(next)
  }, [openTarget])

  // a session was trashed: tabs showing it fall back to its project
  const onSessionRemoved = useCallback((providerId, { root, slug, id }) => {
    const cur = stateRef.current
    const hit = (t) => t?.provider === providerId && t.root === root && t.id === id
    if (cur.tabs.some((t) => hit(t.target))) {
      const tabs = cur.tabs.map((t) => (hit(t.target) ? { ...t, target: { ...t.target, id: null, title: null, slug: t.target.slug || slug || null } } : t))
      commit({ ...cur, tabs })
      if (hit(cur.tabs.find((t) => t.key === cur.activeKey)?.target)) issuePending(tabs.find((t) => t.key === cur.activeKey).target)
    }
    forgetRecent(hit)
    forgetPins(hit)
    setRecent(loadRecent())
  }, [])

  // ---- sidebar actions (provider-agnostic via the api clients) ----
  const addrOf = (pid) => PROVIDER_LIST.find((p) => p.id === pid)?.apiAddr
  const deleteOne = async (sc, slug, s) => {
    const api = apis[sc.provider]
    if (addrOf(sc.provider) === 'id') await api.deleteSession(sc.root, s.id)
    else await api.deleteSession(sc.root, slug, s.id)
    onSessionRemoved(sc.provider, { root: sc.root, slug, id: s.id })
  }
  const afterDelete = (sc, slug) => {
    index.loadSessions(sc.provider, sc.root, slug, { force: true })
    index.refresh(true)
  }
  const deleteSession = useCallback(async (sc, slug, s) => {
    try {
      await deleteOne(sc, slug, s)
    } catch (e) {
      if (e.status !== 404) console.error(e)
    }
    afterDelete(sc, slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index.loadSessions, index.refresh])
  const deleteSessions = useCallback(async (sc, slug, list) => {
    for (const s of list) {
      try {
        await deleteOne(sc, slug, s) // sequential: each delete may spawn a recycle helper
      } catch (e) {
        if (e.status !== 404) console.error(e)
      }
    }
    afterDelete(sc, slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index.loadSessions, index.refresh])
  const newProject = useCallback(
    (sc, cwd) => openTarget({ provider: sc.provider, root: sc.root, cwd, project: baseName(cwd), draft: true, title: 'New conversation', newConversation: true }),
    [openTarget]
  )

  // ---- deep links typed / pasted into the address bar ----
  useEffect(() => {
    const onHash = () => {
      const t = fromHash(location.hash, PROVIDER_IDS)
      if (!t) return
      const cur = stateRef.current
      const act = cur.tabs.find((x) => x.key === cur.activeKey)?.target || null
      if (t.provider) {
        if (!sameTarget(act, t)) openTarget(t)
      } else if (!isHome(act) || normalizeView(act?.view) !== normalizeView(t.view)) openHome({ view: normalizeView(t.view) })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [openTarget, openHome])

  // ---- keyboard: Ctrl+K search · Ctrl+B sidebar · Alt+T new · Alt+W close · Alt+[ ] cycle · Alt+1-9 jump ----
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
        e.preventDefault()
        setSearchOpen((o) => !o)
        return
      }
      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault()
        setCollapsed((c) => !c)
        return
      }
      if (!e.altKey || mod || e.shiftKey) return
      if (e.target?.closest?.('.xterm')) return
      const cur = stateRef.current
      const idx = cur.tabs.findIndex((t) => t.key === cur.activeKey)
      if (e.code === 'KeyT') newTab()
      else if (e.code === 'KeyW') closeTab(cur.activeKey)
      else if (e.code === 'BracketLeft') activateTab(cur.tabs[(idx - 1 + cur.tabs.length) % cur.tabs.length]?.key)
      else if (e.code === 'BracketRight') activateTab(cur.tabs[(idx + 1) % cur.tabs.length]?.key)
      else if (/^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5))
        activateTab((n === 9 ? cur.tabs[cur.tabs.length - 1] : cur.tabs[n - 1])?.key)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newTab, closeTab, activateTab])

  useEffect(() => {
    if (searchOpen) setRecent(loadRecent())
  }, [searchOpen])

  const startDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarW
    document.body.style.userSelect = 'none'
    const move = (ev) => setSidebarW(Math.min(600, Math.max(240, startW + ev.clientX - startX)))
    const up = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const openTabKeys = useMemo(() => new Set(tabs.map((t) => targetKey(t.target)).filter(Boolean)), [tabs])
  const showHome = isHome(activeTarget)
  const openSession = useCallback((providerId, target, opts) => openTarget({ provider: providerId, ...target }, opts), [openTarget])

  return (
    <div className="h-full flex flex-col">
      <TabStrip
        tabs={tabs}
        activeKey={activeTab?.key}
        providers={PROVIDER_LIST}
        live={live}
        termKeys={termKeys}
        onSelect={activateTab}
        onClose={closeTab}
        onCloseOthers={closeOthers}
        onCloseRight={closeRight}
        onNew={newTab}
        onReorder={moveTab}
        onSearch={() => setSearchOpen(true)}
        onHome={() => openHome()}
        onCopyLink={copyLink}
        sidebarCollapsed={collapsed}
        onToggleSidebar={() => setCollapsed((c) => !c)}
      />
      <div className="flex-1 min-h-0 flex">
        {!collapsed && (
          <>
            <div style={{ width: sidebarW }} className="shrink-0 h-full min-w-0">
              <AppSidebar
                providers={PROVIDER_LIST}
                index={index}
                live={live}
                termKeys={termKeys}
                scope={scope}
                onScope={onScope}
                activeTarget={activeTarget}
                onOpenHome={openHome}
                onOpenTarget={(t, opts) => openTarget({ ...t }, opts)}
                onNewProject={newProject}
                onDeleteSession={deleteSession}
                onDeleteSessions={deleteSessions}
              />
            </div>
            <div onMouseDown={startDrag} className="relative w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-sky-500/60 after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']" title="Drag to resize sidebar" />
          </>
        )}
        <div className="flex-1 min-w-0 relative">
          {PROVIDER_LIST.map((p) => {
            const ProviderApp = p.App
            const shown = activeTarget?.provider === p.id
            return (
              <div key={p.id} className="absolute inset-0" style={{ display: shown ? 'block' : 'none' }}>
                <ProviderApp
                  active={shown}
                  provider={p.id}
                  providers={PROVIDER_LIST}
                  scopes={index.scopes}
                  onOpenHome={openHome}
                  onOpenSession={openSession}
                  onNavigate={onNavigate}
                  pendingOpen={pendingOpen?.provider === p.id ? pendingOpen : null}
                  onConsumedPending={consumedPending}
                />
              </div>
            )
          })}
          <div className="absolute inset-0" style={{ display: showHome ? 'block' : 'none' }}>
            <HomeView providers={PROVIDER_LIST} visible={showHome} target={showHome ? activeTarget : null} scope={scope} onScope={onScope} index={index} live={live} termKeys={termKeys} onOpen={openSession} onNavigate={updateHome} onOpenHome={openHome} onSearch={() => setSearchOpen(true)} />
          </div>
        </div>
      </div>
      <QuickSwitcher
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        providers={PROVIDER_LIST}
        index={index}
        recent={recent}
        live={live}
        openTabs={openTabKeys}
        onPick={(target, opts) => {
          setSearchOpen(false)
          openTarget(target, opts)
        }}
        onNewConversation={(p) => {
          setSearchOpen(false)
          openTarget({ provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name, draft: true, title: 'New conversation', newConversation: true })
        }}
      />
    </div>
  )
}
