import type { NavScope } from '../../../api/useNavIndex.ts'
import type { UIProvider } from '../../../providers/views.ts'
import type { Scope } from '../../../lib/useShellNavigation.ts'
import useEscToClose from '../../../lib/useEscToClose.ts'
import { homeSourceKey } from '../../../../shared/identity.ts'
import { providerLabel } from '../../../lib/providerColors.ts'

export default function NewFolderDialog({
  scope,
  scopes,
  providers,
  onChange,
  onClose,
  onChoose,
}: {
  scope: Scope
  scopes: NavScope[]
  providers: readonly UIProvider[]
  onChange: (scope: Scope) => void
  onClose: () => void
  onChoose: () => void
}) {
  useEscToClose(onClose)
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Close new folder conversation" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New folder conversation"
        className="relative w-96 max-w-full rounded-xl bg-ink-800 border border-zinc-700 p-4 space-y-3"
      >
        <h2 className="text-sm text-zinc-200">New folder conversation</h2>
        <label className="block text-xs text-zinc-400">
          Receiving AI / root
          <select
            aria-label="Receiving AI / root"
            className="block w-full mt-2 bg-ink-900 border border-zinc-700 rounded p-2"
            value={homeSourceKey(scope)}
            onChange={(e) => {
              const [p, r] = JSON.parse(e.target.value)
              const selected = scopes.find((s) => s.provider === p && s.root === r)
              if (selected) onChange(selected)
            }}
          >
            {scopes
              .filter((s: { exists: boolean }) => s.exists !== false)
              .map((s) => (
                <option key={homeSourceKey(s)} value={homeSourceKey(s)}>
                  {providerLabel(providers, s.provider)} · {s.rootLabel}
                </option>
              ))}
          </select>
        </label>
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-sky-300" onClick={onChoose}>
            Choose working folder…
          </button>
          <button type="button" className="text-zinc-400" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
