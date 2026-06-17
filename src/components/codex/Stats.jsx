import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { fmtTokens, fmtRelative, fmtTime, totalTokens } from '../../lib/format.js'

function Card({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-ink-900/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-semibold text-zinc-100 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function Bars({ counts, color = 'bg-emerald-500/40' }) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1])
  const max = entries.length ? entries[0][1] : 1
  if (!entries.length) return <div className="text-[12px] text-zinc-600">none</div>
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-[12px]">
          <span className="w-40 truncate font-mono text-zinc-400" title={k}>{k}</span>
          <div className="flex-1 h-3 bg-ink-800 rounded overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <span className="w-12 text-right text-zinc-500">{v}</span>
        </div>
      ))}
    </div>
  )
}

function TokenCards({ t }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card label="Input tokens" value={fmtTokens(t.input)} />
      <Card label="Output tokens" value={fmtTokens(t.output)} />
      <Card label="Cached input" value={fmtTokens(t.cacheRead)} />
      <Card label="Total tokens" value={fmtTokens(t.total || totalTokens(t))} sub={t.reasoning ? `incl. ${fmtTokens(t.reasoning)} reasoning` : undefined} />
    </div>
  )
}

function Crumb({ children, onClick, last }) {
  return last ? (
    <span className="text-zinc-300">{children}</span>
  ) : (
    <button onClick={onClick} className="text-sky-400 hover:text-sky-300">{children}</button>
  )
}

const shortCwd = (p) => (p || '').split('/').filter(Boolean).slice(-2).join('/') || p || '(unknown)'

