import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { highlightChunks, matchFields } from '../../lib/fuzzy.js'
import { fmtRelative } from '../../lib/format.js'
import { targetKey } from '../../lib/tabs.js'
import { isPinned, togglePin, usePins } from '../../lib/pins.js'
import { providerColor, statusDot } from '../../lib/providerColors.js'
import { liveProjectKey, liveSessionKey } from '../../lib/useLiveKeys.js'
import { usePrefs } from '../../lib/prefs.js'
import { ChevronRightIcon, PinIcon, PlusIcon, SearchIcon } from './shellIcons.jsx'

// Quick switcher (Ctrl+K): jump to any project or session across every
// provider and tracked folder without touching the sidebar.
//
//   top level   projects + sessions matching the query (recent ones when empty)
//   project     → / Tab drills into a project: its sessions, newest first, with
//               the first prompt under each title so you can recognise one you
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
const MAX_PROJECTS = 6
const MAX_SESSIONS = 8
const RECENT_ROWS = 8
const RECENT_PROJECT_ROWS = 10
const LEVEL_ROWS = 80

function Hl({ text, hits, className }) {
  const chunks = highlightChunks(text, hits)
  return (
    <span className={className}>
      {chunks.map((c, i) =>
        c.hit ? (
          <mark key={i} className="bg-transparent text-sky-300 font-semibold">
            {c.text}
          </mark>
        ) : (
          <span key={i}>{c.text}</span>
        )
      )}
    </span>
  )
}

const byScore = (a, b) => b.m.score - a.m.score
const projectTarget = (p) => ({
  provider: p.provider,
  providerLabel: p.providerLabel,
  root: p.root,
  rootLabel: p.rootLabel,
  slug: p.slug,
  cwd: p.cwd,
  name: p.name,
  path: p.path,
  sessionCount: p.sessionCount,
  lastActivity: p.lastActivity,
})

// the pin identity of a row (a project pins the project, a session the session)
export function pinTargetOf(row) {
  const t = row?.target
  if (!t) return null
  if (row.kind === 'project') return { provider: t.provider, root: t.root, rootLabel: t.rootLabel, slug: t.slug, cwd: t.cwd, project: t.name }
  if (row.kind === 'session') return { provider: t.provider, root: t.root, rootLabel: t.rootLabel, slug: t.slug, id: t.id, title: t.title, project: t.project, cwd: t.cwd }
  return null
}

