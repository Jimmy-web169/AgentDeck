import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ConversationEvent } from '../../api/models.ts'

// Shared by parent and child transcripts; each rail controls only its own pane.
export default function ConversationNavigator({ timeline, onJump }: { timeline: ConversationEvent[]; onJump: (index: number | 'top' | 'bottom') => void }) {
  const [expanded, setExpanded] = useState(false)
  const menuId = useId()
  const navRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const prompts = useMemo(
    () => timeline.flatMap((event, index) => (event.kind === 'user' ? [{ index, text: event.text?.trim() || '(attachment)' }] : [])),
    [timeline]
  )
  useEffect(() => {
    if (!expanded) return
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setExpanded(false)
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [expanded])
  return (
    <div className="conversation-navigation-anchor">
      <nav
        ref={navRef}
        aria-label="Conversation navigation"
        className="conversation-navigation rounded-xl border border-zinc-600/60 bg-ink-800/90 shadow-lg backdrop-blur-sm text-zinc-300"
        onKeyDown={(event) => {
          if (expanded && event.key === 'Escape') {
            setExpanded(false)
            triggerRef.current?.focus({ preventScroll: true })
            event.stopPropagation()
          }
        }}
      >
        <button type="button" aria-label="Jump to first message" title="First message" onClick={() => onJump('top')} className="conversation-navigation-button">
          <Arrow up />
        </button>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Jump to a user prompt"
          aria-expanded={expanded}
          aria-controls={menuId}
          title="User prompts"
          onClick={() => setExpanded(!expanded)}
          className="conversation-navigation-button font-mono text-[11px]"
        >
          {prompts.length}
        </button>
        <button
          type="button"
          aria-label="Jump to latest message"
          title="Latest message"
          onClick={() => onJump('bottom')}
          className="conversation-navigation-button"
        >
          <Arrow />
        </button>
        {expanded && (
          <div
            id={menuId}
            ref={menuRef}
            className="conversation-prompt-menu absolute right-10 top-0 w-64 max-w-[65vw] max-h-[55vh] overflow-y-auto rounded-xl border border-zinc-600 bg-ink-800 shadow-xl p-1.5"
          >
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-zinc-400">User prompts · {prompts.length}</div>
            {prompts.map((prompt, order) => (
              <button
                type="button"
                key={prompt.index}
                title={prompt.text}
                onClick={() => {
                  onJump(prompt.index)
                  setExpanded(false)
                }}
                className="flex w-full gap-2 rounded-lg px-2 py-2 text-left text-[12px] hover:bg-ink-600 focus-visible:bg-ink-600"
              >
                <span className="text-zinc-400 shrink-0 font-mono">{order + 1}</span>
                <span className="line-clamp-2 break-words">{prompt.text.slice(0, 240)}</span>
              </button>
            ))}
            {!prompts.length && <p className="p-2 text-[12px] text-zinc-400">No user prompts yet.</p>}
          </div>
        )}
      </nav>
    </div>
  )
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-4 h-4 ${up ? 'rotate-180' : ''}`}>
      <path d="M10 3v12m-5-5 5 5 5-5M5 18h10" />
    </svg>
  )
}
