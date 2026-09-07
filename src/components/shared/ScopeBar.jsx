import { providerColor } from '../../lib/providerColors.js'
import { PlusIcon } from './shellIcons.jsx'

// "Which provider, which tracked folder" as two rows of buttons instead of a
// dropdown: a segmented provider switch, then one chip per folder of that
// provider. Everything is visible, has a hover state, and needs one click.
export default function ScopeBar({ scopes = [], providers = [], value, onChange, onManage }) {
  const rootsOf = (pid) => scopes.filter((s) => s.provider === pid)
  return (
    <div className="space-y-1.5">
      <div className="flex rounded-md bg-ink-800 border border-zinc-800 p-0.5">
        {providers.map((p) => {
          const roots = rootsOf(p.id)
          const active = value?.provider === p.id
          const c = providerColor(providers, p.id)
          const target = active ? value : roots[0] ? { provider: p.id, root: roots[0].root } : null
          return (
            <button
              key={p.id}
              onClick={() => target && onChange?.(target)}
              disabled={!target}
              title={roots.length ? `${p.label} · ${roots.length} tracked folder${roots.length === 1 ? '' : 's'}` : `${p.label} · no tracked folder`}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 h-7 rounded text-[12px] transition-colors ${
                active ? 'bg-ink-600 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-200 hover:bg-ink-700'
              } disabled:opacity-40 disabled:hover:bg-transparent`}
            >
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${c.dot}`} />
              <span className="truncate">{p.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {rootsOf(value?.provider).map((s) => {
          const active = s.root === value?.root
          return (
            <button
              key={s.root}
              onClick={() => onChange?.({ provider: s.provider, root: s.root })}
              title={s.exists === false ? `${s.rootLabel} (missing on disk)` : s.rootLabel}
              className={`max-w-full truncate px-2 h-6 rounded-md text-[11.5px] border transition-colors ${
                active ? 'bg-ink-600 border-zinc-600 text-zinc-100' : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-ink-700'
              } ${s.exists === false ? 'line-through' : ''}`}
            >
              {s.rootLabel}
            </button>
          )
        })}
        {onManage && (
          <button onClick={onManage} title="Manage tracked folders" className="h-6 w-6 rounded-md border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 hover:bg-ink-700 flex items-center justify-center transition-colors">
            <PlusIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
