import type { NavScope } from '../../api/useNavIndex.ts'
import type { UIProvider } from '../../providers/views.ts'
import type { Scope } from '../../lib/useShellNavigation.ts'
import { sourceKey } from '../../../shared/identity.ts'
import { providerColor, providerLabel } from '../../lib/providerColors.ts'
import { PlusIcon } from './shellIcons.tsx'

// Every tracked folder of every provider as one row of chips, colour-coded by
// provider (dot + tint). One click switches the scope — no separate provider
// step. `compact` is the header variant (single scrolling line).
export default function FolderChips({
  scopes = [],
  providers = [],
  value,
  onPick,
  onManage,
  compact = false,
}: {
  scopes?: NavScope[]
  providers?: readonly UIProvider[]
  value?: Scope | null
  onPick?: (scope: Scope) => void
  onManage?: () => void
  compact?: boolean
}) {
  const chip = (s: NavScope) => {
    const active = s.provider === value?.provider && s.root === value?.root
    const c = providerColor(providers, s.provider)
    return (
      <button
        type="button"
        key={sourceKey(s.provider, s.root)}
        onClick={() => onPick?.({ provider: s.provider, root: s.root })}
        title={`${providerLabel(providers, s.provider)} · ${s.rootLabel}${s.exists === false ? ' (missing on disk)' : ''}${s.probe?.status === 'drift' ? `\nFormat drift — ${(s.probe.details || []).map((d) => d.msg).join('; ')}\nDetails and “accept” in Folders (+).` : ''}`}
        className={`shrink-0 max-w-[200px] flex items-center gap-1.5 px-2 h-6 rounded-md text-[11.5px] border transition-colors ${
          active ? `bg-ink-600 border-zinc-500 ${c.text}` : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-ink-700'
        } ${s.exists === false ? 'line-through' : ''}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
        <span className="truncate">{s.rootLabel}</span>
        {s.probe?.status === 'drift' && (
          <span role="img" className="shrink-0 text-[10px] font-semibold text-amber-300" aria-label="format drift">
            !
          </span>
        )}
      </button>
    )
  }
  return (
    <div className={compact ? 'flex items-center gap-1 overflow-x-auto no-scrollbar' : 'flex flex-wrap items-center gap-1'}>
      {scopes.map(chip)}
      {!scopes.length && <span className="text-[11.5px] text-zinc-600">no tracked folder</span>}
      {onManage && (
        <button
          type="button"
          onClick={onManage}
          title="Track another folder / edit labels"
          className="shrink-0 h-6 w-6 rounded-md border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 hover:bg-ink-700 flex items-center justify-center transition-colors"
        >
          <PlusIcon className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
