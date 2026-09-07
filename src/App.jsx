import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Dashboard from './components/shared/Dashboard.jsx'
import TabStrip from './components/shared/TabStrip.jsx'
import QuickSwitcher from './components/shared/QuickSwitcher.jsx'
import { PROVIDER_LIST } from './providers/index.js'
import { emptyTab, forgetRecent, isEmpty, loadRecent, loadTabs, pushRecent, sameTarget, saveTabs, targetKey } from './lib/tabs.js'
import { currentHash, fromHash, replaceHash, toHash } from './lib/route.js'
import useLiveKeys from './lib/useLiveKeys.js'
import useNavIndex from './lib/useNavIndex.js'

// Shell: a Chrome-style tab strip over every provider's app.
//
// Each tab holds a target { provider, root, slug, id, … } (see lib/tabs.js).
// The active tab decides which provider app is visible; the apps stay mounted
// at all times (their live-chat stores + sockets survive a switch), so a tab
// switch is instant. An empty tab shows the Dashboard, Chrome's new-tab page.
//
// Two directions of sync with the apps:
//   shell → app   `pendingOpen`: "show this target" (tab switch, quick switcher,
//                 dashboard, deep link). The app walks root → project → session
//                 and calls onConsumedPending when it's there.
//   app → shell   `onNavigate`: "I'm now showing this" (sidebar click, live-log
//                 jump). The active tab follows, like a link click navigating
//                 the current Chrome tab. Ctrl/middle-click asks for a new tab.
//
// Adding a provider = add `src/providers/<id>.jsx` and one line in
// `src/providers/index.js`. This shell needs no change.

const PROVIDER_IDS = PROVIDER_LIST.map((p) => p.id)
const identity = (t) => `${t?.root || ''}|${t?.slug || ''}|${t?.id || ''}|${t?.draft ? 'd' : ''}`

