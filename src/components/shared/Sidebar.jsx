import { useState } from 'react'
import { api } from '../../api.js'
import { fmtRelative } from '../../lib/format.js'
import { ActivityIcon } from './icons.jsx'
import PathPicker from './PathPicker.jsx'

function shortPath(cwd, slug) {
  const p = cwd || slug || ''
  const parts = p.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || p || '(unknown)'
}

// Provider differences are props with claude defaults:
// - `rootStatusField` (default 'hasProjects') + `noHistorySuffix` decorate the
//   root <select>.
// - `appName` is the header label.
// Subagent adornments (isSubagent / childCount) render only when present on the
// session object, so codex data lights them up and claude data does not.
export default function Sidebar({
  roots,
  root,
  onRoot,
  projects,
  openSlug,
  onOpenProject,
  sessions,
  activeSession,
  onSelectSession,
  loadingSessions,
  liveIds,
  onManageRoots,
  globalViews,
  activeGlobal,
  onGlobalView,
  onAddSession,
  onNewConversation,
  onNewProject,
  providers,
  provider,
  onProvider,
  rootStatusField = 'hasProjects',
  noHistorySuffix = ' (config only)',
  appName = 'AgentDeck',
  onLogo,
}) {
  const [filter, setFilter] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  // try the OS-native folder chooser first; fall back to the in-browser picker
  const newProjectFlow = async () => {
    if (picking) return
    setPicking(true)
    try {
      const r = await api.pickFolder()
      if (r?.ok && r.path) onNewProject(r.path)
      else if (!r?.cancelled) setPickerOpen(true) // native unavailable → fallback
    } catch {
      setPickerOpen(true)
    } finally {
      setPicking(false)
    }
  }

  const filtered = projects.filter((p) => {
    if (!filter) return true
    const hay = `${p.cwd || ''} ${p.slug}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })

  return (
    <aside className="w-full h-full flex flex-col bg-ink-900 border-r border-zinc-800">
      <div className="p-3 border-b border-zinc-800">
        <button
          onClick={onLogo}
          title="Open dashboard"
          className="flex items-center gap-2 mb-2.5 cursor-pointer group"
        >
          <span className="text-emerald-400"><ActivityIcon /></span>
          <span className="text-[13px] font-semibold tracking-tight text-zinc-200 group-hover:text-zinc-100">{appName}</span>
        </button>
        {providers?.length > 0 && (
          <select
            value={provider || ''}
            onChange={(e) => onProvider?.(e.target.value)}
            title="Switch monitored CLI agent"
            className="w-full mb-1.5 bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-300"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        )}
        <div className="flex gap-1.5">
          <select
            value={root || ''}
            onChange={(e) => onRoot(e.target.value)}
            className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-300"
          >
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r[rootStatusField] === false ? noHistorySuffix : ''}
              </option>
            ))}
            {roots.length === 0 && <option value="">no folders</option>}
          </select>
          <button
            onClick={onManageRoots}
            title="Manage tracked folders"
            className="shrink-0 px-2 rounded bg-ink-700 border border-zinc-700 text-zinc-400 hover:text-zinc-100 text-[12px]"
          >
            folders
          </button>
        </div>

        {/* folder(root)-scoped views — belong to the whole tracked folder */}
        {globalViews?.length > 0 && (
          <div className="mt-2">
            <div className="flex flex-wrap gap-1">
              {globalViews.map((g) => (
                <button
                  key={g.k}
                  onClick={() => onGlobalView(g.k)}
                  className={`text-[11px] px-2 py-1 rounded ${
                    activeGlobal === g.k ? 'bg-ink-600 text-zinc-100' : 'bg-ink-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects…"
          className="mt-2 w-full bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600"
        />

        {onNewProject && (
          <div className="mt-2">
            <button onClick={newProjectFlow} disabled={picking} className="w-full text-left text-[12px] text-emerald-300/80 hover:text-emerald-200 py-0.5 disabled:opacity-60" title="Pick a folder (opens Finder/Explorer) and start a new conversation there">
              {picking ? '+ opening folder chooser…' : '+ New project (choose a folder)'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map((p) => {
          const isOpen = p.slug === openSlug
          return (
            <div key={p.slug} className="border-b border-zinc-800/60">
              <button
                onClick={() => onOpenProject(isOpen ? null : p.slug)}
                className={`w-full text-left px-3 py-2 hover:bg-ink-700/50 ${isOpen ? 'bg-ink-700/40' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-600 text-xs">{isOpen ? '▾' : '▸'}</span>
                  <span className="text-[13px] text-zinc-200 truncate flex-1" title={p.cwd || p.slug}>
                    {shortPath(p.cwd, p.slug)}
                  </span>
                  <span className="text-[11px] text-zinc-600">{p.sessionCount}</span>
                </div>
              </button>

              {isOpen && (
                <div className="pb-1">
                  {onNewConversation && (
                    <button
                      onClick={() => onNewConversation(p.slug)}
                      className="w-full text-left pl-7 pr-2 py-1.5 text-[12px] text-emerald-300/80 hover:text-emerald-200 hover:bg-ink-700/50"
                      title="Start a new conversation in this project"
                    >
                      + New conversation
                    </button>
                  )}
                  {loadingSessions && <div className="px-7 py-2 text-[12px] text-zinc-600">loading…</div>}
                  {!loadingSessions &&
                    sessions.map((s) => {
                      const active = activeSession?.id === s.id
                      const live = liveIds?.has(s.id)
                      return (
                        <div
                          key={s.id}
                          className={`group flex items-stretch hover:bg-ink-700/50 ${active ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
                        >
                          <button onClick={() => onSelectSession(s)} className="flex-1 min-w-0 text-left pl-7 pr-2 py-1.5">
                            <div className="text-[12.5px] text-zinc-300 truncate flex items-center gap-1.5">
                              {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
                              {s.isSubagent && <span className="shrink-0 text-violet-400" title={`subagent${s.agentRole ? ` · ${s.agentRole}` : ''}`}>⤷</span>}
                              <span className="truncate">{s.title}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10.5px] text-zinc-600">
                              <span>{fmtRelative(s.lastTs)}</span>
                              <span>· {s.toolCalls} tools</span>
                              {s.childCount > 0 && <span className="text-violet-400/80">· ⤷ {s.childCount}</span>}
                              {s.hasSubagents && <span className="text-violet-400">· ⚇ subs</span>}
                            </div>
                          </button>
                          <button
                            onClick={() => onAddSession?.(s)}
                            title="Open in multi-session (compare)"
                            className="px-2 text-zinc-600 hover:text-sky-300 opacity-0 group-hover:opacity-100 shrink-0"
                          >
                            ⊞
                          </button>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="p-4 text-[12px] text-zinc-600">No projects.</div>}
      </div>

      {pickerOpen && (
        <PathPicker
          onPick={(p) => { setPickerOpen(false); onNewProject(p) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </aside>
  )
}