function buildGroups({ q, level, index, recent, pins, live, openTabs, providers, showPrompt = true }) {
  const isLiveS = (t) => live.ids.has(liveSessionKey(t.provider, t.root, t.id))
  const isLiveP = (p) => live.slugs.has(liveProjectKey(p.provider, p.root, p.slug))
  const plabel = (id) => providers.find((p) => p.id === id)?.label || id
  const projRow = (p, hits) => ({
    kind: 'project',
    key: `p|${p.provider}|${p.root}|${p.slug}`,
    target: projectTarget(p),
    primary: p.name,
    secondary: `${p.providerLabel || plabel(p.provider)} · ${p.rootLabel || ''} · ${p.path || ''}`,
    meta: p.lastActivity ? fmtRelative(p.lastActivity) : '',
    count: p.sessionCount,
    live: isLiveP(p),
    hits,
  })
  const sessRow = (s, hits, project, metaTs) => ({
    kind: 'session',
    key: `s|${targetKey(s)}`,
    target: { provider: s.provider, root: s.root, rootLabel: index.labelOf(s.provider, s.root, s.rootLabel), slug: s.slug, id: s.id, title: s.title, project: project || s.project || null, cwd: s.cwd || null },
    primary: s.title || String(s.id || '').slice(0, 8),
    secondary: showPrompt && s.firstPrompt && s.firstPrompt !== s.title ? s.firstPrompt : '',
    context: [project || s.project, plabel(s.provider)].filter(Boolean).join(' · '),
    meta: metaTs ? fmtRelative(metaTs) : '',
    live: isLiveS(s),
    open: openTabs.has(targetKey(s)),
    oversized: !!s.oversized,
    hits,
  })
  const findProject = (t) => index.projects.find((p) => p.provider === t.provider && p.root === t.root && p.slug === t.slug)
  const pinProjRow = (p) => {
    const hit = findProject(p)
    if (hit) return projRow(hit)
    return { kind: 'project', key: `p|${p.provider}|${p.root}|${p.slug}`, target: { provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, name: p.project || p.slug, providerLabel: plabel(p.provider) }, primary: p.project || p.slug, secondary: `${plabel(p.provider)} · ${p.rootLabel || ''}`, meta: '' }
  }
  const groups = []

  if (level) {
    const list = index.sessionsFor(level.provider, level.root, level.slug)
    const rows = []
    if (list === null) rows.push({ kind: 'loading', key: 'loading' })
    else {
      let items
      if (q) {
        items = list
          .map((s) => ({ s, m: matchFields(q, { title: s.title, prompt: s.firstPrompt }) }))
          .filter((x) => x.m)
          .sort(byScore)
          .map((x) => sessRow(x.s, x.m.hits, level.name, x.s.lastTs))
      } else items = list.map((s) => sessRow(s, null, level.name, s.lastTs))
      rows.push(...items.slice(0, LEVEL_ROWS))
      if (!items.length) rows.push({ kind: 'empty', key: 'empty', text: q ? 'No matching sessions' : 'No sessions yet' })
    }
    rows.push({ kind: 'new', key: 'new', target: level, primary: `New conversation in ${level.name}` })
    groups.push({ title: `${level.name} · ${level.providerLabel || plabel(level.provider)} · ${level.rootLabel || ''}`, rows })
    return groups
  }

  if (!q) {
    const pinned = pins.map((p) => (p.id ? sessRow(p, null, p.project, null) : pinProjRow(p)))
    if (pinned.length) groups.push({ title: 'Pinned', rows: pinned })
    const pinnedKeys = new Set(pinned.map((r) => r.key))
    // recent = sessions only (projects have their own list right below)
    const rec = recent
      .filter((t) => t.id)
      .map((t) => sessRow(t, null, t.project, t.at))
      .filter((r) => !pinnedKeys.has(r.key))
      .slice(0, RECENT_ROWS)
    if (rec.length) groups.push({ title: 'Recent sessions', rows: rec })
    const projs = index.projects.slice(0, RECENT_PROJECT_ROWS)
    if (projs.length) groups.push({ title: 'Projects', rows: projs.map((p) => projRow(p)) })
    if (!rec.length && !projs.length) groups.push({ title: 'Projects', rows: [{ kind: 'empty', key: 'empty', text: index.loading ? 'Loading projects…' : 'No projects found' }] })
    return groups
  }

  const pm = index.projects
    .map((p) => ({ p, m: matchFields(q, { name: p.name, path: p.path, root: p.rootLabel, provider: p.providerLabel }) }))
    .filter((x) => x.m)
    .sort(byScore)
    .slice(0, MAX_PROJECTS)
  if (pm.length) groups.push({ title: 'Projects', rows: pm.map((x) => projRow(x.p, x.m.hits)) })

  // session candidates: recent ones + the lists of the best-matching projects
  // (fetched lazily; the switcher re-renders when they land)
  const cands = new Map()
  for (const t of recent) if (t.id) cands.set(targetKey(t), { s: t, project: t.project, ts: t.at })
  for (const { p } of pm.slice(0, 3)) {
    const list = index.sessionsFor(p.provider, p.root, p.slug)
    if (!list) continue
    for (const s of list) if (!cands.has(targetKey(s))) cands.set(targetKey(s), { s: { ...s, rootLabel: p.rootLabel }, project: p.name, ts: s.lastTs })
  }
  const sm = [...cands.values()]
    .map((c) => ({ ...c, m: matchFields(q, { title: c.s.title, prompt: c.s.firstPrompt || '', project: c.project || '' }) }))
    .filter((x) => x.m)
    .sort(byScore)
    .slice(0, MAX_SESSIONS)
  if (sm.length) groups.push({ title: 'Sessions', rows: sm.map((x) => sessRow(x.s, x.m.hits, x.project, x.ts)) })
  if (!pm.length && !sm.length) groups.push({ title: 'Results', rows: [{ kind: 'empty', key: 'empty', text: 'Nothing matches' }] })
  return groups
}