function initialState() {
  const saved = loadTabs()
  let tabs = saved?.tabs || []
  let activeKey = saved?.activeKey || null
  if (!tabs.length) {
    const prov = localStorage.getItem('agentdeck_provider')
    tabs = [emptyTab({ provider: PROVIDER_IDS.includes(prov) ? prov : PROVIDER_IDS[0] })]
    activeKey = tabs[0].key
  }
  // a deep link opens (or focuses) its own tab
  const linked = fromHash(currentHash(), PROVIDER_IDS)
  if (linked) {
    const target = linked.provider ? linked : null
    const existing = tabs.find((t) => sameTarget(t.target, target))
    if (existing) activeKey = existing.key
    else {
      const t = emptyTab(target)
      tabs = [...tabs, t]
      activeKey = t.key
    }
  }
  return { tabs, activeKey }
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

  // ---- cross-provider index (quick switcher) + live dots ----
  const index = useNavIndex(PROVIDER_LIST)
  const live = useLiveKeys({ onChange: index.invalidate })

  // ---- persistence + deep link ----
  useEffect(() => saveTabs(tabs, activeKey), [tabs, activeKey])
  useEffect(() => {
    if (activeTarget?.provider) localStorage.setItem('agentdeck_provider', activeTarget.provider)
  }, [activeTarget?.provider])
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
    const stored = target ? { ...target, newConversation: undefined } : null
    const existing = target?.provider && target.id ? cur.tabs.find((t) => sameTarget(t.target, target)) : null
    if (existing) {
      commit({ ...cur, activeKey: existing.key })
      issuePending(existing.target)
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
    if (target) pushRecent(target)
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
    let tabs = cur.tabs.filter((t) => t.key !== key)
    let activeKey = cur.activeKey
    if (!tabs.length) tabs = [emptyTab(null)]
    if (key === cur.activeKey) {
      const nxt = tabs[Math.min(idx, tabs.length - 1)]
      activeKey = nxt.key
      issuePending(nxt.target)
    }
    commit({ tabs, activeKey })
  }, [])

  const closeOthers = useCallback((key) => {
    const cur = stateRef.current
    const keep = cur.tabs.find((t) => t.key === key)
    if (!keep) return
    commit({ tabs: [keep], activeKey: key })
    if (cur.activeKey !== key) issuePending(keep.target)
  }, [])

  const closeRight = useCallback((key) => {
    const cur = stateRef.current
    const idx = cur.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return
    const tabs = cur.tabs.slice(0, idx + 1)
    let activeKey = cur.activeKey
    if (!tabs.some((t) => t.key === activeKey)) {
      activeKey = key
      issuePending(tabs[idx].target)
    }
    commit({ tabs, activeKey })
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

  const goHome = useCallback(() => openTarget(null), [openTarget])

  const copyLink = useCallback((key) => {
    const tab = stateRef.current.tabs.find((t) => t.key === key)
    if (!tab?.target?.provider) return
    const url = `${location.origin}${location.pathname}${toHash(tab.target)}`
    navigator.clipboard?.writeText(url).catch(() => {})
  }, [])

  // an app reports where it is now (user navigation inside it)
  const onNavigate = useCallback((providerId, target, { newTab = false } = {}) => {
    const full = { provider: providerId, ...target }
    if (newTab) return openTarget(full, { newTab: true })
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab) return
    // only the visible app may drive the active tab
    if (tab.target?.provider && tab.target.provider !== providerId) return
    if (!tab.target?.provider && !tab.target) return
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
    if (sameTarget(prev, next) && prev.title === next.title && prev.project === next.project && prev.rootLabel === next.rootLabel) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: next } : t)) })
    pushRecent(next)
  }, [openTarget])

  // the sidebar's provider dropdown: show that provider's app as it is
  const switchProvider = useCallback((providerId) => {
    const cur = stateRef.current
    const tab = cur.tabs.find((t) => t.key === cur.activeKey)
    if (!tab || tab.target?.provider === providerId) return
    commit({ ...cur, tabs: cur.tabs.map((t) => (t.key === tab.key ? { ...t, target: { provider: providerId } } : t)) })
    issuePending(null)
  }, [])

  // a session was trashed: tabs showing it fall back to its project
  const onSessionRemoved = useCallback((providerId, { root, slug, id }) => {
    const cur = stateRef.current
    const hit = (t) => t?.provider === providerId && t.root === root && t.id === id
    if (cur.tabs.some((t) => hit(t.target))) {
      commit({ ...cur, tabs: cur.tabs.map((t) => (hit(t.target) ? { ...t, target: { ...t.target, id: null, title: null, slug: t.target.slug || slug || null } } : t)) })
    }
    forgetRecent(hit)
    setRecent(loadRecent())
  }, [])

  // ---- deep links typed / pasted into the address bar ----
  useEffect(() => {
    const onHash = () => {
      const t = fromHash(location.hash, PROVIDER_IDS)
      if (!t) return
      const target = t.provider ? t : null
      const cur = stateRef.current
      const act = cur.tabs.find((x) => x.key === cur.activeKey)?.target || null
      if (sameTarget(act, target)) return
      openTarget(target)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [openTarget])

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
  const showDashboard = isEmpty(activeTarget)

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
        onHome={goHome}
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
                onProvider={switchProvider}
                providers={PROVIDER_LIST}
                onLogo={goHome}
                onOpenSession={(providerId, target) => openTarget({ provider: providerId, ...target })}
                onNavigate={onNavigate}
                onOpenSearch={() => setSearchOpen(true)}
                onSessionRemoved={onSessionRemoved}
                pendingOpen={pendingOpen?.provider === p.id ? pendingOpen : null}
                onConsumedPending={consumedPending}
              />
            </div>
          )
        })}
        <div className="absolute inset-0" style={{ display: showDashboard ? 'block' : 'none' }}>
          <Dashboard
            providers={PROVIDER_LIST}
            visible={showDashboard}
            onOpen={(providerId, target) => openTarget({ provider: providerId, ...target })}
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
