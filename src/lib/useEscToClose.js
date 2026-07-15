import { useEffect } from 'react'

// Close a modal on Escape. Attach once per mounted modal; the listener lives
// only while the modal does, so stacked modals close innermost-first.
export default function useEscToClose(onClose) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}
