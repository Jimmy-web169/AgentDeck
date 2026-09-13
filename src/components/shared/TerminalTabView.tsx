import { useState } from 'react'
import type { Target } from '../../../shared/types.d.ts'
import { createApi } from '../../api/index.ts'
import { errorMessage } from '../../lib/errors.ts'
import { popoutHref, popoutWindowName } from '../../lib/route.ts'
import { sessionTargetOf } from '../../lib/tabs.ts'
import { announceTerminalEnd } from '../../lib/terminalTarget.ts'
import { setTermView, shellActions } from '../../store/index.ts'
import { TerminalPage } from './TerminalPopout.tsx'

// A terminal in its own AgentDeck tab, beside its conversation's tab. The
// conversation's panel folds to a bar while this tab exists, so one pty has one
// viewer; "Back to session" and the panel's "re-embed" fold it back.
export default function TerminalTabView({ target }: { target: Target }) {
  const session = sessionTargetOf(target)
  const key = target.terminalKey || ''
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const popOut = () => {
    const w = window.open(popoutHref(session), popoutWindowName(key))
    if (!w) return
    setTermView(key, 'popped')
    shellActions.closeTerminalTabs(key)
    try {
      w.focus()
    } catch {}
  }
  const end = async () => {
    setBusy(true)
    setError(null)
    try {
      await createApi(target.provider || '').terminalStop({ key })
      announceTerminalEnd(target.provider || '', key)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <TerminalPage
      target={session}
      onBack={() => shellActions.backToSession(target)}
      backTitle="Show the conversation and fold this terminal back into its panel"
      actions={
        <>
          <button type="button" onClick={popOut} className="shrink-0 text-zinc-400 hover:text-sky-300" title="Open in a new browser tab instead of this tab">
            ⤢ pop out
          </button>
          {error && (
            <span className="text-red-300 truncate" title={error}>
              ⚠ {error}
            </span>
          )}
          <button
            type="button"
            onClick={end}
            disabled={busy}
            className="shrink-0 text-zinc-500 hover:text-red-300 disabled:opacity-40"
            title="End the running CLI"
          >
            End ✕
          </button>
        </>
      }
    />
  )
}
