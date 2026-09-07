import { useEffect, useRef, useState } from 'react'
import { DENSITIES, THEMES, setPref, usePrefs } from '../../lib/prefs.js'
import { GearIcon } from './shellIcons.jsx'

// The gear in the tab strip: a small popover with the things a person is likely
// to want their own way — theme, row density, which sidebar sections show, and
// whether session lists carry the first prompt under each title.
function Group({ title, children }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1.5">{title}</div>
      {children}
    </div>
  )
}

function Pills({ options, value, onPick }) {
  return (
    <div className="flex rounded-md bg-ink-800 border border-zinc-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.k}
          onClick={() => onPick(o.k)}
          title={o.hint || o.label}
          className={`flex-1 h-7 px-2 rounded text-[12px] transition-colors ${value === o.k ? 'bg-ink-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, hint, value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-center gap-3 py-1 text-left group">
      <span className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${value ? 'bg-sky-500/70' : 'bg-zinc-700'}`}>
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${value ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] text-zinc-200">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
      </span>
    </button>
  )
}

export default function Preferences({ className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const btn = useRef(null)
  const prefs = usePrefs()

  useEffect(() => {
    if (!open) return
    const off = (e) => !ref.current?.contains(e.target) && !btn.current?.contains(e.target) && setOpen(false)
    const key = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className={`relative ${className}`}>
      <button ref={btn} onClick={() => setOpen((o) => !o)} title="Preferences" className={`w-7 h-7 rounded-md flex items-center justify-center hover:bg-ink-700 ${open ? 'text-zinc-100 bg-ink-700' : 'text-zinc-500 hover:text-zinc-100'}`}>
        <GearIcon />
      </button>
      {open && (
        <div ref={ref} className="absolute right-0 top-full z-50 mt-1 w-[300px] rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl p-3.5">
          <Group title="Theme">
            <Pills options={THEMES} value={prefs.theme} onPick={(v) => setPref('theme', v)} />
          </Group>
          <Group title="Density">
            <Pills options={DENSITIES} value={prefs.density} onPick={(v) => setPref('density', v)} />
          </Group>
          <Group title="Sidebar">
            <Toggle label="Workspaces section" value={prefs.showWorkspaces} onChange={(v) => setPref('showWorkspaces', v)} />
            <Toggle label="Pinned section" value={prefs.showPinned} onChange={(v) => setPref('showPinned', v)} />
          </Group>
          <Group title="Lists">
            <Toggle label="First prompt under session titles" hint="Activity and Ctrl+K" value={prefs.showFirstPrompt} onChange={(v) => setPref('showFirstPrompt', v)} />
          </Group>
        </div>
      )}
    </div>
  )
}
