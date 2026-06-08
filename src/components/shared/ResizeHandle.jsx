// A thin horizontal grab bar that resizes the element in `targetRef` by dragging.
export default function ResizeHandle({ targetRef, onHeight, min = 36, max = 600, title = 'Drag to resize the composer' }) {
  const start = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = targetRef.current?.offsetHeight || min
    document.body.style.userSelect = 'none'
    const move = (ev) => {
      const h = Math.min(max, Math.max(min, startH - (ev.clientY - startY)))
      onHeight(h)
    }
    const up = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return <div onMouseDown={start} className="h-1.5 cursor-row-resize bg-zinc-800 hover:bg-sky-500/50" title={title} />
}
