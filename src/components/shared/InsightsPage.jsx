import { useEffect, useMemo, useState } from 'react'
import { createApi } from '../../api.js'
import { fmtTokens } from '../../lib/format.js'
import { shortPath } from '../../lib/paths.js'

// Home › Insights — a personal picture of recent agent use for one tracked
// folder: a 12-week activity heatmap, the last 30 days as bars (sessions /
// prompts / tool calls / tokens), when in the day and week the work happens,
// the busiest projects and the model mix. Everything is one hue (magnitude →
// light-to-dark emerald) with text in text tokens; single-series charts carry
// no legend, every mark has a hover title, and the daily chart has a table view.
// "Copy digest" puts the same numbers on the clipboard as Markdown — paste it
// into any Claude / Codex session for an AI read of your habits.

const METRICS = [
  { k: 'sessions', label: 'Sessions', fmt: (v) => String(v) },
  { k: 'prompts', label: 'Prompts', fmt: (v) => String(v) },
  { k: 'toolCalls', label: 'Tool calls', fmt: (v) => String(v) },
  { k: 'tokens', label: 'Tokens', fmt: (v) => fmtTokens(v) },
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WINDOW = 30 // days shown in the bars / tiles
const HEAT_WEEKS = 12

// sequential steps of one hue over the chart surface (0 = none)
const heat = (v, max) => {
  if (!v) return 'bg-ink-700'
  const r = v / Math.max(1, max)
  if (r < 0.25) return 'bg-emerald-500/25'
  if (r < 0.5) return 'bg-emerald-500/45'
  if (r < 0.75) return 'bg-emerald-500/70'
  return 'bg-emerald-500/95'
}
const shortDate = (iso) => {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-ink-700/60 border border-zinc-800 px-4 py-3 min-w-0">
      <div className="text-[22px] font-semibold text-zinc-100 truncate">{value}</div>
      <div className="text-[11.5px] text-zinc-500 mt-0.5 truncate">{label}</div>
      {sub && <div className="text-[11px] text-zinc-600 truncate">{sub}</div>}
    </div>
  )
}

function Card({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-zinc-800 bg-ink-900 p-4 min-w-0 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[12px] uppercase tracking-wide text-zinc-500">{title}</h3>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  )
}

// a thin single-series bar chart: values → bars anchored to the baseline,
// 4px rounded tops, 2px gaps, hover title per bar, no legend (the card names it)
function Bars({ values, labels, titles, height = 96, every = 1, className = '' }) {
  const max = Math.max(1, ...values)
  return (
    <div className={className}>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="flex-1 min-w-0 h-full flex items-end" title={titles[i]}>
            <div className={`w-full rounded-t-[4px] ${v ? 'bg-emerald-500/70 hover:bg-emerald-500' : 'bg-ink-700'} transition-colors`} style={{ height: v ? `${Math.max(3, (v / max) * 100)}%` : 2 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 min-w-0 text-[10px] text-zinc-600 truncate text-center">{i % every === 0 ? l : ''}</div>
        ))}
      </div>
    </div>
  )
}

