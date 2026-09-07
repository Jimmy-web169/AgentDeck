import { useEffect, useRef, useState } from 'react'
import { providerColor, providerLabel } from '../../lib/providerColors.js'
import { ChevronRightIcon } from './shellIcons.jsx'

// One dropdown for "which provider, which tracked folder" — replaces the pair
// of native <select>s. `scopes` comes from useNavIndex (every provider × root);
// `value` = { provider, root }. Large hit area, keyboard-navigable, grouped by
// provider with the provider's color dot.
export default function ScopeMenu({ scopes = [], value, onChange, providers = [], onManage, className = '', align = 'left', compact = false }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const btnRef = useRef(null)
  const listRef = useRef(null)

  const cur = scopes.find((s) => s.provider === value?.provider && s.root === value?.root) || null
  const label = cur ? providerLabel(providers, cur.provider) : value?.provider ? providerLabel(providers, value.provider) : 'Choose a folder'
  const sub = cur?.rootLabel || ''
  const color = providerColor(providers, cur?.provider || value?.provider)

  useEffect(() => {
    if (!open) return
    setHi(Math.max(0, scopes.findIndex((s) => s.provider === value?.provider && s.root === value?.root)))
    const off = (e) => {
      if (btnRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        btnRef.current?.focus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHi((h) => Math.min(scopes.length - 1, h + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHi((h) => Math.max(0, h - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const s = scopes[hi]
        if (s) {
          onChange?.({ provider: s.provider, root: s.root })
          setOpen(false)
        }
      }
    }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopes, hi])

  // group rows by provider (keeps provider order from `scopes`)
  const groups = []
  for (const s of scopes) {
    let g = groups.find((x) => x.provider === s.provider)
    if (!g) groups.push((g = { provider: s.provider, label: s.providerLabel || providerLabel(providers, s.provider), rows: [] }))
    g.rows.push(s)
  }
  let idx = -1

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title="Provider · tracked folder"
        className={`w-full flex items-center gap-2 rounded-md border border-zinc-700 bg-ink-700 hover:bg-ink-600 hover:border-zinc-600 text-left ${
          compact ? 'h-8 px-2.5' : 'h-9 px-3'
        } ${open ? 'border-zinc-600 bg-ink-600' : ''}`}
      >
        <span className={`shrink-0 w-2 h-2 rounded-full ${color.dot}`} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-200">
          {label}
          {sub && <span className="text-zinc-500"> · {sub}</span>}
        </span>
        <ChevronRightIcon className="w-3.5 h-3.5 text-zinc-500 rotate-90 shrink-0" />
      </button>
      {open && (
        <div
          ref={listRef}
          className={`absolute z-40 mt-1 min-w-full w-max max-w-[360px] rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {groups.map((g) => (
            <div key={g.provider} className="py-1">
              <div className="px-3 pb-1 text-[10.5px] uppercase tracking-wider text-zinc-600 flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${providerColor(providers, g.provider).dot}`} />
                {g.label}
              </div>
              {g.rows.map((s) => {
                const i = ++idx
                const selected = s.provider === value?.provider && s.root === value?.root
                return (
                  <button
                    key={`${s.provider}|${s.root}`}
                    onMouseMove={() => setHi(i)}
                    onClick={() => {
                      onChange?.({ provider: s.provider, root: s.root })
                      setOpen(false)
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${hi === i ? 'bg-ink-600 text-zinc-100' : 'text-zinc-300'} ${
                      s.exists === false ? 'opacity-50' : ''
                    }`}
                  >
                    <span className={`w-3 text-center shrink-0 ${selected ? 'text-emerald-300' : 'text-transparent'}`}>✓</span>
                    <span className="truncate">{s.rootLabel}</span>
                    {s.exists === false && <span className="ml-auto text-[10px] text-red-300">missing</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {!scopes.length && <div className="px-3 py-2 text-[12px] text-zinc-600">No tracked folders yet.</div>}
          {onManage && (
            <button
              onClick={() => {
                setOpen(false)
                onManage()
              }}
              className="w-full mt-1 px-3 py-1.5 text-left text-[12px] text-sky-300 hover:bg-ink-600 border-t border-zinc-800"
            >
              Manage folders…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
