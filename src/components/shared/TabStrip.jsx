import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tabLabel } from '../../lib/tabs.js'
import { providerColor } from '../../lib/providerColors.js'
import { liveSessionKey } from '../../lib/useLiveKeys.js'
import { ActivityIcon } from './icons.jsx'
import { CloseIcon, PanelLeftIcon, PlusIcon, SearchIcon } from './shellIcons.jsx'
import { ShortcutList } from './ShortcutHints.jsx'
import ThemeToggle from './ThemeToggle.jsx'

// Chrome-style tab strip. Purely presentational: the shell owns the tab list.
//  - click = activate, middle-click / × / Alt+W = close, drag = reorder,
//    right-click = context menu, wheel = horizontal scroll
//  - a new tab grows in (tab-enter); neighbours slide into place (FLIP) when a
//    tab closes or moves
//  - the active tab carries its provider's color as a top bar; a session that
//    is being written to right now pulses its dot green, one with a terminal
//    running pulses it red
export default function TabStrip({
  tabs,
  activeKey,
  providers,
  live,
  termKeys,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
  onNew,
  onReorder,
  onSearch,
  onHome,
  onCopyLink,
  sidebarCollapsed,
  onToggleSidebar,
}) {
  const scrollRef = useRef(null)
  const els = useRef(new Map()) // key -> element
  const lefts = useRef(new Map()) // key -> last measured left (for FLIP)
  const seen = useRef(new Set(tabs.map((t) => t.key))) // tabs present on first paint don't animate in
  const dragKey = useRef(null)
  const [menu, setMenu] = useState(null) // { x, y, key }
  const [help, setHelp] = useState(false) // the "?" shortcuts popover

  const measure = () => {
    const next = new Map()
    for (const [key, el] of els.current) if (el) next.set(key, el.getBoundingClientRect().left)
    lefts.current = next
  }

  // FLIP: a tab whose slot moved (a neighbour closed / reorder) slides from its
  // old position instead of jumping. Entering tabs animate via CSS instead.
  useLayoutEffect(() => {
    for (const [key, el] of els.current) {
      if (!el) continue
      const old = lefts.current.get(key)
      const now = el.getBoundingClientRect().left
      if (old == null || Math.abs(old - now) < 0.5 || el.classList.contains('tab-enter')) continue
      el.style.transition = 'none'
      el.style.transform = `translateX(${old - now}px)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform 170ms cubic-bezier(.2,.8,.2,1)'
        el.style.transform = ''
      })
    }
    measure()
    for (const t of tabs) seen.current.add(t.key)
  })

  // keep the active tab in view
  useEffect(() => {
    els.current.get(activeKey)?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [activeKey])

  // context menu / help popover: close on outside click / Esc
  useEffect(() => {
    if (!menu && !help) return
    const off = () => {
      setMenu(null)
      setHelp(false)
    }
    const key = (e) => e.key === 'Escape' && off()
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', off)
    }
  }, [menu, help])

  const onWheel = (e) => {
    const el = scrollRef.current
    if (!el || !e.deltaY || e.deltaX) return
    el.scrollLeft += e.deltaY
  }

  const onDragOver = (e, overKey) => {
    e.preventDefault()
    const from = dragKey.current
    if (!from || from === overKey) return
    const el = els.current.get(overKey)
    if (!el) return
    const r = el.getBoundingClientRect()
    const fromIdx = tabs.findIndex((t) => t.key === from)
    let toIdx = tabs.findIndex((t) => t.key === overKey)
    if (e.clientX > r.left + r.width / 2) toIdx += 1
    if (fromIdx < toIdx) toIdx -= 1
    if (toIdx !== fromIdx) onReorder(from, toIdx)
  }

  const menuTab = menu ? tabs.find((t) => t.key === menu.key) : null
  const menuIdx = menuTab ? tabs.indexOf(menuTab) : -1

  return (
    <div className="h-9 shrink-0 flex items-stretch bg-ink-900 border-b border-zinc-800 select-none" role="tablist">
      <button onClick={onHome} title="Home" className="shrink-0 flex items-center gap-2 pl-3 pr-3.5 text-emerald-400 hover:bg-ink-800 group/logo">
        <ActivityIcon className="w-[18px] h-[18px]" />
        <span className="hidden sm:inline text-[13px] font-semibold tracking-tight text-zinc-200 group-hover/logo:text-zinc-100">AgentDeck</span>
      </button>

      <div ref={scrollRef} onWheel={onWheel} className="flex-1 min-w-0 flex items-end overflow-x-auto no-scrollbar pt-1 px-0.5 gap-px">
        {tabs.map((tab) => {
          const active = tab.key === activeKey
          const t = tab.target
          const { primary, secondary } = tabLabel(t, providers)
          const color = providerColor(providers, t?.provider)
          const isLive = !!(t?.id && live?.ids?.has(liveSessionKey(t.provider, t.root, t.id)))
          const hasTerm = !!(
            t?.provider &&
            (t.id ? termKeys?.has(liveSessionKey(t.provider, t.root, t.id)) : t.draft && (termKeys?.has(`${t.provider}|${t.root}|new|${t.slug}`) || termKeys?.has(`${t.provider}|${t.root}|new|${t.cwd}`)))
          )
          const entering = !seen.current.has(tab.key)
          const dot = hasTerm ? 'bg-red-400 animate-pulse' : isLive ? 'bg-emerald-400 animate-pulse' : t?.provider ? color.dot : 'bg-zinc-600'
          return (
            <div
              key={tab.key}
              ref={(el) => (el ? els.current.set(tab.key, el) : els.current.delete(tab.key))}
              role="tab"
              aria-selected={active}
              draggable
              onDragStart={(e) => {
                dragKey.current = tab.key
                e.dataTransfer.effectAllowed = 'move'
                try {
                  e.dataTransfer.setData('text/plain', tab.key)
                } catch {}
              }}
              onDragOver={(e) => onDragOver(e, tab.key)}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={() => (dragKey.current = null)}
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => e.button === 1 && onClose(tab.key)}
              onClick={() => onSelect(tab.key)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, key: tab.key })
              }}
              onAnimationEnd={measure}
              title={`${primary}${secondary ? ` · ${secondary}` : ''}${hasTerm ? '\nterminal running' : ''}${t?.cwd || t?.slug ? `\n${t.cwd || t.slug}` : ''}`}
              className={`tab group relative flex items-center gap-2 h-8 pl-3 pr-1 min-w-[88px] max-w-[220px] flex-1 rounded-t-lg text-[12px] cursor-default overflow-hidden ${
                entering ? 'tab-enter' : ''
              } ${active ? 'bg-ink-700 text-zinc-100' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-300'}`}
              style={active ? { boxShadow: `inset 0 2px 0 ${color.bar}` } : undefined}
            >
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot}`} />
              <span className="min-w-0 flex-1 truncate">
                <span className={active ? 'font-medium' : ''}>{primary}</span>
                {secondary && <span className="text-zinc-500"> · {secondary}</span>}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.key)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Close tab  (Alt+W)"
                className={`shrink-0 w-5 h-5 rounded flex items-center justify-center hover:bg-zinc-700/60 hover:text-zinc-100 ${
                  active ? 'text-zinc-400' : 'text-transparent group-hover:text-zinc-400'
                }`}
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}
        <button onClick={onNew} title="New tab  (Alt+T)" className="shrink-0 w-7 h-7 mb-0.5 ml-0.5 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-ink-800">
          <PlusIcon />
        </button>
      </div>

      <button
        onClick={onSearch}
        title="Search projects & sessions  (Ctrl+K)"
        className="shrink-0 self-center mx-2 h-6 flex items-center gap-2 pl-2.5 pr-1.5 rounded-full bg-ink-800 border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700 text-[11.5px]"
      >
        <SearchIcon className="w-3.5 h-3.5" />
        <span className="hidden md:inline">Search…</span>
        <kbd className="hidden md:inline text-[10px] px-1 py-px rounded bg-ink-700 text-zinc-500 border border-zinc-800">Ctrl K</kbd>
      </button>
      {onToggleSidebar && (
        <button onClick={onToggleSidebar} title={`${sidebarCollapsed ? 'Show' : 'Hide'} sidebar  (Ctrl+B)`} className={`shrink-0 self-center mr-1 w-7 h-7 rounded-md flex items-center justify-center hover:bg-ink-700 ${sidebarCollapsed ? 'text-zinc-300 bg-ink-800' : 'text-zinc-500 hover:text-zinc-100'}`}>
          <PanelLeftIcon />
        </button>
      )}
      <ThemeToggle compact className="shrink-0 self-center mr-1" />
      <button
        onClick={() => setHelp((h) => !h)}
        onMouseDown={(e) => e.stopPropagation()}
        title="Keyboard shortcuts"
        className={`shrink-0 self-center mr-2 w-6 h-6 rounded-full border text-[11px] font-semibold ${
          help ? 'border-zinc-600 bg-ink-600 text-zinc-100' : 'border-zinc-800 bg-ink-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700'
        }`}
      >
        ?
      </button>
      {help && (
        <div onMouseDown={(e) => e.stopPropagation()} className="fixed z-50 right-3 top-10 w-[360px] rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl p-3">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Keyboard shortcuts</span>
            <button onClick={() => setHelp(false)} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <ShortcutList />
          <div className="mt-3 text-[11px] text-zinc-600">Ctrl+T / Ctrl+W / Ctrl+Tab belong to the browser, so tab keys use Alt.</div>
        </div>
      )}

      {menu && menuTab && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[170px] py-1 rounded-md border border-zinc-700 bg-ink-800 shadow-2xl text-[12px] text-zinc-300"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: menu.y + 2 }}
        >
          {[
            ['Close tab', () => onClose(menu.key), true, 'Alt W'],
            ['Close other tabs', () => onCloseOthers(menu.key), tabs.length > 1],
            ['Close tabs to the right', () => onCloseRight(menu.key), menuIdx < tabs.length - 1],
            ['Copy link', () => onCopyLink(menu.key), !!menuTab.target?.provider],
          ].map(([label, fn, enabled, keys]) => (
            <button
              key={label}
              disabled={!enabled}
              onClick={() => {
                setMenu(null)
                fn()
              }}
              className="w-full flex items-center justify-between gap-6 text-left px-3 py-1.5 hover:bg-ink-600 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <span>{label}</span>
              {keys && <span className="text-[10.5px] text-zinc-500 font-mono">{keys}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
