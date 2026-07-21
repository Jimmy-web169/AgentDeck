import { useEffect, useState } from 'react'
import { fmtTokens } from '../../lib/format.js'

const sumTokens = (t = {}) => (t.input || 0) + (t.output || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0)
const shortName = (cwd, slug) => (cwd ? cwd.split('/').filter(Boolean).slice(-2).join('/') : slug)

function Tile({ label, value }) {
  return (
    <div className="rounded-lg bg-ink-700/60 border border-zinc-800 p-4">
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
      <div className="text-[12px] text-zinc-500 mt-0.5">{label}</div>
    </div>
  )
}

function BarList({ title, data, color }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  const max = entries.length ? entries[0][1] : 1
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">{title}</div>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-[12.5px] text-zinc-300 truncate font-mono">{k}</span>
            <div className="flex-1 bg-ink-900 rounded h-4 overflow-hidden">
              <div className={`h-full ${color}`} style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <span className="w-12 text-right text-[12px] text-zinc-400">{v}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="text-[12px] text-zinc-600">none</div>}
      </div>
    </div>
  )
}

// reusable stats panel — used at folder / project / session level
function StatBlock({ tokens, sessions, userTurns, toolCalls, toolCounts, models }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {sessions != null && <Tile label="sessions" value={sessions} />}
        <Tile label="user prompts" value={userTurns ?? 0} />
        <Tile label="tool calls" value={toolCalls ?? 0} />
        <Tile label="total tokens" value={fmtTokens(sumTokens(tokens))} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="input" value={fmtTokens(tokens?.input)} />
        <Tile label="output" value={fmtTokens(tokens?.output)} />
        <Tile label="cache read" value={fmtTokens(tokens?.cacheRead)} />
        <Tile label="cache create" value={fmtTokens(tokens?.cacheCreate)} />
      </div>
      <div className="pt-2">
        <BarList title="Tool usage" data={toolCounts} color="bg-emerald-500/70" />
      </div>
      {models?.length > 0 && (
        <div className="pt-1">
          <div className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Models</div>
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span key={m} className="text-[11px] font-mono px-2 py-1 rounded bg-ink-700 text-violet-200">{m}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DrillRow({ name, cwd, count, countLabel, toolCalls, total, max, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-2 hover:bg-ink-700/40 flex items-center gap-3 border-b border-zinc-800/60 last:border-0">
      <span className="flex-1 min-w-0 text-[13px] text-zinc-200 truncate" title={cwd || name}>{name}</span>
      {count != null && <span className="shrink-0 text-[11px] text-zinc-500">{count} {countLabel}</span>}
      <span className="shrink-0 text-[11px] text-zinc-500 w-16 text-right">{toolCalls} tools</span>
      <span className="shrink-0 w-24 hidden sm:block">
        <span className="block bg-ink-900 rounded h-3 overflow-hidden"><span className="block h-full bg-sky-500/70" style={{ width: `${max ? (total / max) * 100 : 0}%` }} /></span>
      </span>
      <span className="shrink-0 text-[11px] text-zinc-400 w-16 text-right">{fmtTokens(total)}</span>
      <span className="shrink-0 text-zinc-600 text-xs">›</span>
    </button>
  )
}

export default function Stats({ stats, root, focus, onOpenSession, apiClient }) {
  const [path, setPath] = useState({ slug: null, sid: null })
  const [sessionsBySlug, setSessionsBySlug] = useState({})

  // Reset the drill when the tracked folder (root) changes — OR, when arrived via a
  // Session → Stats deep link (`focus`), drill straight to that session (loading its
  // project's session list if needed). A fresh `focus` object re-triggers this even
  // when the target session is unchanged.
  useEffect(() => {
    if (!focus?.slug || !focus?.id) {
      setPath({ slug: null, sid: null })
      return
    }
    if (sessionsBySlug[focus.slug] === undefined) {
      apiClient
        .sessions(root, focus.slug)
        .then((d) => setSessionsBySlug((m) => ({ ...m, [focus.slug]: d.sessions })))
        .catch(() => setSessionsBySlug((m) => ({ ...m, [focus.slug]: [] })))
    }
    setPath({ slug: focus.slug, sid: focus.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.root, focus])

  if (!stats) return <div className="p-8 text-zinc-600">Loading stats…</div>
  const projects = stats.projects || []

  const goProject = (slug) => {
    if (sessionsBySlug[slug] === undefined) {
      apiClient.sessions(root, slug).then((d) => setSessionsBySlug((m) => ({ ...m, [slug]: d.sessions }))).catch(() => setSessionsBySlug((m) => ({ ...m, [slug]: [] })))
    }
    setPath({ slug, sid: null })
  }

  const proj = path.slug ? projects.find((p) => p.slug === path.slug) : null
  const sessions = path.slug ? sessionsBySlug[path.slug] : null
  const session = path.sid && sessions ? sessions.find((s) => s.id === path.sid) : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      {/* breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] flex-wrap">
        <button onClick={() => setPath({ slug: null, sid: null })} className={path.slug ? 'text-sky-400 hover:underline' : 'text-zinc-100 font-semibold'}>Folder</button>
        {proj && (
          <>
            <span className="text-zinc-600">/</span>
            <button onClick={() => setPath({ slug: path.slug, sid: null })} className={path.sid ? 'text-sky-400 hover:underline' : 'text-zinc-100 font-semibold'}>{shortName(proj.cwd, proj.slug)}</button>
          </>
        )}
        {session && (
          <>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-100 font-semibold truncate max-w-[40ch]">{session.title}</span>
            <button onClick={() => onOpenSession?.(path.slug, session)} className="ml-2 text-[11px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30">Open session ↗</button>
          </>
        )}
      </div>

      {!path.slug ? (
        // FOLDER level
        <>
          <StatBlock tokens={stats.tokens} sessions={stats.sessions} userTurns={stats.userTurns} toolCalls={stats.toolCalls} toolCounts={stats.toolCounts} models={Object.keys(stats.modelCounts || {})} />
          <div>
            <div className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">By project ({projects.length}) — click for project stats</div>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              {(() => {
                const max = projects.reduce((m, p) => Math.max(m, sumTokens(p.tokens)), 0)
                return projects.map((p) => (
                  <DrillRow key={p.slug} name={shortName(p.cwd, p.slug)} cwd={p.cwd} count={p.sessions} countLabel="sess" toolCalls={p.toolCalls} total={sumTokens(p.tokens)} max={max} onClick={() => goProject(p.slug)} />
                ))
              })()}
              {projects.length === 0 && <div className="px-3 py-3 text-[12px] text-zinc-600">no projects</div>}
            </div>
          </div>
        </>
      ) : !path.sid ? (
        // PROJECT level
        <>
          {proj ? (
            <StatBlock tokens={proj.tokens} sessions={proj.sessions} userTurns={proj.userTurns} toolCalls={proj.toolCalls} toolCounts={proj.toolCounts} models={proj.models} />
          ) : (
            <div className="text-zinc-600 text-sm">project not found</div>
          )}
          <div>
            <div className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">By session ({sessions?.length ?? '…'}) — click for session stats</div>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              {sessions === undefined || sessions === null ? (
                <div className="px-3 py-3 text-[12px] text-zinc-600">loading sessions…</div>
              ) : (
                (() => {
                  const max = sessions.reduce((m, s) => Math.max(m, sumTokens(s.tokens)), 0)
                  return sessions.map((s) => (
                    <DrillRow key={s.id} name={s.title} count={null} toolCalls={s.toolCalls} total={sumTokens(s.tokens)} max={max} onClick={() => setPath({ slug: path.slug, sid: s.id })} />
                  ))
                })()
              )}
              {sessions?.length === 0 && <div className="px-3 py-3 text-[12px] text-zinc-600">no sessions</div>}
            </div>
          </div>
        </>
      ) : (
        // SESSION level
        <>
          {session ? (
            <StatBlock tokens={session.tokens} userTurns={session.userTurns} toolCalls={session.toolCalls} toolCounts={session.toolCounts} models={session.models} />
          ) : (
            <div className="text-zinc-600 text-sm">session not found</div>
          )}
        </>
      )}
    </div>
  )
}
