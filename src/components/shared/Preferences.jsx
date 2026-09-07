import { useEffect, useRef, useState } from 'react'
import { DENSITIES, THEMES, setPref, usePrefs } from '../../lib/prefs.js'
import { ACCENTS, accentClasses, providerColorName } from '../../lib/providerColors.js'
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

// One row per provider: its shell accent (tab dot, folder chip, source tag).
// The registry default stays selectable; picking it again clears the override.
function ProviderColors({ providers, prefs }) {
  return providers.map((p) => {
    const current = providerColorName(providers, p.id)
    return (
      <div key={p.id} className="py-1">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${accentClasses(current).dot}`} />
          <span className="text-[12.5px] text-zinc-200 truncate">{p.label}</span>
          <span className="text-[11px] text-zinc-500">{ACCENTS.find((a) => a.k === current)?.label}</span>
        </div>
        <span className="flex flex-wrap items-center gap-1.5 pl-4">
          {ACCENTS.map((a) => {
            const on = current === a.k
            return (
              <button
                key={a.k}
                onClick={() => {
                  const next = { ...(prefs.providerColors || {}) }
                  if (a.k === p.color) delete next[p.id]
                  else next[p.id] = a.k
                  setPref('providerColors', next)
                }}
                title={a.k === p.color ? `${a.label} (default)` : a.label}
                className={`w-4 h-4 rounded-full ${accentClasses(a.k).dot} ${on ? 'ring-2 ring-zinc-100 ring-offset-1 ring-offset-ink-800' : 'opacity-60 hover:opacity-100'}`}
              />
            )
          })}
        </span>
      </div>
    )
  })
}

export default function Preferences({ className = '', providers = [] }) {
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
          {providers.length > 0 && (
            <Group title="Colours">
              <ProviderColors providers={providers} prefs={prefs} />
              <div className="text-[11px] text-zinc-500 mt-1">A workspace's colour is in its ⋯ menu.</div>
            </Group>
          )}
          <Group title="Sidebar">
            <Toggle label="Workspaces section" hint="Grouped projects and sessions leave the Projects list" value={prefs.showWorkspaces} onChange={(v) => setPref('showWorkspaces', v)} />
            <Toggle label="Workspace suggestions" hint="“Same folder in several places” under Workspaces" value={prefs.showSuggestions} onChange={(v) => setPref('showSuggestions', v)} />
            <Toggle label="Pinned section" hint="Pinned rows leave the Projects list" value={prefs.showPinned} onChange={(v) => setPref('showPinned', v)} />
          </Group>
          <Group title="Lists">
            <Toggle label="First prompt under session titles" hint="Activity and Ctrl+K" value={prefs.showFirstPrompt} onChange={(v) => setPref('showFirstPrompt', v)} />
          </Group>
          <Group title="Conversation">
            <Toggle label="Sub-agent threads inline in the conversation" hint="Expand a sub-agent under the tool call that spawned it" value={prefs.inlineSubagents} onChange={(v) => setPref('inlineSubagents', v)} />
          </Group>
        </div>
      )}
    </div>
  )
}
