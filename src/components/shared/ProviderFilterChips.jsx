import { providerColor } from '../../lib/providerColors.js'
import { PlusIcon } from './shellIcons.jsx'
import { homeSourceEnabled, homeSourceKey } from '../../lib/homeScope.js'

// Folder-mode filters are independent of the active tab/source scope. Clicking
// a chip hides/shows that provider's roots; it never untracks them or navigates.
export default function ProviderFilterChips({ providers, scopes, excluded = [], excludedRoots = [], onToggle, onReset, onManage }) {
  const tracked = providers.filter((p) => scopes.some((s) => s.provider === p.id))
  return <div className="space-y-1.5">
    <div role="group" aria-label="Folder providers" className="flex flex-wrap items-center gap-1">
      {tracked.map((p) => {
        const roots = scopes.filter((s) => s.provider === p.id), colors = providerColor(providers, p.id)
        const count = roots.length, active = roots.filter((s) => homeSourceEnabled(s, { excluded, excludedRoots })).length
        const enabled = active > 0
        return <div key={p.id} className="flex flex-wrap items-center gap-1 max-w-full">
          <button aria-pressed={enabled} onClick={() => onToggle(p.id)}
          title={`${enabled ? 'Hide' : 'Show'} all ${p.label} folders (${count} ${count === 1 ? 'root' : 'roots'}). Tracked sources and running sessions are unaffected.`}
          className={`shrink-0 max-w-[200px] flex items-center gap-1.5 px-2 h-6 rounded-md text-[11.5px] border transition-colors ${enabled ? `bg-ink-700 border-zinc-600 ${colors.text}` : 'border-dashed border-zinc-800 text-zinc-600 hover:text-zinc-300'}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${enabled ? colors.dot : 'bg-zinc-700'}`} />
          <span className={`truncate ${enabled ? '' : 'line-through'}`}>{p.label}</span>
          {count > 1 && <span className="text-[10px] text-zinc-500">{active}/{count}</span>}
        </button>
        {count > 1 && <div role="group" aria-label={`${p.label} roots`} className="flex flex-wrap items-center gap-1 pl-1 border-l border-zinc-700">{roots.map((s) => {
          const included = homeSourceEnabled(s, { excluded, excludedRoots })
          return <button key={homeSourceKey(s)} aria-label={`${p.label} / ${s.rootLabel || s.root}`} aria-pressed={included} onClick={() => onToggle(p.id, s.root)}
            title={`${included ? 'Hide' : 'Show'} ${p.label} / ${s.rootLabel || s.root} (${s.root})`}
            className={`max-w-[140px] truncate px-2 h-6 rounded-md text-[11px] border transition-colors ${included ? `bg-ink-800 border-zinc-700 ${colors.text}` : 'border-dashed border-zinc-800 text-zinc-600 line-through hover:text-zinc-300'}`}>{s.rootLabel || s.root}</button>
        })}</div>}
        </div>
      })}
      <button onClick={onManage} title="Add or manage sources" aria-label="Add or manage sources" className="shrink-0 h-6 w-6 rounded-md border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-200 flex items-center justify-center"><PlusIcon className="w-3 h-3" /></button>
    </div>
    <div className="flex items-center justify-between gap-2 text-[10.5px] text-zinc-600"><span>Filter by provider and root</span>{scopes.some((s) => !homeSourceEnabled(s, { excluded, excludedRoots })) && <button onClick={onReset} className="shrink-0 text-zinc-400 hover:text-zinc-200">Show all</button>}</div>
  </div>
}
