import { useState } from 'react'
import { WORKSPACE_ICON_KEYS } from '../../lib/workspaces.ts'

// The glyph a workspace shows in the sidebar. A dozen to pick from (the ⋯
// menu → Icon); the workspace's colour tints this glyph and nothing else, so
// the name stays as readable as every other row. Same stroke style as
// shellIcons.jsx.
const base: React.SVGProps<SVGSVGElement> = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const svg = (className: string | undefined, children: React.ReactNode) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={className} {...base}>
    {children}
  </svg>
)

const GLYPHS: Record<string, (className?: string) => React.ReactNode> = {
  layers: (c) =>
    svg(
      c,
      <>
        <path d="m12 4 8 4-8 4-8-4 8-4z" />
        <path d="m4 12 8 4 8-4" />
        <path d="m4 16 8 4 8-4" />
      </>
    ),
  folder: (c) => svg(c, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  star: (c) => svg(c, <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />),
  bolt: (c) => svg(c, <path d="M13 3 5 14h6l-1 7 8-11h-6z" />),
  rocket: (c) =>
    svg(
      c,
      <>
        <path d="M12 3c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10z" />
        <path d="m9 13-3 2v3l3-1" />
        <path d="m15 13 3 2v3l-3-1" />
        <circle cx="12" cy="9.5" r="1.3" />
      </>
    ),
  flask: (c) =>
    svg(
      c,
      <>
        <path d="M9 3h6" />
        <path d="M10 3v6l-5 9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1l-5-9V3" />
        <path d="M7.5 15h9" />
      </>
    ),
  book: (c) =>
    svg(
      c,
      <>
        <path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" />
        <path d="M4 19a2 2 0 0 1 2-2h14" />
      </>
    ),
  briefcase: (c) =>
    svg(
      c,
      <>
        <rect x="4" y="8" width="16" height="11" rx="1.5" />
        <path d="M9 8V5h6v3" />
        <path d="M4 13h16" />
      </>
    ),
  globe: (c) =>
    svg(
      c,
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c3 3 3 15 0 18" />
        <path d="M12 3c-3 3-3 15 0 18" />
      </>
    ),
  code: (c) =>
    svg(
      c,
      <>
        <path d="m8 8-4 4 4 4" />
        <path d="m16 8 4 4-4 4" />
        <path d="m14 5-4 14" />
      </>
    ),
  heart: (c) => svg(c, <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />),
  tag: (c) =>
    svg(
      c,
      <>
        <path d="M3 11V4h7l10 10-7 7z" />
        <circle cx="7.5" cy="8.5" r="1.2" />
      </>
    ),
}

export const WORKSPACE_ICONS = WORKSPACE_ICON_KEYS.map((k) => ({ k, label: k[0].toUpperCase() + k.slice(1) }))

export function WorkspaceIcon({ icon, className = 'w-3.5 h-3.5' }: { icon?: string | null; className?: string }) {
  return (GLYPHS[icon || 'layers'] || GLYPHS.layers)(className)
}

// One quiet row (current glyph, "Icon", "change") that unfolds a grid of the
// choices — the same shape as the colour row next to it.
export function IconField({
  value,
  onPick,
  accentStyle = undefined,
}: {
  value?: string | null
  onPick: (icon: string) => void
  accentStyle?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const current = WORKSPACE_ICON_KEYS.includes(value || '') ? value : 'layers'
  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-icon-chip
        className="w-full flex items-center gap-2 py-1 text-left group/chip"
        title={open ? 'Close' : 'Change icon'}
      >
        <span className="w-4 h-4 shrink-0 inline-flex items-center justify-center" style={accentStyle || undefined}>
          <WorkspaceIcon icon={current} className={`w-3.5 h-3.5 ${accentStyle ? 'accent-text' : 'text-sky-300/80'}`} />
        </span>
        <span className="text-[12.5px] text-zinc-200">Icon</span>
        <span className="text-[11px] text-zinc-500">{current}</span>
        <span className="ml-auto text-[11px] text-zinc-500 group-hover/chip:text-zinc-200">{open ? 'done' : 'change'}</span>
      </button>
      {open && (
        <div className="ml-6 mb-1 rounded-md border border-zinc-800 bg-ink-900/60 p-1.5 flex flex-wrap gap-1">
          {WORKSPACE_ICONS.map((it) => (
            <button
              type="button"
              key={it.k}
              data-icon-choice={it.k}
              onClick={() => onPick(it.k)}
              title={it.label}
              className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${it.k === current ? 'bg-ink-600 text-zinc-100 ring-1 ring-zinc-500' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-700'}`}
            >
              <WorkspaceIcon icon={it.k} className="w-4 h-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
