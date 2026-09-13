import { useEffect, useState, type ReactNode } from 'react'
import type { Target } from '../../../shared/types.d.ts'
import { createApi } from '../../api/index.ts'
import { errorMessage } from '../../lib/errors.ts'
import { shortPath } from '../../lib/paths.ts'
import { providerColor, providerLabel } from '../../lib/providerColors.ts'
import { focusMainWindow, fromPopoutHash, currentHash } from '../../lib/route.ts'
import { PROVIDER_LIST } from '../../providers/index.ts'
import { setTermView } from '../../store/index.ts'

// The popped-out terminal: its own browser tab, the terminal filling the whole
// window under a slim bar whose one job is to get back to the conversation.
// The tab in the main window keeps its "focus tab" link, so the two switch
// either way however many tabs are open. The page attaches by exact terminal
// key on its own, so it survives a reload and reports an ended terminal.
interface PageProps {
  target: Target | null
  attach?: (target: Target) => Promise<{ url?: string | null }>
  onBack: (target: Target) => void
  backTitle?: string
  // Extra actions for the bar (the in-app terminal tab adds pop out and End).
  actions?: ReactNode
}
interface Props {
  target?: Target | null
  attach?: (target: Target) => Promise<{ url?: string | null }>
  onBack?: (target: Target) => void
}
const attachByKey = (target: Target) => createApi(target.provider || '').terminal({ root: target.root, terminalKey: target.terminalKey })
// Hand the terminal back to its panel in the main window, then go there.
const backToSession = (target: Target) => {
  setTermView(target.terminalKey || null, null)
  focusMainWindow(target)
}

export default function TerminalPopout({ target: given, attach = attachByKey, onBack = backToSession }: Props) {
  const target =
    given === undefined
      ? fromPopoutHash(
          currentHash(),
          PROVIDER_LIST.map((p) => p.id)
        )
      : given
  useEffect(() => {
    if (target) document.title = `${pageTitle(target)} · ${providerLabel(PROVIDER_LIST, target.provider)} terminal`
  }, [target])
  return <TerminalPage target={target} attach={attach} onBack={onBack} backTitle="Show this conversation in the AgentDeck window (and bring it to the front)" />
}

const pageTitle = (target: Target | null) => target?.title || (target?.cwd || target?.slug ? shortPath(target.cwd || target.slug || '') : '') || 'Terminal'

// One terminal filling its container under a slim bar whose first control goes
// back to the conversation.
export function TerminalPage({ target, attach = attachByKey, onBack, backTitle, actions }: PageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const title = pageTitle(target)
  const label = providerLabel(PROVIDER_LIST, target?.provider)
  const color = providerColor(PROVIDER_LIST, target?.provider)
  // biome-ignore lint/correctness/useExhaustiveDependencies: The reload button re-asks the server for the same terminal.
  useEffect(() => {
    if (!target?.provider || !target.root || !target.terminalKey) return
    let current = true
    setUrl(null)
    setError(null)
    attach(target)
      .then((d) => current && setUrl(d.url || null))
      .catch((e: unknown) => current && setError(errorMessage(e)))
    return () => {
      current = false
    }
  }, [target?.provider, target?.root, target?.terminalKey, attach, nonce])
  if (!target?.provider || !target.root || !target.terminalKey)
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-zinc-500">
        This link does not name a terminal. Open a conversation in AgentDeck and use “pop out”.
      </div>
    )
  return (
    <div className="h-full flex flex-col bg-black">
      <header className="shrink-0 h-9 flex items-center gap-3 px-3 border-b border-zinc-800 bg-ink-900 text-[12px]">
        <button
          type="button"
          onClick={() => onBack(target)}
          title={backTitle || 'Show this conversation'}
          className="shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-sky-500/20 text-sky-200 hover:bg-sky-500/30"
        >
          ← Back to session
        </button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color.dot}`} />
        <span className="min-w-0 flex items-baseline gap-2 truncate">
          <span className="text-zinc-100 truncate">{title}</span>
          <span className="text-zinc-500 truncate">{label}</span>
          {(target.cwd || target.slug) && <span className="text-zinc-600 font-mono truncate">{target.cwd || target.slug}</span>}
        </span>
        <span className="flex-1" />
        {error ? (
          <span className="text-red-300 truncate" title={error}>
            ⚠ {error}
          </span>
        ) : url ? (
          <span className="text-zinc-500">connected</span>
        ) : (
          <span className="text-zinc-500">connecting…</span>
        )}
        <button type="button" onClick={() => setNonce((n) => n + 1)} className="shrink-0 text-zinc-400 hover:text-zinc-200" title="Reconnect the view">
          ↻ reload
        </button>
        {actions}
      </header>
      <div className="flex-1 min-h-0">
        {url && !error ? (
          <iframe key={nonce} src={url} title={`Terminal · ${title}`} className="w-full h-full border-0" />
        ) : (
          <div className="h-full flex items-center justify-center text-[13px] text-zinc-500">
            {error ? 'The terminal is not available. Use “Back to session” to continue in AgentDeck.' : 'Connecting…'}
          </div>
        )}
      </div>
    </div>
  )
}
