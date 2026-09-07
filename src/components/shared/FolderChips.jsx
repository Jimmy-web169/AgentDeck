import { PlusIcon } from './shellIcons.jsx'

// The active provider's tracked folders as chips (one click each) plus a "+"
// that opens Folders to track another. Provider selection lives in the rail.
export default function FolderChips({ scopes = [], provider, root, onPick, onManage }) {
  const roots = scopes.filter((s) => s.provider === provider)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {roots.map((s) => {
        const active = s.root === root
        return (
          <button
            key={s.root}
            onClick={() => onPick({ provider: s.provider, root: s.root })}
            title={s.exists === false ? `${s.rootLabel} (missing on disk)` : s.rootLabel}
            className={`max-w-full truncate px-2 h-6 rounded-md text-[11.5px] border transition-colors ${
              active ? 'bg-ink-600 border-zinc-600 text-zinc-100' : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-ink-700'
            } ${s.exists === false ? 'line-through' : ''}`}
          >
            {s.rootLabel}
          </button>
        )
      })}
      {!roots.length && <span className="text-[11.5px] text-zinc-600">no tracked folder</span>}
      <button onClick={onManage} title="Track another folder" className="h-6 w-6 rounded-md border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 hover:bg-ink-700 flex items-center justify-center transition-colors">
        <PlusIcon className="w-3 h-3" />
      </button>
    </div>
  )
}
