import { useRef, useState } from 'react'

async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  // Legacy fallback for non-secure contexts (e.g. served over LAN http)
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function CopyButton({ text, title = 'Copy' }) {
  const [state, setState] = useState(null) // null | 'ok' | 'fail'
  const timer = useRef(null)
  const onClick = async () => {
    const ok = await writeClipboard(typeof text === 'function' ? text() : text)
    setState(ok ? 'ok' : 'fail')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState(null), 1500)
  }
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
    >
      {state === 'ok' ? (
        <span className="text-emerald-400">✓ copied</span>
      ) : state === 'fail' ? (
        <span className="text-red-400">✕ failed</span>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          copy
        </>
      )}
    </button>
  )
}