function Panel({ closing, onClose, providers, index, recent, live, openTabs, onPick, onNewConversation }) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState(null) // null = top level, else a project target
  const [slide, setSlide] = useState('')
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState({ top: 0, height: 0, visible: false })
  const pins = usePins()
  const prefs = usePrefs()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const rowEls = useRef([])
  const returnTo = useRef(null) // { key, query } — where ← lands after leaving a project level
  const pendingSel = useRef(null) // row key to select once the top-level list is back
  const levelKey = level ? `${level.provider}|${level.root}|${level.slug}` : 'top'

  useEffect(() => {
    inputRef.current?.focus()
    index.refresh(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = query.trim()
  const groups = useMemo(
    () => buildGroups({ q, level, index, recent, pins, live, openTabs, providers, showPrompt: prefs.showFirstPrompt }),
    // index is a fresh object whenever the shell re-renders (a session list landed)
    [q, level, index, recent, pins, live, openTabs, providers, prefs.showFirstPrompt]
  )
  const flat = useMemo(() => groups.flatMap((g) => g.rows).filter((r) => r.kind !== 'loading' && r.kind !== 'empty'), [groups])
  const flatKeys = flat.map((r) => r.key).join('|')

  useEffect(() => setSel(0), [q, levelKey])
  // leaving a project level lands back on the project row we came from
  useEffect(() => {
    const key = pendingSel.current
    if (!key) return
    pendingSel.current = null
    const i = flat.findIndex((r) => r.key === key)
    if (i >= 0) setSel(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKeys])
  useEffect(() => {
    if (sel > flat.length - 1) setSel(Math.max(0, flat.length - 1))
  }, [flat.length, sel])

  // the sliding highlight follows the selected row
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

  const drill = (row) => {
    if (row?.kind !== 'project') return
    returnTo.current = { key: row.key, query }
    setLevel(row.target)
    setQuery('')
    setSlide('qs-in-right')
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

  const act = async (row, { newTab = false } = {}) => {
    if (!row || busy) return
    if (row.kind === 'session') return onPick(row.target, { newTab })
    if (row.kind === 'new') return onNewConversation(row.target)
    if (row.kind === 'project') {
      const p = row.target
      setBusy(true)
      let list = []
      try {
        list = await index.loadSessions(p.provider, p.root, p.slug)
      } finally {
        setBusy(false)
      }
      const liveOne = list.find((s) => live.ids.has(liveSessionKey(s.provider, s.root, s.id)))
      const pick = liveOne || list[0]
      if (pick) onPick({ provider: pick.provider, root: pick.root, rootLabel: p.rootLabel, slug: pick.slug, id: pick.id, title: pick.title, project: p.name, cwd: p.cwd }, { newTab })
      else onPick({ provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name }, { newTab })
    }
  }

  const onKeyDown = (e) => {
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
    } else if ((e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd)) && !level && flat[sel]?.kind === 'project') {
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
      <div className="qs-backdrop absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label="Quick switcher"
        className="qs-panel absolute left-1/2 top-[12vh] -translate-x-1/2 w-[680px] max-w-[94vw] max-h-[74vh] flex flex-col rounded-xl border border-zinc-700/80 bg-ink-800 shadow-2xl shadow-black/50 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 h-12 border-b border-zinc-800">
          <SearchIcon className="w-4 h-4 text-zinc-500 shrink-0" />
          {level && (
            <button onClick={back} title="Back to all projects  (← or Backspace)" className="qs-chip shrink-0 flex items-center gap-1 pl-2 pr-1.5 h-6 rounded-md bg-ink-600 text-[12px] text-zinc-100 hover:bg-ink-500">
              <span className={`w-1.5 h-1.5 rounded-full ${providerColor(providers, level.provider).dot}`} />
              <span className="max-w-[200px] truncate">{level.name}</span>
              <ChevronRightIcon className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={level ? `Search sessions in ${level.name}…` : 'Jump to a project or session…'}
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
                  if (row.kind === 'loading') return <div key={row.key} className="px-3 py-3 text-[12px] text-zinc-600">Loading sessions…</div>
                  if (row.kind === 'empty') return <div key={row.key} className="px-3 py-3 text-[12px] text-zinc-600">{row.text}</div>
                  const i = ++rowIndex
                  const selected = i === sel
                  const color = providerColor(providers, row.target?.provider)
                  const dot = row.live ? statusDot('writing') : color.dot
                  const pinT = pinTargetOf(row)
                  const pinned = pinT ? isPinned(pinT) : false
                  return (
                    <div
                      key={row.key}
                      ref={(el) => (rowEls.current[i] = el)}
                      onMouseMove={() => !selected && setSel(i)}
                      onClick={(e) => act(row, { newTab: e.ctrlKey || e.metaKey })}
                      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                      onAuxClick={(e) => e.button === 1 && act(row, { newTab: true })}
                      className="relative z-[1] flex items-center gap-2.5 px-2.5 py-[7px] rounded-md cursor-default"
                    >
                      {row.kind === 'new' ? (
                        <span className="w-4 h-4 flex items-center justify-center text-emerald-300 shrink-0">
                          <PlusIcon className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <span className="w-4 flex items-center justify-center shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={`flex items-center gap-2 text-[13px] truncate ${row.kind === 'new' ? 'text-emerald-300' : 'text-zinc-100'}`}>
                          <Hl text={row.primary} hits={row.hits?.title || row.hits?.name} className="truncate" />
                          {pinned && <PinIcon className="w-3 h-3 text-amber-300 shrink-0" filled />}
                          {row.oversized && <span className="text-amber-400 text-[11px] shrink-0" title="Transcript exceeds the parse limit">⚠</span>}
                          {row.open && <span className="shrink-0 text-[9.5px] uppercase tracking-wide px-1 py-px rounded border border-sky-500/40 text-sky-300">open</span>}
                          {row.live && <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-emerald-300">live</span>}
                          {row.kind === 'project' && row.count != null && <span className="shrink-0 text-[11px] text-zinc-600">{row.count}</span>}
                        </div>
                        {row.secondary && (
                          <div className="text-[11.5px] text-zinc-500 truncate">
                            <Hl text={row.secondary} hits={row.hits?.prompt || row.hits?.path || row.hits?.root || row.hits?.provider} />
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
                      {row.kind === 'project' && !level && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            drill(row)
                          }}
                          title="Browse this project's sessions  (→)"
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
          <span><kbd className="text-zinc-500">↑↓</kbd> move</span>
          <span><kbd className="text-zinc-500">↵</kbd> open</span>
          {!level && <span><kbd className="text-zinc-500">→</kbd> into project</span>}
          {level && <span><kbd className="text-zinc-500">←</kbd> back</span>}
          <span><kbd className="text-zinc-500">ctrl ↵</kbd> new tab</span>
          <span><kbd className="text-zinc-500">esc</kbd> {level ? 'back' : 'close'}</span>
          <span className="flex-1" />
          {index.loading && <span>indexing…</span>}
        </div>
      </div>
    </div>
  )
}

export default function QuickSwitcher({ open, ...rest }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (!mounted) return null
  return <Panel closing={closing} {...rest} />
}
