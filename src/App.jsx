import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HomeView from './components/shared/HomeView.jsx'
import TabStrip from './components/shared/TabStrip.jsx'
import QuickSwitcher from './components/shared/QuickSwitcher.jsx'
import { PROVIDER_LIST } from './providers/index.js'
import { emptyTab, forgetRecent, isHome, loadRecent, loadTabs, pushRecent, sameTarget, saveTabs, targetKey } from './lib/tabs.js'
import { forgetPins } from './lib/pins.js'
import { currentHash, fromHash, replaceHash, toHash } from './lib/route.js'
import useLiveKeys from './lib/useLiveKeys.js'
import useNavIndex from './lib/useNavIndex.js'

// Shell: a Chrome-style tab strip over Home and every provider's app.
//
// Each tab holds a target (see lib/tabs.js). A target with a provider shows
// that provider's app; without one it shows Home (overview / stats / history /
// memory / plugins / resources / folders — `view` + `scope` say which). The
// apps stay mounted at all times (their terminals + sockets survive a switch),
// so a tab switch is instant.
//
// Two directions of sync with the apps:
//   shell → app   `pendingOpen`: "show this target" (tab switch, quick switcher,
//                 Home, deep link). The app walks root → project → session →
//                 view and calls onConsumedPending when it's there.
//   app → shell   `onNavigate`: "I'm now showing this" (sidebar click, view
//                 change, new conversation). The active tab follows, like a
//                 link click navigating the current Chrome tab. Ctrl/middle-
//                 click asks for a new tab.
//
// Closing a tab ends the terminal(s) running for its session, so a tmux
// session never outlives the tab you were driving it from.
//
// Adding a provider = add `src/providers/<id>.jsx` and one line in
// `src/providers/index.js`. This shell needs no change.

const PROVIDER_IDS = PROVIDER_LIST.map((p) => p.id)
const identity = (t) => `${t?.root || ''}|${t?.slug || ''}|${t?.id || ''}|${t?.draft ? 'd' : ''}`
const HOME = { provider: null, view: 'overview' }

