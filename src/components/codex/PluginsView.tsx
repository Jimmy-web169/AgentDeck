import { useProviderApi, useProviderLabel, usePlugins } from '../../api/index.ts'
import ReadOnlyNote from '../shared/ReadOnlyNote.tsx'

// Installed Codex plugins (from plugins/cache/**/.codex-plugin/plugin.json),
// with enabled-state from config.toml. Read-only.
export default function PluginsView({ root }: { root: string }) {
  const api = useProviderApi()
  const label = useProviderLabel()
  const { data, error: failure } = usePlugins(api.provider, root)
  const error = failure?.message

  if (error) return <div className="p-8 text-red-300 text-sm">{error}</div>
  if (!data) return <div className="p-8 text-zinc-600 text-sm">Loading plugins…</div>
  const installed = data.installed || []
  const marketplaces = data.marketplaces || []

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h2 className="text-[15px] font-semibold text-zinc-100 mb-1 flex items-center gap-2">
        Plugins
        <ReadOnlyNote why={`${label} installs, enables and removes plugins with its own commands; AgentDeck lists what is on disk.`} />
      </h2>
      <p className="text-[12px] text-zinc-500 mb-4">
        {label === 'Codex' ? (
          <>
            Installed Codex plugins and the skills they bundle. Enabled-state from <span className="font-mono">config.toml</span>.
          </>
        ) : (
          <>
            Installed plugins under <span className="font-mono">~/.gemini/config/plugins</span> and what they bundle.{' '}
            <a href="https://antigravity.google/docs/plugins" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
              docs ↗
            </a>
          </>
        )}
      </p>
      {marketplaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-zinc-500">marketplaces:</span>
          {marketplaces.map((mk) => (
            <span
              key={mk.name}
              title={mk.repo || undefined}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-ink-700 border border-zinc-700 text-zinc-300"
            >
              {mk.name}
            </span>
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
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${p.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-400'}`}
              >
                {p.enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
            <div className="text-[10.5px] text-zinc-600 font-mono truncate">
              {p.marketplace}/{p.source}
              {p.license ? ` · ${p.license}` : ''}
            </div>
            {p.description && <div className="text-[12px] text-zinc-400 mt-1">{p.description}</div>}
            {!!p.skills?.length && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(p.skills || []).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-ink-700 text-zinc-400 font-mono">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
