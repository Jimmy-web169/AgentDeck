import { useEffect, useRef, useState } from 'react'
import { DENSITIES, HOME_SESSIONS, PATH_DEPTHS, THEMES, setPref, usePrefs } from '../../lib/prefs.js'
import InfoDot from './InfoDot.jsx'
import { MOD_WORD } from './ShortcutHints.jsx'
import { providerColorValue, providerDefaultColor, STATUS_KINDS, STATUS_DEFAULTS, statusColorValue } from '../../lib/providerColors.js'
import AccentField from './AccentPicker.jsx'
import { GearIcon } from './shellIcons.jsx'

// The gear in the tab strip: a small popover with the things a person is likely
// to want their own way — theme, row density, which sidebar sections show, and
// whether session lists carry the first prompt under each title.
// `info`: the one sentence a section needs, behind an (i) — the panel itself
// stays labels and controls
function Group({ title, info, children }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1.5">
        {title}
        {info && <InfoDot text={info} align="left" />}
      </div>
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

// `hint` is the one-line explanation — shown on hover, not printed under the label
function Toggle({ label, hint, value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} title={hint || undefined} className="w-full flex items-center gap-3 py-1 text-left group">
      <span className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${value ? 'bg-sky-500/70' : 'bg-zinc-700'}`}>
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${value ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
      </span>
      <span className="min-w-0 text-[12.5px] text-zinc-200">{label}</span>
    </button>
  )
}

// The two status dots (running terminal / being written) as accent rows.
function StatusColors({ prefs }) {
  const [openK, setOpenK] = useState(null)
  return STATUS_KINDS.map(({ k, label, hint }) => {
    const value = statusColorValue(k)
    const def = STATUS_DEFAULTS[k]
    const overridden = !!prefs.statusColors?.[k] && value !== def
    return (
      <AccentField
        key={k}
        label={label}
        hint={hint}
        value={value}
        defaultValue={def}
        open={openK === k}
        onToggle={(o) => setOpenK(o ? k : null)}
        onChange={(hex) => setPref('statusColors', { ...(prefs.statusColors || {}), [k]: hex })}
        onReset={
          overridden
            ? () => {
                const next = { ...(prefs.statusColors || {}) }
                delete next[k]
                setPref('statusColors', next)
              }
            : null
        }
      />
    )
  })
}

// One quiet row per provider (chip + hex + "change"); the picker unfolds under
// the row you click, one at a time. "default" restores the registry colour.
function ProviderColors({ providers, prefs }) {
  const [openId, setOpenId] = useState(null)
  return providers.map((p) => {
    const value = providerColorValue(providers, p.id)
    const def = providerDefaultColor(providers, p.id)
    const overridden = !!prefs.providerColors?.[p.id] && value !== def
    return (
      <AccentField
        key={p.id}
        label={p.label}
        hint={p.vendor || null}
        value={value}
        defaultValue={def}
        open={openId === p.id}
        onToggle={(o) => setOpenId(o ? p.id : null)}
        onChange={(hex) => setPref('providerColors', { ...(prefs.providerColors || {}), [p.id]: hex })}
        onReset={
          overridden
            ? () => {
                const next = { ...(prefs.providerColors || {}) }
                delete next[p.id]
                setPref('providerColors', next)
              }
            : null
        }
      />
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
        <div ref={ref} className="absolute right-0 top-full z-50 mt-1 w-[300px] max-h-[85vh] overflow-y-auto rounded-lg border border-zinc-700 bg-ink-800 shadow-2xl p-3.5">
          <Group title="Theme">
            <Pills options={THEMES} value={prefs.theme} onPick={(v) => setPref('theme', v)} />
          </Group>
          <Group title="Density">
            <Pills options={DENSITIES} value={prefs.density} onPick={(v) => setPref('density', v)} />
          </Group>
          {providers.length > 0 && (
            <Group title="Colours" info="Overrides a provider's accent; the theme keeps the lightness. A workspace's colour is in its ⋯ menu.">
              <ProviderColors providers={providers} prefs={prefs} />
              <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-zinc-600 mt-2 mb-0.5">
                Status
                <InfoDot text="The pulsing dots on sessions and tabs — running terminal, transcript being written." align="left" />
              </div>
              <StatusColors prefs={prefs} />
            </Group>
          )}
          <Group title="Paths" info={`How many folders of a project path to show — sidebar, ${MOD_WORD}+K, Home, Stats. Windows and macOS/Linux paths alike.`}>
            <Pills options={PATH_DEPTHS} value={prefs.pathDepth} onPick={(v) => setPref('pathDepth', v)} />
          </Group>
          <Group title="Home" info="How many rows Activity’s Latest sessions shows before “show all”. Recent projects shows 5.">
            <Pills options={HOME_SESSIONS} value={prefs.homeSessions} onPick={(v) => setPref('homeSessions', v)} />
          </Group>
          <Group title="Sidebar" info="Which sections the sidebar shows. Grouped and pinned rows leave the Projects list; suggestions are the “same folder in several places” box.">
            <Toggle label="Workspaces section" hint="Grouped projects and sessions leave the Projects list" value={prefs.showWorkspaces} onChange={(v) => setPref('showWorkspaces', v)} />
            <Toggle label="Workspace suggestions" hint="“Same folder in several places” under Workspaces" value={prefs.showSuggestions} onChange={(v) => setPref('showSuggestions', v)} />
            <Toggle label="Pinned section" hint="Pinned rows leave the Projects list" value={prefs.showPinned} onChange={(v) => setPref('showPinned', v)} />
          </Group>
          <Group title="Lists" info={`The first prompt under each session title in Activity and ${MOD_WORD}+K.`}>
            <Toggle label="First prompt under session titles" hint={`Activity and ${MOD_WORD}+K`} value={prefs.showFirstPrompt} onChange={(v) => setPref('showFirstPrompt', v)} />
          </Group>
          <Group title="Conversation" info="Sub-agent threads expand under the tool call that spawned them; off = the Sub-agents tab only.">
            <Toggle label="Sub-agent threads inline in the conversation" hint="Expand a sub-agent under the tool call that spawned it" value={prefs.inlineSubagents} onChange={(v) => setPref('inlineSubagents', v)} />
          </Group>
        </div>
      )}
    </div>
  )
}