function initialState() {
  const saved = loadTabs()
  let tabs = saved?.tabs || []
  let activeKey = saved?.activeKey || null
  if (!tabs.length) {
    tabs = [emptyTab(HOME)]
    activeKey = tabs[0].key
  }
  // a deep link opens (or focuses) its own tab
  const linked = fromHash(currentHash(), PROVIDER_IDS)
  if (linked) {
    const target = linked.provider ? linked : { ...HOME, view: linked.view || 'overview' }
    const existing = target.provider ? tabs.find((t) => sameTarget(t.target, target)) : tabs.find((t) => isHome(t.target) && (t.target?.view || 'overview') === target.view)
    if (existing) activeKey = existing.key
    else {
      const t = emptyTab(target)
      tabs = [...tabs, t]
      activeKey = t.key
    }
  }
  return { tabs, activeKey }
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
  const seq = useRef(0)

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

  // ---- cross-provider index (quick switcher, scope menus, Home) + live dots ----
  const index = useNavIndex(PROVIDER_LIST)
  const live = useLiveKeys({ onChange: index.invalidate })

  // ---- persistence + deep link ----
  useEffect(() => saveTabs(tabs, activeKey), [tabs, activeKey])
  useEffect(() => replaceHash(toHash(activeTarget)), [activeTarget])
  // the shell issues the very first "show this" for a restored / linked tab
  useEffect(() => {
    issuePending(stateRef.current.tabs.find((t) => t.key === stateRef.current.activeKey)?.target || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- tab operations ----
  // open a target: switch to a tab that already shows it, else navigate the
  // current tab (or a new one). `newConversation` is a one-shot instruction for
  // the app and is never stored in the tab.
  const openTarget = useCallback((target, { newTab = false } = {}) => {
    const cur = stateRef.current
    const stored = target ? { ...target, newConversation: undefined, kind: undefined } : { ...HOME }
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

  // Home: navigate the current tab to a Home page (view / scope / focus)
  const openHome = useCallback((patch = {}) => openTarget({ ...HOME, ...patch }), [openTarget])
  // a Home tab changes page / scope in place
  const updateHome = useCallback((patch) => {
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab || !isHome(tab.target)) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: { ...HOME, ...(t.target || {}), ...patch } } : t)) })
  }, [])

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
    // the terminal(s) driven from this tab end with it — unless another tab
    // still shows the same session
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
    const url = `${location.origin}${location.pathname}${toHash(tab.target)}`
    navigator.clipboard?.writeText(url).catch(() => {})
  }, [])

  // an app reports where it is now (user navigation inside it, incl. its view)
  const onNavigate = useCallback((providerId, target, { newTab = false } = {}) => {
    const full = { provider: providerId, ...target }
    if (newTab) return openTarget(full, { newTab: true })
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab) return
    // only the visible app may drive the active tab
    if (!tab.target?.provider || tab.target.provider !== providerId) return
    // while the shell is still steering this app somewhere else, ignore
    // intermediate reports (they'd overwrite the tab with a stale location)
    const pend = pendingRef.current
    if (pend && pend.provider === providerId && identity(pend) !== identity(full)) return
    const prev = tab.target || {}
    const next = { ...full, rootLabel: full.rootLabel || (prev.root === full.root ? prev.rootLabel : undefined) }
    // a weaker report (folder / project only) never demotes a tab that already
    // points at a session in that same place (an app re-initialising, e.g. a
    // dev hot-reload, reports its empty state before it re-selects)
    if (!next.id && !next.draft && prev.id && prev.root === next.root && (!next.slug || next.slug === prev.slug)) return
    if (sameTarget(prev, next) && prev.title === next.title && prev.project === next.project && prev.rootLabel === next.rootLabel && prev.view === next.view) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: next } : t)) })
    pushRecent(next)
  }, [openTarget])

  // the sidebar's scope menu: show another provider / folder in this tab
  const onScope = useCallback((scope) => openTarget({ provider: scope.provider, root: scope.root }), [openTarget])

  // a session was trashed: tabs showing it fall back to its project
  const onSessionRemoved = useCallback((providerId, { root, slug, id }) => {
    const cur = stateRef.current
    const hit = (t) => t?.provider === providerId && t.root === root && t.id === id
    if (cur.tabs.some((t) => hit(t.target))) {
      commit({ ...cur, tabs: cur.tabs.map((t) => (hit(t.target) ? { ...t, target: { ...t.target, id: null, title: null, slug: t.target.slug || slug || null } } : t)) })
    }
    forgetRecent(hit)
    forgetPins(hit)
    setRecent(loadRecent())
  }, [])

  // ---- deep links typed / pasted into the address bar ----
  useEffect(() => {
    const onHash = () => {
      const t = fromHash(location.hash, PROVIDER_IDS)
      if (!t) return
      const cur = stateRef.current
      const act = cur.tabs.find((x) => x.key === cur.activeKey)?.target || null
      if (t.provider) {
        if (!sameTarget(act, t)) openTarget(t)
      } else if (!isHome(act) || (act?.view || 'overview') !== (t.view || 'overview')) openHome({ view: t.view || 'overview' })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [openTarget, openHome])

  // ---- keyboard: Ctrl+K search · Alt+T new · Alt+W close · Alt+[ ] cycle · Alt+1-9 jump ----
  // (Ctrl+T/W/Tab/1-9 belong to the browser and can't be intercepted.)
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP')) {
        e.preventDefault()
        setSearchOpen((o) => !o)
        return
      }
      if (!e.altKey || mod || e.shiftKey) return
      if (e.target?.closest?.('.xterm')) return // leave Alt chords to the terminal
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
        onSelect={activateTab}
        onClose={closeTab}
        onCloseOthers={closeOthers}
        onCloseRight={closeRight}
        onNew={newTab}
        onReorder={moveTab}
        onSearch={() => setSearchOpen(true)}
        onHome={() => openHome()}
        onCopyLink={copyLink}
      />
      <div className="flex-1 min-h-0 relative">
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
                onScope={onScope}
                onOpenHome={openHome}
                onOpenSession={openSession}
                onNavigate={onNavigate}
                onOpenSearch={() => setSearchOpen(true)}
                onSessionRemoved={onSessionRemoved}
                pendingOpen={pendingOpen?.provider === p.id ? pendingOpen : null}
                onConsumedPending={consumedPending}
              />
            </div>
          )
        })}
        <div className="absolute inset-0" style={{ display: showHome ? 'block' : 'none' }}>
          <HomeView
            providers={PROVIDER_LIST}
            visible={showHome}
            target={showHome ? activeTarget : null}
            index={index}
            live={live}
            onOpen={openSession}
            onNavigate={updateHome}
            onSearch={() => setSearchOpen(true)}
          />
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
