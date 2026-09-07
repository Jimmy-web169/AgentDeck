import { providerColor } from '../../lib/providerColors.js'
import { PanelLeftIcon } from './shellIcons.jsx'

// The provider rail: one square per provider, stacked vertically, so five
// providers cost five rows rather than a crowded segmented control. The active
// provider carries a left accent bar; a provider with no tracked folder is
// dimmed. The sidebar toggle lives at the bottom, so the rail is also what you
// see when the sidebar is collapsed.
const initials = (label = '') => {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (label[0] || '?').toUpperCase() + (label[1] || '').toLowerCase()
}

export default function ProviderRail({ providers = [], scopes = [], activeProvider, onPick, collapsed, onToggleSidebar }) {
  return (
    <div className="w-12 h-full shrink-0 flex flex-col items-center py-2 gap-1.5 bg-ink-900 border-r border-zinc-800">
      {providers.map((p) => {
        const n = scopes.filter((s) => s.provider === p.id).length
        const active = activeProvider === p.id
        const c = providerColor(providers, p.id)
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            disabled={!n}
            title={n ? `${p.label} · ${n} tracked folder${n === 1 ? '' : 's'}` : `${p.label} · no tracked folder yet`}
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-[12px] font-semibold tracking-tight transition-colors ${
              active ? `bg-ink-600 ${c.text}` : `text-zinc-500 hover:text-zinc-100 hover:bg-ink-700`
            } disabled:opacity-35 disabled:hover:bg-transparent`}
          >
            {active && <span className="absolute -left-1.5 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: c.bar }} />}
            <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${c.dot}`} />
            {initials(p.label)}
          </button>
        )
      })}
      <div className="flex-1" />
      <button onClick={onToggleSidebar} title={`${collapsed ? 'Show' : 'Hide'} sidebar  (Ctrl+B)`} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${collapsed ? 'text-zinc-300 bg-ink-700' : 'text-zinc-500 hover:text-zinc-100 hover:bg-ink-700'}`}>
        <PanelLeftIcon />
      </button>
    </div>
  )
}
