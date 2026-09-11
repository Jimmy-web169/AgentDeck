import type { KeyboardEvent } from 'react'
import type { NavSession } from '../../api/useNavIndex.ts'
import { buildGroups, pinTargetOf, type SearchTarget, type SearchAction, type SearchInputs } from '../../lib/quickSwitcher.ts'
interface PanelProps
  extends Omit<
    SearchInputs,
    'q' | 'level' | 'pins' | 'folders' | 'foldersLoading' | 'foldersError' | 'folderFilter' | 'pinnedFolders' | 'sidebarMode' | 'showLatestPrompt'
  > {
  closing: boolean
  onClose: () => void
  onPick: (target: Target, options: { newTab: boolean }) => void
  onNewConversation: (target: Target) => void
}
import { quickResultKeys, folderItemKey } from '../../../shared/identity.ts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MOD } from './ShortcutHints.tsx'
import { highlightChunks } from '../../lib/fuzzy.ts'
import { isPinned, togglePin, usePins, revealPinnedFolder } from '../../lib/pins.ts'
import useFolderCatalog from '../../lib/useFolderCatalog.ts'
import { resolveFolderPins } from '../../lib/folderTree.ts'
import { FolderIcon } from './icons.tsx'
import { providerColor, statusDot } from '../../lib/providerColors.ts'
import { liveProjectKey, liveSessionKey } from '../../../shared/identity.ts'
import { usePrefs } from '../../lib/prefs.ts'
import { ChevronRightIcon, HomeIcon, PinIcon, PlusIcon, SearchIcon } from './shellIcons.tsx'
import type { Target } from '../../../shared/types.js'

// Quick switcher (Ctrl+K): jump to any project or session across every
// provider and tracked folder without touching the sidebar.
//
//   top level   projects + sessions matching the query (recent ones when empty)
//   project     → / Tab drills into a project: its sessions, newest first, with
//               a question preview under each title so you can recognise one you
//               don't remember the name of. ← (caret at the start), Backspace
//               (empty query) or Esc go back, landing on the project row you
//               came from with your query restored.
//   Enter       opens (a project → its live or newest session)
//   Ctrl+Enter  opens in a new tab
//   pin         every row has a pin toggle; pinned items lead the empty query
//
// Motion: the panel pops in/out, levels slide sideways, the highlight glides
// between rows (one absolutely positioned cursor, not per-row backgrounds).
// Everything respects prefers-reduced-motion (see index.css).

const CLOSE_MS = 120

function Hl({ text, hits, className }: { text: string; hits?: number[]; className?: string }) {
  const chunks = highlightChunks(text, hits)
  return (
    <span className={className}>
      {chunks.map((c, i) =>
        c.hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: Highlight runs are stateless text spans, identified by their position in this string.
          <mark key={i} className="bg-transparent text-sky-300 font-semibold">
            {c.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: Highlight runs are stateless text spans, identified by their position in this string.
          <span key={i}>{c.text}</span>
        )
      )}
    </span>
  )
}

