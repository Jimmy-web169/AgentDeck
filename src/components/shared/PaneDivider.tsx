import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { DEFAULT_PANE_SHARES, PANE_SHARE } from '../../lib/prefs.ts'

// Which side of the divider the pane is on: below the transcript in a narrow
// window, beside it from 1280px (the stylesheet's breakpoint). The share itself
// is the `subagentPane` preference; this file only reads its bounds.
export type PaneLayout = 'stacked' | 'beside'
const STEP = 0.02
const BESIDE = '(min-width: 1280px)'
const clamp = (value: number) => Math.min(PANE_SHARE.max, Math.max(PANE_SHARE.min, value))

// Which arrangement the stylesheet is using right now. jsdom has no matchMedia
// and therefore stacks, which is also the arrangement below the breakpoint.
export function usePaneLayout(): PaneLayout {
  const current = () => (typeof window.matchMedia === 'function' && window.matchMedia(BESIDE).matches ? 'beside' : 'stacked')
  const [layout, setLayout] = useState<PaneLayout>(current)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(BESIDE)
    const update = () => setLayout(media.matches ? 'beside' : 'stacked')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return layout
}

// The line between the transcript and the sub-agent pane doubles as its grip:
// dragging or the arrow keys resize the pane's share of the row, double-click
// restores the default. `size` is the pane's fraction of `containerRef`;
// `onSize` follows every move, `onCommit` fires once a gesture has settled so
// the owner persists one value per drag rather than one per pointer event.
export default function PaneDivider({
  containerRef,
  layout,
  size,
  onSize,
  onCommit,
}: {
  containerRef: RefObject<HTMLElement>
  layout: PaneLayout
  size: number
  onSize: (size: number) => void
  onCommit: (size: number) => void
}) {
  const start = (event: ReactMouseEvent) => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || event.button !== 0) return
    event.preventDefault()
    document.body.style.userSelect = 'none'
    // The same shield as ResizeHandle: a terminal iframe below the row would
    // swallow the pointer the moment the drag crossed into it.
    const shield = document.createElement('div')
    shield.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${layout === 'beside' ? 'col-resize' : 'row-resize'}`
    document.body.appendChild(shield)
    let last = size
    const move = (pointer: { clientX: number; clientY: number }) => {
      last = clamp(layout === 'beside' ? (box.right - pointer.clientX) / box.width : (box.bottom - pointer.clientY) / box.height)
      onSize(last)
    }
    const up = () => {
      document.body.style.userSelect = ''
      shield.remove()
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      onCommit(last)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const keys = layout === 'beside' ? { grow: 'ArrowLeft', shrink: 'ArrowRight' } : { grow: 'ArrowUp', shrink: 'ArrowDown' }
  const settle = (next: number) => {
    onSize(next)
    onCommit(next)
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === keys.grow) settle(clamp(size + STEP))
    else if (event.key === keys.shrink) settle(clamp(size - STEP))
    else if (event.key === 'Home') settle(DEFAULT_PANE_SHARES[layout])
    else return
    event.preventDefault()
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: An adjustable pane separator needs focus and a value; a native hr is not adjustable.
    <div
      role="separator"
      aria-orientation={layout === 'beside' ? 'vertical' : 'horizontal'}
      aria-label="Resize sub-agent pane"
      aria-valuemin={Math.round(PANE_SHARE.min * 100)}
      aria-valuemax={Math.round(PANE_SHARE.max * 100)}
      aria-valuenow={Math.round(size * 100)}
      tabIndex={0}
      title="Drag to resize the sub-agent pane; double-click restores the default"
      className="subagent-divider shrink-0 bg-zinc-800 hover:bg-sky-500/50 focus-visible:bg-sky-500/50 outline-none"
      onMouseDown={start}
      onDoubleClick={() => settle(DEFAULT_PANE_SHARES[layout])}
      onKeyDown={onKeyDown}
    />
  )
}
