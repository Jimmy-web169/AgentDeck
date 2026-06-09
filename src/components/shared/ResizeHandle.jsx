// A thin horizontal grab bar that resizes the element in `targetRef` by dragging.
export default function ResizeHandle({ targetRef, onHeight, min = 36, max = 600, title = 'Drag to resize the composer' }) {
  const start = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = targetRef.current?.offsetHeight || min
    document.body.style.userSelect = 'none'
    // Cover the viewport while dragging. The panel below this handle often holds
    // an <iframe> (the ttyd terminal); without the shield the iframe swallows
    // mousemove/mouseup the instant the cursor crosses into it, so the drag
    // freezes and never ends. The shield sits above the iframe, so the window
    // listeners keep firing across the whole screen.
    const shield = document.createElement('div')
    shield.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:row-resize'
    document.body.appendChild(shield)
    const move = (ev) => {
      const h = Math.min(max, Math.max(min, startH - (ev.clientY - startY)))
      onHeight(h)
    }
    const up = () => {
      document.body.style.userSelect = ''
      shield.remove()
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  // shrink-0 is essential: this handle sits in a flex-col above an <iframe>
  // (the ttyd terminal). The iframe's intrinsic 150px min-height absorbs no
  // shrink (flex-basis:0%), so without shrink-0 the handle is the only item
  // that can shrink — at small panel heights it collapses to 0px and becomes
  // un-grabbable, which looks like "the terminal can't be resized".
  return <div onMouseDown={start} className="h-1.5 shrink-0 cursor-row-resize bg-zinc-800 hover:bg-sky-500/50" title={title} />
}
