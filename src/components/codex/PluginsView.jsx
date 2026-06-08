import { useEffect, useState } from 'react'
import { api } from '../../api.js'

// Installed Codex plugins (from plugins/cache/**/.codex-plugin/plugin.json),
// with enabled-state from config.toml. Read-only.
export default function PluginsView({ root }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!root) return
    setData(null)
    setError(null)
    api.plugins(root).then(setData).catch((e) => setError(e.message))
  }, [root])

  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading plugins…</div>
  const installed = data.installed || []
  const marketplaces = data.marketplaces || []

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h2 className="text-[15px] font-semibold text-zinc-100 mb-1">Plugins</h2>
      <p className="text-[12px] text-zinc-500 mb-4">Installed Codex plugins and the skills they bundle. Enabled-state from <span className="font-mono">config.toml</span>.</p>
      {marketplaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-zinc-500">marketplaces:</span>
          {marketplaces.map((mk) => (
            <span key={mk} className="text-[11px] font-mono px-2 py-0.5 rounded bg-ink-700 border border-zinc-700 text-zinc-300">{mk}</span>
          ))}
        </div>
      )}
      {installed.length === 0 ? (
        <div className="text-center text-zinc-600 py-10">No plugins installed.</div>
      ) : (
        installed.map((p) => (
          <div key={`${p.marketplace}/${p.source}/${p.name}`} className="mb-3 rounded-lg border border-zinc-800 bg-ink-900/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-zinc-100 font-medium truncate">{p.displayName || p.name}</span>
              {p.version && <span className="text-[11px] text-zinc-600 font-mono shrink-0">v{p.version}</span>}
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${p.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}>{p.enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div className="text-[10.5px] text-zinc-600 font-mono truncate">
              {p.marketplace}/{p.source}{p.license ? ` · ${p.license}` : ''}
            </div>
            {p.description && <div className="text-[12px] text-zinc-400 mt-1">{p.description}</div>}
            {p.skills?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.skills.map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 font-mono">{s}</span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