export default function InsightsPage({ provider, root, rootLabel = '', providerLabel = '' }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [metric, setMetric] = useState('sessions')
  const [table, setTable] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!provider || !root) return
    let cancelled = false
    setData(null)
    setErr(null)
    createApi(provider)
      .activity(root, HEAT_WEEKS * 7)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(e.message))
    return () => {
      cancelled = true
    }
  }, [provider, root])

  const last30 = useMemo(() => (data ? data.daily.slice(-WINDOW) : []), [data])
  const totals30 = useMemo(
    () => last30.reduce((a, d) => ({ sessions: a.sessions + d.sessions, prompts: a.prompts + d.prompts, toolCalls: a.toolCalls + d.toolCalls, tokens: a.tokens + d.tokens, active: a.active + (d.sessions ? 1 : 0) }), { sessions: 0, prompts: 0, toolCalls: 0, tokens: 0, active: 0 }),
    [last30]
  )
  const m = METRICS.find((x) => x.k === metric)

  const digest = () => {
    if (!data) return ''
    const lines = [
      `# AgentDeck insights — ${providerLabel} · ${rootLabel} (last ${WINDOW} days, to ${data.range.to})`,
      '',
      `- Sessions: ${totals30.sessions} on ${totals30.active} active days · streak ${data.streak.current} (longest ${data.streak.longest})`,
      `- Prompts: ${totals30.prompts} · tool calls: ${totals30.toolCalls} · tokens: ${fmtTokens(totals30.tokens)}`,
      data.busiest.hour != null ? `- Busiest hour: ${String(data.busiest.hour).padStart(2, '0')}:00 · busiest weekday: ${WEEKDAYS[data.busiest.weekday]}` : '- No activity in range',
      `- Top projects: ${data.topProjects.map((p) => `${shortPath(p.cwd || p.slug)} (${p.sessions})`).join(', ') || '—'}`,
      `- Models: ${Object.entries(data.models).map(([k, v]) => `${k} (${v})`).join(', ') || '—'}`,
      '',
      '## Daily',
      '| date | sessions | prompts | tool calls | tokens |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...last30.map((d) => `| ${d.date} | ${d.sessions} | ${d.prompts} | ${d.toolCalls} | ${d.tokens} |`),
      '',
      '_A session counts on the day of its last activity; tokens are attributed to that day._',
    ]
    return lines.join('\n')
  }
  const copy = () => {
    navigator.clipboard
      ?.writeText(digest())
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  if (err) return <div className="m-6 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-3">{err}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Reading sessions…</div>

  // heatmap: HEAT_WEEKS columns × 7 rows, oldest week left; pad the first week so rows are weekdays
  const heatMax = Math.max(1, ...data.daily.map((d) => d.sessions))
  const firstDow = new Date(data.daily[0].date + 'T00:00:00').getDay()
  const cells = [...Array(firstDow).fill(null), ...data.daily]
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label={`sessions · ${WINDOW}d`} value={totals30.sessions} sub={`${totals30.active} active day${totals30.active === 1 ? '' : 's'}`} />
        <Tile label="prompts" value={totals30.prompts} />
        <Tile label="tool calls" value={totals30.toolCalls} />
        <Tile label="tokens" value={fmtTokens(totals30.tokens)} />
        <Tile label="streak" value={`${data.streak.current}d`} sub={`longest ${data.streak.longest}d`} />
        <Tile label="busiest" value={data.busiest.hour != null ? `${String(data.busiest.hour).padStart(2, '0')}:00` : '—'} sub={data.busiest.weekday != null ? `${WEEKDAYS[data.busiest.weekday]}s` : ''} />
      </div>

      <Card title={`Activity · last ${HEAT_WEEKS} weeks`} right={<span className="text-[11px] text-zinc-600">sessions per day · darker = more</span>}>
        <div className="flex gap-2">
          <div className="grid grid-rows-7 gap-[3px] text-[10px] text-zinc-600 pr-1 shrink-0" style={{ height: 7 * 15 - 3 }}>
            {WEEKDAYS.map((d, i) => <div key={d} className="h-3 leading-3">{i % 2 === 1 ? d : ''}</div>)}
          </div>
          <div className="flex gap-[3px] overflow-x-auto no-scrollbar">
            {weeks.map((w, wi) => (
              <div key={wi} className="grid grid-rows-7 gap-[3px]">
                {Array.from({ length: 7 }, (_, di) => {
                  const d = w[di]
                  return d ? (
                    <div key={di} className={`w-3 h-3 rounded-[3px] ${heat(d.sessions, heatMax)}`} title={`${d.date} · ${d.sessions} session${d.sessions === 1 ? '' : 's'} · ${d.prompts} prompts · ${fmtTokens(d.tokens)} tokens`} />
                  ) : (
                    <div key={di} className="w-3 h-3" />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card
        title={`Last ${WINDOW} days · ${m.label}`}
        right={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md bg-ink-800 border border-zinc-800 p-0.5">
              {METRICS.map((x) => (
                <button key={x.k} onClick={() => setMetric(x.k)} className={`h-6 px-2 rounded text-[11.5px] ${metric === x.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'}`}>
                  {x.label}
                </button>
              ))}
            </div>
            <button onClick={() => setTable((t) => !t)} className="h-6 px-2 rounded-md border border-zinc-800 text-[11.5px] text-zinc-400 hover:text-zinc-100 hover:bg-ink-700">
              {table ? 'Chart' : 'Table'}
            </button>
          </div>
        }
      >
        {table ? (
          <div className="max-h-72 overflow-y-auto rounded border border-zinc-800">
            <table className="w-full text-[12px]">
              <thead className="bg-ink-800 text-zinc-500 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">date</th>
                  <th className="text-right px-3 py-1.5 font-medium">sessions</th>
                  <th className="text-right px-3 py-1.5 font-medium">prompts</th>
                  <th className="text-right px-3 py-1.5 font-medium">tool calls</th>
                  <th className="text-right px-3 py-1.5 font-medium">tokens</th>
                </tr>
              </thead>
              <tbody>
                {[...last30].reverse().map((d) => (
                  <tr key={d.date} className="border-t border-zinc-800/70">
                    <td className="px-3 py-1 font-mono text-zinc-300">{d.date}</td>
                    <td className="px-3 py-1 text-right text-zinc-300">{d.sessions}</td>
                    <td className="px-3 py-1 text-right text-zinc-400">{d.prompts}</td>
                    <td className="px-3 py-1 text-right text-zinc-400">{d.toolCalls}</td>
                    <td className="px-3 py-1 text-right text-zinc-400">{fmtTokens(d.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Bars values={last30.map((d) => d[metric])} labels={last30.map((d) => shortDate(d.date))} titles={last30.map((d) => `${d.date} · ${m.fmt(d[metric])} ${m.label.toLowerCase()}`)} every={5} height={120} />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Hour of day" right={<span className="text-[11px] text-zinc-600">sessions by last activity · local time</span>}>
          <Bars values={data.hours} labels={data.hours.map((_, h) => `${h}`)} titles={data.hours.map((v, h) => `${String(h).padStart(2, '0')}:00 · ${v} session${v === 1 ? '' : 's'}`)} every={3} height={80} />
        </Card>
        <Card title="Day of week">
          <Bars values={data.weekdays} labels={WEEKDAYS} titles={data.weekdays.map((v, i) => `${WEEKDAYS[i]} · ${v} session${v === 1 ? '' : 's'}`)} height={80} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={`Busiest projects · ${HEAT_WEEKS} weeks`}>
          {data.topProjects.length === 0 ? (
            <div className="text-[12px] text-zinc-600">nothing in range</div>
          ) : (
            <div className="space-y-1.5">
              {data.topProjects.map((p) => {
                const max = data.topProjects[0].sessions || 1
                return (
                  <div key={`${p.slug}|${p.cwd}`} className="flex items-center gap-2" title={p.cwd || p.slug}>
                    <span className="w-40 shrink-0 text-[12.5px] text-zinc-300 truncate">{shortPath(p.cwd || p.slug)}</span>
                    <div className="flex-1 bg-ink-900 rounded h-3 overflow-hidden border border-zinc-800/60">
                      <div className="h-full bg-emerald-500/70 rounded-r-[4px]" style={{ width: `${(p.sessions / max) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-[11.5px] text-zinc-400 shrink-0">{p.sessions} sess · {fmtTokens(p.tokens)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        <Card title="Models">
          {Object.keys(data.models).length === 0 ? (
            <div className="text-[12px] text-zinc-600">none</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.models)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <span key={k} className="text-[11px] font-mono px-2 py-1 rounded bg-ink-700 text-zinc-200 border border-zinc-800" title={`${v} session${v === 1 ? '' : 's'}`}>
                    {k} <span className="text-zinc-500">· {v}</span>
                  </span>
                ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11.5px] text-zinc-500">
        <button onClick={copy} className="px-3 py-1.5 rounded-md bg-ink-700 border border-zinc-700 text-[12px] text-zinc-200 hover:bg-ink-600">
          {copied ? '✓ copied' : 'Copy digest as Markdown'}
        </button>
        <span>Paste it into any Claude or Codex session and ask for a read of your habits — an in-app "ask Claude" button is the natural next step.</span>
        <span className="ml-auto text-zinc-600">A session counts on the day of its last activity; its tokens land on that day.</span>
      </div>
    </div>
  )
}