function Panel({ closing, onClose, providers, index, recent, live, openTabs, terminals = [], onPick, onNewConversation }: PanelProps) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<SearchTarget | null>(null) // null = top level, else a project target
  const [slide, setSlide] = useState('')
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState({ top: 0, height: 0, visible: false })
  const pins = usePins()
  const prefs = usePrefs()
  const pinCatalog = useFolderCatalog(prefs.sidebarMode === 'folder')
  const pinnedFolders = useMemo(
    () =>
      pinCatalog.loading
        ? []
        : resolveFolderPins(pins, pinCatalog.folders, {
            excludedProviders: prefs.folderExcludedProviders,
            excludedRoots: prefs.folderExcludedRoots,
            showUnavailable: prefs.showUnavailableFolders,
          }),
    [pinCatalog.loading, pinCatalog.folders, pins, prefs.folderExcludedProviders, prefs.folderExcludedRoots, prefs.showUnavailableFolders]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef<(HTMLDivElement | null)[]>([])
  const returnTo = useRef<{ key: string; query: string } | null>(null) // { key, query } — where ← lands after leaving a project level
  const pendingSel = useRef<string | null>(null) // row key to select once the top-level list is back
  const levelKey = level
    ? level.sources
      ? folderItemKey(level.folderId || '')
      : liveProjectKey(level.provider || '', level.root || '', level.slug || '')
    : 'top'

  // biome-ignore lint/correctness/useExhaustiveDependencies: A mode change intentionally leaves the previous mode's drill-down.
  useEffect(() => {
    setLevel(null)
    returnTo.current = null
  }, [prefs.sidebarMode])

  const refreshIndex = index.refresh
  useEffect(() => {
    inputRef.current?.focus()
    refreshIndex(false)
  }, [refreshIndex])

  const q = query.trim()
  const groups = useMemo(
    () =>
      buildGroups({
        q,
        level,
        index,
        recent,
        pins,
        live,
        openTabs,
        providers,
        terminals,
        showLatestPrompt: prefs.showLatestPrompt,
        sidebarMode: prefs.sidebarMode,
        pinnedFolders,
        folders: pinCatalog.folders,
        foldersLoading: pinCatalog.loading,
        foldersError: pinCatalog.error,
        folderFilter: {
          excludedProviders: prefs.folderExcludedProviders,
          excludedRoots: prefs.folderExcludedRoots,
          showUnavailable: prefs.showUnavailableFolders,
        },
      }),
    // index is a fresh object whenever the shell re-renders (a session list landed)
    [q, level, index, recent, pins, live, openTabs, providers, terminals, prefs, pinnedFolders, pinCatalog.folders, pinCatalog.loading, pinCatalog.error]
  )
  const flat = useMemo(() => groups.flatMap((g) => g.rows).filter((r) => r.kind !== 'loading' && r.kind !== 'empty'), [groups])
  const flatKeys = quickResultKeys(flat.map((r) => r.key))

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new search or project level intentionally resets keyboard selection.
  useEffect(() => setSel(0), [q, levelKey])
  // leaving a project level lands back on the project row we came from
  useEffect(() => {
    const key = pendingSel.current
    if (!key) return
    pendingSel.current = null
    const i = flat.findIndex((r) => r.key === key)
    if (i >= 0) setSel(i)
  }, [flat])
  useEffect(() => {
    if (sel > flat.length - 1) setSel(Math.max(0, flat.length - 1))
  }, [flat.length, sel])

  // the sliding highlight follows the selected row
  // biome-ignore lint/correctness/useExhaustiveDependencies: Row order and project transitions change measured DOM offsets even when the selected ordinal is unchanged.
  useLayoutEffect(() => {
    const el = rowEls.current[sel]
    if (!el) {
      setCursor((c) => (c.visible ? { ...c, visible: false } : c))
      return
    }
    setCursor({ top: el.offsetTop, height: el.offsetHeight, visible: true })
    const list = listRef.current
    if (list) {
      const top = el.offsetTop
      const bottom = top + el.offsetHeight
      if (top < list.scrollTop + 8) list.scrollTop = Math.max(0, top - 8)
      else if (bottom > list.scrollTop + list.clientHeight - 8) list.scrollTop = bottom - list.clientHeight + 8
    }
  }, [sel, flatKeys, levelKey])

  const drill = (row: SearchAction | undefined) => {
    if (row?.kind !== 'project' && row?.kind !== 'folder-project') return
    returnTo.current = { key: row.key, query }
    setLevel(row.target)
    setQuery('')
    setSlide('qs-in-right')
    inputRef.current?.focus()
  }
  const back = () => {
    const r = returnTo.current
    returnTo.current = null
    pendingSel.current = r?.key || null
    setLevel(null)
    setQuery(r?.query || '')
    setSlide('qs-in-left')
    inputRef.current?.focus()
  }

  const act = async (row: SearchAction | undefined, { newTab = false } = {}) => {
    if (!row || busy) return
    if (row.kind === 'home') return onPick(row.target, { newTab })
    if (row.kind === 'folder-project') return drill(row)
    if (row.kind === 'folder') {
      revealPinnedFolder(row.target)
      onClose()
      return
    }
    if (row.kind === 'terminal') return onPick(row.target, { newTab: true })
    if (row.kind === 'session') return onPick(row.target, { newTab })
    if (row.kind === 'new') return onNewConversation(row.target)
    if (row.kind === 'project') {
      const p = row.target
      setBusy(true)
      let list: NavSession[] = []
      try {
        list = await index.loadSessions(p.provider || '', p.root || '', p.slug || '')
      } finally {
        setBusy(false)
      }
      const liveOne = list.find((s: { provider: string; root: string; id: string }) => live.ids.has(liveSessionKey(s.provider || '', s.root || '', s.id || '')))
      const pick = liveOne || list[0]
      if (pick)
        onPick(
          { provider: pick.provider, root: pick.root, rootLabel: p.rootLabel, slug: pick.slug, id: pick.id, title: pick.title, project: p.name, cwd: p.cwd },
          { newTab }
        )
      else onPick({ provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name }, { newTab })
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const input = inputRef.current
    const atEnd = !input || input.selectionStart === query.length
    const atStart = !input || (input.selectionStart === 0 && input.selectionEnd === 0)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(flat.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Home' && !query) {
      e.preventDefault()
      setSel(0)
    } else if (e.key === 'End' && !query) {
      e.preventDefault()
      setSel(Math.max(0, flat.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      act(flat[sel], { newTab: e.ctrlKey || e.metaKey || e.shiftKey })
    } else if ((e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) && !level && (flat[sel]?.kind === 'project' || flat[sel]?.kind === 'folder-project')) {
      e.preventDefault()
      drill(flat[sel])
    } else if (e.key === 'Tab') {
      e.preventDefault()
    } else if (e.key === 'ArrowLeft' && level && atStart) {
      e.preventDefault()
      back()
    } else if (e.key === 'Backspace' && !query && level) {
      e.preventDefault()
      back()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (level) back()
      else onClose()
    }
  }

  let rowIndex = -1
  return (
    <div className={`fixed inset-0 z-50 ${closing ? 'qs-closing' : ''}`}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Pointer-only backdrop; the focused search input handles Escape dismissal. */}
      <div className="qs-backdrop absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label="Quick switcher"
        className="qs-panel absolute left-1/2 top-[12vh] -translate-x-1/2 w-[680px] max-w-[94vw] max-h-[74vh] flex flex-col rounded-xl border border-zinc-700/80 bg-ink-800 shadow-2xl shadow-black/50 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 h-12 border-b border-zinc-800">
          <SearchIcon className="w-4 h-4 text-zinc-500 shrink-0" />
          {level && (
            <button
              type="button"
              onClick={back}
              title="Back to all results  (← or Backspace)"
              className="qs-chip shrink-0 flex items-center gap-1 pl-2 pr-1.5 h-6 rounded-md bg-ink-600 text-[12px] text-zinc-100 hover:bg-ink-500"
            >
              {level.sources ? (
                <FolderIcon className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full ${providerColor(providers, level.provider).dot}`} />
              )}
              <span className="max-w-[200px] truncate">{level.name}</span>
              <ChevronRightIcon className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              level
                ? `Search sessions in ${level.name}…`
                : prefs.sidebarMode === 'folder'
                  ? 'Jump to Home, a folder or session…'
                  : 'Jump to Home, a project or session…'
            }
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-zinc-100 placeholder-zinc-600"
          />
          {busy && <span className="text-[11px] text-zinc-500 shrink-0">opening…</span>}
          <kbd className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-zinc-500 border border-zinc-800">esc</kbd>
        </div>

        <div ref={listRef} className="relative flex-1 min-h-0 overflow-y-auto p-1.5">
          <div key={levelKey} className={slide}>
            <div
              key={`cursor-${levelKey}`}
              className="qs-cursor absolute left-1.5 right-1.5 rounded-md bg-zinc-100/[0.07] pointer-events-none"
              style={{ top: cursor.top, height: cursor.height, opacity: cursor.visible ? 1 : 0 }}
            />
            {groups.map((g) => (
              <div key={g.title} className="mb-1">
                <div className="px-2.5 pt-2 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-600 truncate">{g.title}</div>
                {g.rows.map((row) => {
                  if (row.kind === 'loading')
                    return (
                      <div key={row.key} className="px-3 py-3 text-[12px] text-zinc-600">
                        {row.text || 'Loading sessions…'}
                      </div>
                    )
                  if (row.kind === 'empty')
                    return (
                      <div key={row.key} className="px-3 py-3 text-[12px] text-zinc-600">
                        {row.text}
                      </div>
                    )
                  const i = ++rowIndex
                  const selected = i === sel
                  const color = providerColor(providers, row.target?.provider)
                  const dot = row.running ? statusDot('terminal') : row.live ? statusDot('writing') : color.dot
                  const pinT = pinTargetOf(row)
                  const pinned = pinT ? isPinned(pinT) : false
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard activation is handled by the focused search input; this row also contains independent pin controls.
                    // biome-ignore lint/a11y/noStaticElementInteractions: This composite search row delegates keyboard navigation and activation to the input.
                    <div
                      key={row.key}
                      ref={(el) => {
                        rowEls.current[i] = el
                      }}
                      onMouseMove={() => !selected && setSel(i)}
                      onClick={(e) => act(row, { newTab: e.ctrlKey || e.metaKey })}
                      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                      onAuxClick={(e) => e.button === 1 && act(row, { newTab: true })}
                      className="relative z-[1] flex items-center gap-2.5 px-2.5 py-[7px] rounded-md cursor-default"
                    >
                      {row.kind === 'home' ? (
                        <HomeIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                      ) : row.kind === 'new' ? (
                        <span className="w-4 h-4 flex items-center justify-center text-emerald-300 shrink-0">
                          <PlusIcon className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="w-4 flex items-center justify-center shrink-0">
                          {row.kind === 'folder' || row.kind === 'folder-project' ? (
                            <FolderIcon className="w-3.5 h-3.5 text-zinc-500" />
                          ) : (
                            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          )}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={`flex items-center gap-2 text-[13px] truncate ${row.kind === 'new' ? 'text-emerald-300' : 'text-zinc-100'}`}>
                          <Hl text={row.primary} hits={row.hits?.title || row.hits?.name} className="truncate" />
                          {pinned && <PinIcon className="w-3 h-3 text-amber-300 shrink-0" filled />}
                          {row.oversized && (
                            <span className="text-amber-400 text-[11px] shrink-0" title="Transcript exceeds the parse limit">
                              ⚠
                            </span>
                          )}
                          {row.open && (
                            <span className="shrink-0 text-[9.5px] uppercase tracking-wide px-1 py-px rounded border border-sky-500/40 text-sky-300">
                              switch to tab
                            </span>
                          )}
                          {row.running && <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-red-300">running</span>}
                          {row.live && <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-emerald-300">live</span>}
                          {(row.kind === 'project' || row.kind === 'folder-project') && row.count != null && (
                            <span className="shrink-0 text-[11px] text-zinc-600">{row.count}</span>
                          )}
                        </div>
                        {row.secondary && (
                          <div className="flex items-baseline gap-2 text-[11.5px] text-zinc-500 min-w-0" title={row.secondary}>
                            <Hl
                              className="truncate"
                              text={row.secondary}
                              hits={row.kind === 'session' ? row.secondaryHits : row.hits?.path || row.hits?.root || row.hits?.provider}
                            />
                          </div>
                        )}
                      </div>
                      {row.context && (
                        <span className="shrink-0 max-w-[180px] truncate text-[11px] text-zinc-500">
                          <Hl text={row.context} hits={row.hits?.project} />
                        </span>
                      )}
                      {row.meta && <span className="shrink-0 w-[62px] text-right text-[11px] text-zinc-600">{row.meta}</span>}
                      {pinT && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePin(pinT)
                          }}
                          title={pinned ? 'Unpin' : 'Pin'}
                          className={`shrink-0 w-6 h-6 rounded flex items-center justify-center hover:bg-ink-600 ${pinned ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-100'} ${selected || pinned ? '' : 'opacity-40'}`}
                        >
                          <PinIcon className="w-3.5 h-3.5" filled={pinned} />
                        </button>
                      )}
                      {(row.kind === 'project' || row.kind === 'folder-project') && !level && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            drill(row)
                          }}
                          title={row.kind === 'folder-project' ? "Browse this folder's sessions  (→)" : "Browse this project's sessions  (→)"}
                          className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-ink-600 ${selected ? '' : 'opacity-40'}`}
                        >
                          <ChevronRightIcon />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 px-3 h-8 border-t border-zinc-800 text-[10.5px] text-zinc-600 shrink-0">
          <span>
            <kbd className="text-zinc-500">↑↓</kbd> move
          </span>
          <span>
            <kbd className="text-zinc-500">↵</kbd> open
          </span>
          {!level && (
            <span>
              <kbd className="text-zinc-500">→</kbd> {prefs.sidebarMode === 'folder' ? 'into folder' : 'into project'}
            </span>
          )}
          {level && (
            <span>
              <kbd className="text-zinc-500">←</kbd> back
            </span>
          )}
          {flat[sel]?.kind !== 'folder-project' && flat[sel]?.kind !== 'folder' && (
            <span>
              <kbd className="text-zinc-500">{MOD} ↵</kbd> new tab
            </span>
          )}
          <span>
            <kbd className="text-zinc-500">esc</kbd> {level ? 'back' : 'close'}
          </span>
          <span className="flex-1" />
          {index.loading && <span>indexing…</span>}
        </div>
      </div>
    </div>
  )
}

export default function QuickSwitcher({ open, ...rest }: Omit<PanelProps, 'closing'> & { open: boolean }) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, CLOSE_MS)
    return () => clearTimeout(t)
  }, [open, mounted])
  if (!mounted) return null
  return <Panel closing={closing} {...rest} />
}
