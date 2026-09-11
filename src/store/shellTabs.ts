import type { Target } from '../../shared/types.js'

export interface Tab {
  key: string
  target: Target | null
}
export interface TabState {
  tabs: Tab[]
  activeKey: string | null
}

interface Context {
  read: () => TabState
  commit: (state: TabState) => void
  notifyClosed: (tabs: Tab[]) => void
  issuePending: (target: Target | null | undefined) => void
  createHomeTab: () => Tab
}

// Tab lifecycle is independent of Query, persistence and browser gestures.
export function createTabActions({ read, commit, notifyClosed, issuePending, createHomeTab }: Context) {
  const closeTab = (key: string | null | undefined) => {
    const cur = read()
    const idx = cur.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return
    notifyClosed([cur.tabs[idx]])
    let tabs = cur.tabs.filter((t) => t.key !== key)
    let activeKey = cur.activeKey
    if (!tabs.length) tabs = [createHomeTab()]
    if (key === cur.activeKey) {
      const nxt = tabs[Math.min(idx, tabs.length - 1)]
      activeKey = nxt.key
      issuePending(nxt.target)
    }
    commit({ tabs, activeKey })
  }

  const closeOthers = (key: string) => {
    const cur = read()
    const keep = cur.tabs.find((t) => t.key === key)
    if (!keep) return
    notifyClosed(cur.tabs.filter((t) => t.key !== key))
    commit({ tabs: [keep], activeKey: key })
    if (cur.activeKey !== key) issuePending(keep.target)
  }

  const closeRight = (key: string) => {
    const cur = read()
    const idx = cur.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return
    notifyClosed(cur.tabs.slice(idx + 1))
    const tabs = cur.tabs.slice(0, idx + 1)
    let activeKey = cur.activeKey
    if (!tabs.some((t) => t.key === activeKey)) {
      activeKey = key
      issuePending(tabs[idx].target)
    }
    commit({ tabs, activeKey })
  }

  const moveTab = (key: string, toIdx: number) => {
    const cur = read()
    const from = cur.tabs.findIndex((t) => t.key === key)
    if (from === -1) return
    const tabs = [...cur.tabs]
    const [tab] = tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(tabs.length, toIdx)), 0, tab)
    commit({ ...cur, tabs })
  }

  return { closeTab, closeOthers, closeRight, moveTab }
}
