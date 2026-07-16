import { useEffect, useRef } from 'react'

// Module-level stack of mounted modals' close callbacks. A single shared
// window keydown listener fires only the top entry, so stacked modals close
// innermost-first (one Escape = one modal). Entries are ref objects, so a
// changed onClose identity updates in place without losing stack position.
const stack = []

const onWindowKeyDown = (e) => {
  if (e.key !== 'Escape') return
  // Escape during IME composition (e.g. CJK input) cancels the composition;
  // it must not also dismiss the modal and lose the form input.
  if (e.isComposing || e.keyCode === 229) return
  const top = stack[stack.length - 1]
  if (top) top.current()
}

// Close a modal on Escape. Each mounted modal registers on a shared stack;
// only the innermost (most recently mounted) modal responds to Escape.
// Pass `enabled = false` to temporarily opt out (e.g. while a request is in
// flight) — the modal keeps its stack position but Escape is ignored.
export default function useEscToClose(onClose, enabled = true) {
  const cb = useRef(onClose)
  cb.current = enabled ? onClose : () => {}

  useEffect(() => {
    if (stack.length === 0) window.addEventListener('keydown', onWindowKeyDown)
    stack.push(cb)
    return () => {
      const i = stack.indexOf(cb)
      if (i !== -1) stack.splice(i, 1)
      if (stack.length === 0) window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [])
}
