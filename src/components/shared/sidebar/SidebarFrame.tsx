import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useShell, shellActions } from '../../../store/index.ts'
import type { UIProvider } from '../../../providers/views.ts'
import Sidebar from '../AppSidebar.tsx'

// Width changes subscribe here, so dragging never rerenders mounted sessions.
export default function SidebarFrame({ providers }: { providers: readonly UIProvider[] }) {
  const width = useShell((state) => state.sidebarW)
  const collapsed = useShell((state) => state.collapsed)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const startDrag = (event: ReactMouseEvent) => {
    event.preventDefault()
    cleanup.current?.()
    const startX = event.clientX,
      startWidth = width,
      userSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (next: MouseEvent) => shellActions.setSidebarW(Math.min(600, Math.max(240, startWidth + next.clientX - startX)))
    const up = () => {
      document.body.style.userSelect = userSelect
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      cleanup.current = null
    }
    cleanup.current = up
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  if (collapsed) return null
  return (
    <>
      <div style={{ width }} className="shrink-0 h-full min-w-0">
        <Sidebar providers={providers} />
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: An interactive window splitter is not a document thematic break (hr). */}
      <div
        role="separator"
        aria-label="Sidebar width"
        aria-orientation="vertical"
        aria-valuemin={240}
        aria-valuemax={600}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          shellActions.setSidebarW(Math.min(600, Math.max(240, width + (event.key === 'ArrowLeft' ? -10 : 10))))
        }}
        onMouseDown={startDrag}
        className="relative w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-sky-500/60 after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']"
        title="Drag to resize sidebar"
      />
    </>
  )
}