export default function Stats({ root, stats, focus, onOpenSession }) {
  const [proj, setProj] = useState(null) // selected project rollup { slug, cwd, ... }
  const [sessions, setSessions] = useState(null) // per-session summaries for proj
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sess, setSess] = useState(null) // selected session summary

  // Reset drill-down on root/stats change — OR, when arrived via a Session → Stats
  // deep link (`focus`), auto-drill straight to that session's stats. A fresh
  // `focus` object re-triggers this even when the target session is unchanged.
  useEffect(() => {
    if (!stats) return
    if (focus?.slug && focus?.id) {
      const p = (stats.projects || []).find((x) => x.slug === focus.slug)
      if (p) {
        setProj(p)
        setSess(null)
        setSessions(null)
        setLoadingSessions(true)
        api
          .sessions(root, p.slug)
          .then((d) => {
            setSessions(d.sessions)
            const s = d.sessions.find((x) => x.id === focus.id)
            if (s) setSess(s)
          })
          .catch(() => setSessions([]))
          .finally(() => setLoadingSessions(false))
        return
      }
    }
    setProj(null)
    setSessions(null)
    setSess(null)
  }, [root, stats, focus])

  const openProject = (p) => {
    setProj(p)
    setSess(null)
    setSessions(null)
    setLoadingSessions(true)
    api
      .sessions(root, p.slug)
      .then((d) => setSessions(d.sessions))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false))
  }

  if (!stats) return <div className="p-6 text-zinc-600 text-sm">Loading…</div>

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <Crumb onClick={() => { setProj(null); setSess(null) }} last={!proj}>All projects</Crumb>
        {proj && <span className="text-zinc-600">/</span>}
        {proj && <Crumb onClick={() => setSess(null)} last={!sess} >{shortCwd(proj.cwd || proj.slug)}</Crumb>}
        {sess && <span className="text-zinc-600">/</span>}
        {sess && <Crumb last>{(sess.title || sess.id).slice(0, 40)}</Crumb>}
      </div>

      {/* ---- level 3: a single session's stats ---- */}
      {sess ? (
        <>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{sess.title}</h2>
            <div className="text-[12px] text-zinc-600 mt-0.5">{sess.id} · {fmtTime(sess.firstTs)} → {fmtTime(sess.lastTs)}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="Prompts" value={sess.userTurns} />
            <Card label="Replies" value={sess.assistantTurns} />
            <Card label="Tool calls" value={sess.toolCalls} />
            <Card label="Models" value={sess.models?.join(', ') || '—'} />
          </div>
          <TokenCards t={sess.tokens} />
          <div>
            <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Tools used</h3>
            <Bars counts={sess.toolCounts} />
          </div>
          {onOpenSession && (
            <button onClick={() => onOpenSession(sess.id)} className="text-[13px] px-3 py-1.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30">Open conversation →</button>
          )}
        </>
      ) : proj ? (
        /* ---- level 2: a project's per-session stats ---- */
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="Sessions" value={proj.sessions} />
            <Card label="Prompts" value={proj.userTurns} />
            <Card label="Tool calls" value={proj.toolCalls} />
            <Card label="Total tokens" value={fmtTokens(proj.tokens.total || totalTokens(proj.tokens))} />
          </div>
          <TokenCards t={proj.tokens} />
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Tools used</h3>
              <Bars counts={proj.toolCounts} />
            </div>
            <div>
              <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Models</h3>
              <Bars counts={Object.fromEntries((proj.models || []).map((m) => [m, 1]))} color="bg-sky-500/40" />
            </div>
          </div>
          <div>
            <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Sessions (click for session stats)</h3>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-ink-900/60 text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">session</th>
                    <th className="text-right px-3 py-1.5 font-medium">prompts</th>
                    <th className="text-right px-3 py-1.5 font-medium">tools</th>
                    <th className="text-right px-3 py-1.5 font-medium">tokens</th>
                    <th className="text-right px-3 py-1.5 font-medium">last</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingSessions && <tr><td colSpan={5} className="px-3 py-3 text-zinc-600">loading…</td></tr>}
                  {sessions?.map((s) => (
                    <tr key={s.id} className="border-t border-zinc-800 hover:bg-ink-700/40 cursor-pointer" onClick={() => setSess(s)}>
                      <td className="px-3 py-1.5 text-zinc-300 truncate max-w-xs flex items-center gap-1.5" title={s.title}>
                        {s.isSubagent && <span className="text-violet-400">⤷</span>}
                        {s.title}
                      </td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{s.userTurns}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{s.toolCalls}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{fmtTokens(s.tokens.total || totalTokens(s.tokens))}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-600">{fmtRelative(s.lastTs)}</td>
                    </tr>
                  ))}
                  {sessions && sessions.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-zinc-600">no sessions</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* ---- level 1: all projects in this folder ---- */
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="Projects" value={stats.projectCount} />
            <Card label="Sessions" value={stats.sessions} />
            <Card label="Prompts" value={stats.userTurns} />
            <Card label="Tool calls" value={stats.toolCalls} />
          </div>
          <TokenCards t={stats.tokens} />
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Tools used</h3>
              <Bars counts={stats.toolCounts} />
            </div>
            <div>
              <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Models</h3>
              <Bars counts={stats.modelCounts} color="bg-sky-500/40" />
            </div>
          </div>
          <div>
            <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Projects (click for project stats)</h3>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-ink-900/60 text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">cwd</th>
                    <th className="text-right px-3 py-1.5 font-medium">sessions</th>
                    <th className="text-right px-3 py-1.5 font-medium">prompts</th>
                    <th className="text-right px-3 py-1.5 font-medium">tools</th>
                    <th className="text-right px-3 py-1.5 font-medium">tokens</th>
                    <th className="text-right px-3 py-1.5 font-medium">last</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.projects.map((p) => (
                    <tr key={p.slug} className="border-t border-zinc-800 hover:bg-ink-700/40 cursor-pointer" onClick={() => openProject(p)}>
                      <td className="px-3 py-1.5 font-mono text-zinc-300 truncate max-w-xs" title={p.slug}>{p.cwd || p.slug}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{p.sessions}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{p.userTurns}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{p.toolCalls}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{fmtTokens(p.tokens.total || totalTokens(p.tokens))}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-600">{fmtRelative(p.lastActivity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
