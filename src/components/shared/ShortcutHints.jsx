import { Fragment } from 'react'

// the modifier the shell listens for is Ctrl on Windows/Linux and ⌘ on macOS
// (handlers accept ctrlKey || metaKey); every label in the UI reads this
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
export const MOD = IS_MAC ? '⌘' : 'Ctrl'
export const MOD_WORD = IS_MAC ? 'Cmd' : 'Ctrl'

// One list of the shell's keyboard shortcuts, rendered two ways: a full list
// (the "?" popover in the tab strip) and a compact chip row (empty states,
// the Dashboard). Keep this the single source of truth when a key changes.
export const SHORTCUTS = [
  { keys: [MOD, 'K'], label: 'Search projects & sessions' },
  { keys: ['Alt', 'T'], label: 'New tab' },
  { keys: ['Alt', 'W'], label: 'Close tab' },
  { keys: ['Alt', '['], alt: ['Alt', ']'], label: 'Previous / next tab' },
  { keys: ['Alt', '1…9'], label: 'Jump to tab (9 = last)' },
  { keys: [MOD, 'click'], label: 'Open a session in a new tab (or middle-click)' },
  { keys: [MOD, 'B'], label: 'Show / hide the sidebar' },
  { keys: ['→'], alt: ['←'], label: 'In search: into / out of a project' },
]

const CHIPS = [
  [[MOD, 'K'], 'search'],
  [['Alt', 'T'], 'new tab'],
  [['Alt', 'W'], 'close tab'],
  [['Alt', '['], 'prev tab'],
  [['Alt', ']'], 'next tab'],
  [[MOD, 'click'], 'open in new tab'],
]

export function Kbd({ children }) {
  return <kbd className="inline-block px-1.5 py-0.5 rounded border border-zinc-700 bg-ink-700 text-[10.5px] leading-none text-zinc-400 font-mono">{children}</kbd>
}

export function Keys({ keys }) {
  return (
    <span className="inline-flex items-center">
      {keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-zinc-600 mx-0.5 text-[10px]">+</span>}
          <Kbd>{k}</Kbd>
        </Fragment>
      ))}
    </span>
  )
}

export function ShortcutList() {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px] text-zinc-300">
      {SHORTCUTS.map((s) => (
        <Fragment key={s.label}>
          <div className="flex items-center whitespace-nowrap">
            <Keys keys={s.keys} />
            {s.alt && (
              <>
                <span className="text-zinc-600 mx-1 text-[10px]">/</span>
                <Keys keys={s.alt} />
              </>
            )}
          </div>
          <div className="self-center">{s.label}</div>
        </Fragment>
      ))}
    </div>
  )
}

export function ShortcutChips({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-500 ${className}`}>
      {CHIPS.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1">
          <Keys keys={keys} />
          <span>{label}</span>
        </span>
      ))}
    </div>
  )
}
