import { fmtRelative } from '../../lib/format.js'

// `data.installed` is a normalized list from the server:
//   [{ name, marketplace, version, scope, installedAt, lastUpdated }]
// `data.marketplaces` is [{ name, repo }].
export default function PluginsView({ data }) {
  if (!data) return <div className="p-8 text-zinc-600">Loading plugins…</div>
  const installed = data.installed || []
  const marketplaces = data.marketplaces || []
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Installed plugins ({installed.length})</div>
        <div className="space-y-1.5">
          {installed.map((p) => (
            <div key={`${p.name}@${p.marketplace || ''}`} className="rounded-lg bg-ink-700/40 border border-zinc-800 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] text-zinc-200 font-mono">{p.name}</span>
                {p.version && <span className="text-[11px] text-zinc-500 font-mono">v{p.version}</span>}
                {p.scope && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400">{p.scope}</span>}
              </div>
              {(p.marketplace || p.installedAt) && (
                <div className="text-[11px] text-zinc-600 font-mono mt-0.5">
                  {[p.marketplace && `from ${p.marketplace}`, p.installedAt && `installed ${fmtRelative(p.installedAt)}`].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
          {installed.length === 0 && <div className="text-[12px] text-zinc-600">none installed</div>}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Marketplaces ({marketplaces.length})</div>
        <div className="space-y-1.5">
          {marketplaces.map((m) => (
            <div key={m.name} className="rounded-lg bg-ink-700/40 border border-zinc-800 px-3 py-2 flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] text-zinc-200 font-mono">{m.name}</span>
              {m.repo && <span className="text-[11px] text-zinc-600 font-mono">{m.repo}</span>}
            </div>
          ))}
          {marketplaces.length === 0 && <span className="text-[12px] text-zinc-600">none</span>}
        </div>
      </div>
    </div>
  )
}
