import type { Target } from '../../shared/types.js'
import { groupTabs, isTerminalTab, unitOf } from '../lib/tabs.ts'

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
// A conversation tab and its terminal sub-tab form one unit: closing the
// conversation takes the sub-tab with it, closing the sub-tab only folds the
// terminal back into the conversation's panel, and "others"/"to the right"
// count units, not sub-tabs.
export function createTabActions({ read, commit, notifyClosed, issuePending, createHomeTab }: Context) {
  const closeTab = (key: string | null | undefined, { notify = true } = {}) => {
    const cur = read()
    const idx = cur.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return
    const closing = cur.tabs[idx]
    const unit = unitOf(cur.tabs, closing.key)
    const removed = isTerminalTab(closing.target) ? [closing] : [closing, ...(unit?.terminal ? [unit.terminal] : [])]
    if (notify && !isTerminalTab(closing.target)) notifyClosed([closing])
    const gone = new Set(removed.map((t) => t.key))
    let tabs = cur.tabs.filter((t) => !gone.has(t.key))
    let activeKey = cur.activeKey
    if (!tabs.length) tabs = [createHomeTab()]
    if (activeKey && gone.has(activeKey)) {
      // a folded terminal returns to its conversation; a closed unit hands over to its neighbour
      const parent = isTerminalTab(closing.target) ? unit?.tab : null
      const nxt = (parent && tabs.find((t) => t.key === parent.key)) || tabs[Math.min(idx, tabs.length - 1)]
      activeKey = nxt.key
      issuePending(nxt.target)
    }
    commit({ tabs, activeKey })
  }

  const closeOthers = (key: string) => {
    const cur = read()
    const unit = unitOf(cur.tabs, key)
    if (!unit) return
    const keep = new Set([unit.tab.key, ...(unit.terminal ? [unit.terminal.key] : [])])
    notifyClosed(cur.tabs.filter((t) => !keep.has(t.key) && !isTerminalTab(t.target)))
    const tabs = cur.tabs.filter((t) => keep.has(t.key))
    const activeKey = cur.activeKey && keep.has(cur.activeKey) ? cur.activeKey : key
    commit({ tabs, activeKey })
    if (activeKey !== cur.activeKey) issuePending(tabs.find((t) => t.key === activeKey)?.target)
  }

  const closeRight = (key: string) => {
    const cur = read()
    const units = groupTabs(cur.tabs)
    const idx = units.findIndex((u) => u.tab.key === key || u.terminal?.key === key)
    if (idx === -1) return
    const keep = new Set(units.slice(0, idx + 1).flatMap((u) => [u.tab.key, ...(u.terminal ? [u.terminal.key] : [])]))
    notifyClosed(cur.tabs.filter((t) => !keep.has(t.key) && !isTerminalTab(t.target)))
    const tabs = cur.tabs.filter((t) => keep.has(t.key))
    let activeKey = cur.activeKey
    if (!activeKey || !keep.has(activeKey)) {
      activeKey = units[idx].tab.key
      issuePending(units[idx].tab.target)
    }
    commit({ tabs, activeKey })
  }

  // Moves the unit that holds `key`; a terminal sub-tab always follows its conversation.
  const moveTab = (key: string, toIdx: number) => {
    const cur = read()
    const unit = unitOf(cur.tabs, key)
    const from = cur.tabs.findIndex((t) => t.key === (unit?.tab.key || key))
    if (from === -1) return
    const tabs = [...cur.tabs]
    const [tab] = tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(tabs.length, toIdx)), 0, tab)
    commit({ ...cur, tabs })
  }

  // A view that moved elsewhere (a terminal tab folding back into its panel) is not a closed terminal.
  const detachTab = (key: string) => closeTab(key, { notify: false })

  return { closeTab, closeOthers, closeRight, moveTab, detachTab }
}
