import { useEffect, useMemo, useState } from 'react'
import { createApi } from '../../api.js'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import { fmtTokens, fmtRelative } from '../../lib/format.js'
import TokenTiles from './TokenTiles.jsx'

// Home › Stats › All folders: every tracked folder of every provider summed on
// the fields they all agree on. GET /api/stats says which token fields are
// common (`fields.common`) — only those are added up; a provider's own fields
// (Codex's reasoning, Claude's cache create) are listed per folder instead, so
// a total never mixes things that mean different things.

function Tile({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-ink-900/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-semibold text-zinc-100 mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-zinc-600 mt-0.5">{hint}</div>}
    </div>
  )
}

function Bars({ counts, color = 'bg-emerald-500/40', limit = 10 }) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, limit)
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

const addInto = (into, counts) => {
  for (const [k, v] of Object.entries(counts || {})) into[k] = (into[k] || 0) + (Number(v) || 0)
}

export default function AllFoldersStats({ providers = [], index, onPick }) {
  const scopes = useMemo(() => (index?.scopes || []).filter((s) => s.exists !== false), [index?.scopes])
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    Promise.all(
      scopes.map((s) =>
        createApi(s.provider)
          .stats(s.root)
          .then((d) => ({ scope: s, stats: d }))
          .catch((e) => ({ scope: s, error: e.message }))
      )
    ).then((r) => !cancelled && setRows(r))
    return () => {
      cancelled = true
    }
  }, [scopes])

  const agg = useMemo(() => {
    if (!rows) return null
    const good = rows.filter((r) => r.stats)
    // the fields every provider present calls common — the greatest common divisor
    let common = null
    for (const r of good) {
      const c = r.stats.fields?.common || ['input', 'output', 'cacheRead', 'total']
      common = common ? common.filter((k) => c.includes(k)) : [...c]
    }
    common = common || []
    const tokens = Object.fromEntries(common.map((k) => [k, 0]))
    const out = { sessions: 0, userTurns: 0, toolCalls: 0, projects: 0, tokens, toolCounts: {}, modelCounts: {}, common, specific: [] }
    for (const r of good) {
      const d = r.stats
      out.sessions += d.sessions || 0
      out.userTurns += d.userTurns || 0
      out.toolCalls += d.toolCalls || 0
      out.projects += d.projectCount || (d.projects || []).length
      for (const k of common) tokens[k] += Number(d.tokens?.[k]) || 0
      addInto(out.toolCounts, d.toolCounts)
      addInto(out.modelCounts, d.modelCounts)
      for (const k of d.fields?.specific || []) if (d.tokens?.[k]) out.specific.push({ scope: r.scope, field: k, value: d.tokens[k] })
    }
    return out
  }, [rows])

  if (!scopes.length) return <div className="p-8 text-center text-[13px] text-zinc-600">No tracked folders yet — add one with the + next to the folder chips.</div>
  if (!rows || !agg) return <div className="p-6 text-zinc-600 text-sm">Loading {scopes.length} folder{scopes.length === 1 ? '' : 's'}…</div>

  const lastOf = (d) => Math.max(0, ...(d.projects || []).map((p) => Number(p.lastActivity) || 0))
  const total = (d) => d.tokens?.total || 0

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
      <div className="text-[13px] text-zinc-300">
        All folders <span className="text-zinc-600">· {scopes.length} tracked, {providers.filter((p) => scopes.some((s) => s.provider === p.id)).map((p) => p.label).join(', ')}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Projects" value={agg.projects} />
        <Tile label="Sessions" value={agg.sessions} />
        <Tile label="Prompts" value={agg.userTurns} />
        <Tile label="Tool calls" value={agg.toolCalls} />
      </div>
      <div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <TokenTiles tokens={agg.tokens} fields={{ common: agg.common, specific: [] }} Tile={Tile} />
        </div>
        <div className="text-[11px] text-zinc-600 mt-1.5">
          Summed on the fields every provider reports ({agg.common.join(', ')}).
          {agg.specific.length > 0 && (
            <> Not summed, one provider's own: {agg.specific.map((x) => `${providerLabel(providers, x.scope.provider)} ${x.field} ${fmtTokens(x.value)} (${x.scope.rootLabel})`).join(' · ')}.</>
          )}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Tools used</h3>
          <Bars counts={agg.toolCounts} />
        </div>
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Models</h3>
          <Bars counts={agg.modelCounts} color="bg-sky-500/40" />
        </div>
      </div>
      <div>
        <h3 className="text-[12px] uppercase tracking-wide text-zinc-500 mb-2">Folders (click for that folder's stats)</h3>
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-ink-900/60 text-zinc-500">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">folder</th>
                <th className="text-right px-3 py-1.5 font-medium">projects</th>
                <th className="text-right px-3 py-1.5 font-medium">sessions</th>
                <th className="text-right px-3 py-1.5 font-medium">prompts</th>
                <th className="text-right px-3 py-1.5 font-medium">tools</th>
                <th className="text-right px-3 py-1.5 font-medium">tokens</th>
                <th className="text-right px-3 py-1.5 font-medium">last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ scope: s, stats: d, error }) => {
                const c = providerColor(providers, s.provider)
                return (
                  <tr key={`${s.provider}|${s.root}`} className="border-t border-zinc-800 hover:bg-ink-700/40 cursor-pointer" onClick={() => onPick?.({ provider: s.provider, root: s.root })}>
                    <td className="px-3 py-1.5 text-zinc-300">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span>{s.rootLabel}</span>
                        <span className="text-zinc-600">· {providerLabel(providers, s.provider)}</span>
                        {error && <span className="text-red-300" title={error}>· failed</span>}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{d ? d.projectCount ?? (d.projects || []).length : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{d ? d.sessions : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{d ? d.userTurns : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{d ? d.toolCalls : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{d ? fmtTokens(total(d)) : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-600">{d && lastOf(d) ? fmtRelative(lastOf(d)) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
