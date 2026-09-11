import { errorMessage } from '../../lib/errors.ts'
import type { Target } from '../../../shared/types.d.ts'
import type { ProviderClient } from '../../api/providerApi.ts'
export interface ContextSummary {
  contextWindow?: number | null
  lastTokenUsage?: { input_tokens?: number } | null
}
export interface MeterProps {
  summary?: ContextSummary | null
  used?: number | null
  label?: string
}
export interface TitleProps {
  isNew?: boolean
  resume?: string
  id?: string | null
}
export type TerminalProps = Target & {
  contextUsed?: number | null
  paneKey?: string
  transcriptReady?: boolean
  isNew?: boolean
  contextSummary?: ContextSummary | null
  runningKeys?: Set<string>
  onClose?: () => void
  onChange?: () => void
  onOpenTool?: (tool: 'vscode' | 'terminal') => unknown
}
export interface TerminalPresentation {
  sessionKey: (root: string, slug: string, id: string) => string
  height: { key: string; minimum: number; maximum: number; fallback: () => number }
  continueLabel: string
  endTitle: string
  panelClass: string
  headerClass: string
  reloadClass: string
  reloadTitle?: string
  reloadLabel: string
  idleContext: boolean
  headerError: boolean
  wrapFrame: boolean
  frameTitle: string
}
interface Props extends TerminalProps {
  api: ProviderClient
  resume?: string
  presentation: TerminalPresentation
  ContextMeter: React.ComponentType<MeterProps>
  IdleNote: React.ComponentType<{ resume?: string }>
  Title: React.ComponentType<TitleProps>
}
import { terminalKey as terminalKeyFor, legacyDraftKey, terminalEntryKey } from '../../../shared/identity.ts'
import { useEffect, useRef, useState } from 'react'
import { shortPath } from '../../lib/paths.ts'
import OpenAppButtons from './OpenAppButtons.tsx'
import ResizeHandle from './ResizeHandle.tsx'
import { getTermView, setTermView, useTerminalHeight, useShell } from '../../store/index.ts'
import { terminalRequest, announceTerminal, announceTerminalEnd } from '../../lib/terminalTarget.ts'
import TerminalStatus from './TerminalStatus.tsx'
import LinkConversationButton from './LinkConversationButton.tsx'
import HandoffActions from './HandoffActions.tsx'

// One terminal lifecycle for all providers. Presentation slots preserve each
// provider’s existing labels, context meter and geometry; tabs never own tmux.
export default function TerminalPanel({
  api,
  resume,
  presentation,
  ContextMeter,
  IdleNote,
  Title,
  contextUsed,
  paneKey,
  transcriptReady,
  root,
  slug,
  cwd,
  id,
  title,
  launchId,
  terminalKey,
  isNew,
  contextSummary,
  runningKeys,
  onClose,
  onChange,
  onOpenTool,
}: Props) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [canLink, setCanLink] = useState(false)
  const [view, setView] = useState('embedded') // 'embedded' | 'hidden' | 'popped' — persisted per key, survives navigation
  const wrapRef = useRef<HTMLDivElement>(null)
  const popoutRef = useRef<Window | null>(null)
  const autoKeyRef = useRef<string | null>(null) // target key we've already auto-decided — attach once, never reopen after the user closes/pops out
  const [h, setH] = useTerminalHeight(presentation.height)

  // server-side key for this target — must match server postTerminal()
  const providerId = api.provider
  const myKey =
    terminalKey ||
    (launchId
      ? terminalKeyFor(providerId, root || '', { launchId })
      : id
        ? presentation.sessionKey(root || '', slug || '', id)
        : legacyDraftKey(root || '', cwd || slug || ''))
  const requestSeq = useRef(0)

  const start = (auto: boolean | React.MouseEvent = false) => {
    if (loading && auto !== true) return
    const request = ++requestSeq.current
    autoKeyRef.current = myKey // mark this target handled (manual or auto) so the auto-reattach effect won't double-fire or reopen
    setLoading(true)
    setErr(null)
    const body = terminalRequest({ root, slug, cwd, id, title, launchId, terminalKey })
    api
      .terminal(body)
      .then((d) => {
        if (request !== requestSeq.current) return
        setUrl(d.url || null)
        setCanLink(!!d.canBindSession)
        setKey(d.key)
        setOpen(true)
        onChange?.()
        announceTerminal(providerId, { ...d, requestedTarget: { root, slug, cwd, id, launchId, terminalKey, draft: !!isNew } })
      })
      .catch((e: unknown) => request === requestSeq.current && setErr(errorMessage(e)))
      .finally(() => request === requestSeq.current && setLoading(false))
  }

  // on target change: reset, then decide. If runningKeys already knows this
  // target is live, reattach now; otherwise the effect below catches it once the
  // live list finishes loading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only the owning pane identity resets its iframe; transcript promotion must preserve the mounted terminal.
  useEffect(() => {
    setOpen(false)
    setUrl(null)
    setKey(null)
    setErr(null)
    setView(getTermView(myKey) || 'embedded')
    autoKeyRef.current = null
    if (terminalKey || runningKeys?.has(myKey)) start(true)
    return () => {
      requestSeq.current++
      setLoading(false)
    }
  }, [paneKey || myKey])

  // Transcript promotion must not reset this pane or its iframe.
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new URL or explicit reload starts a new frame-load lifecycle.
  useEffect(() => setFrameLoaded(false), [url, nonce])
  const endVersion = useShell((state) => (key ? state.terminalEnds[terminalEntryKey(providerId, '', key)] || 0 : 0))
  const watchedEnd = useRef<{ key: string | null; version: number }>({ key: null, version: 0 })
  useEffect(() => {
    if (watchedEnd.current.key !== key) {
      watchedEnd.current = { key, version: endVersion }
      return
    }
    if (endVersion <= watchedEnd.current.version) return
    watchedEnd.current.version = endVersion
    requestSeq.current++
    autoKeyRef.current = myKey
    setLoading(false)
    setOpen(false)
    setUrl(null)
    setKey(null)
  }, [key, endVersion, myKey])

  // Late reattach: the live-tmux list (runningKeys) loads asynchronously, so
  // entering a session cold from the project list mounts BEFORE it's known —
  // unlike the Live panel, which has it preloaded. Re-check when it arrives, but
  // only once per target (autoKeyRef) and only while nothing is open yet, so it
  // never reopens after the user closed or popped the terminal out. This is what
  // keeps the same session from being opened as a second terminal.
  const isLive = !!terminalKey || !!runningKeys?.has(myKey)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry attachment only when the exact live identity appears, never after the user hides/closes the viewer.
  useEffect(() => {
    // reattach even when hidden/popped so we hold a fresh url for show/focus; the
    // view state (not this effect) decides whether the iframe is actually rendered.
    if (autoKeyRef.current === myKey || open || url || loading) return
    if (isLive) start()
  }, [isLive, terminalKey])

  // explicit end — kills the server-side ttyd
  const stop = async () => {
    try {
      if (key) await api.terminalStop({ key })
    } catch (e) {
      setErr(errorMessage(e))
      return
    }
    requestSeq.current++
    if (key) announceTerminalEnd(providerId, key)
    try {
      popoutRef.current?.close?.()
    } catch {}
    setTermView(myKey, null)
    setOpen(false)
    setUrl(null)
    setKey(null)
    setView('embedded')
    onChange?.()
    onClose?.()
  }

  // hide = collapse the panel but keep tmux + ttyd alive (NOT terminalStop)
  const hide = () => {
    setTermView(key || myKey, 'hidden')
    setView('hidden')
  }
  const reEmbed = () => {
    setTermView(key || myKey, null)
    setView('embedded')
  }

  // open the ttyd terminal in a new browser tab (not a separate window) and collapse the embedded iframe
  const popOut = () => {
    // named (not _blank) so re-opening reuses the same tab; no window features = a tab, not a popup window
    const w = window.open(url || '', `agentdeck-term-${key || myKey}`)
    if (w) {
      popoutRef.current = w
      setTermView(key || myKey, 'popped')
      setView('popped')
      try {
        w.focus()
      } catch {}
    } else {
      window.open(url || '', '_blank', 'noopener')
    }
  }

  // collapsed: just a button — never auto-POSTs except the reattach above
  if (!open || !url) {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={loading}
          className="shrink-0 text-[13px] px-3 py-1.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
        >
          {loading
            ? isLive
              ? 'Reconnecting to terminal…'
              : 'Starting terminal…'
            : isNew
              ? `▸ Open terminal in ${shortPath(cwd || slug || '')} (new conversation)`
              : presentation.continueLabel}
        </button>
        <HandoffActions provider={providerId} root={root} slug={slug} id={id} cwd={cwd} title={title} disabled={loading} />
        <OpenAppButtons onOpenTool={onOpenTool} />
        {err ? (
          <span className="text-[11px] text-red-300 truncate">⚠ {err}</span>
        ) : (
          <span className="flex-1 min-w-0 text-[11px] text-zinc-600 truncate">
            <IdleNote resume={resume} />
          </span>
        )}
        {presentation.idleContext && <ContextMeter summary={contextSummary} used={contextUsed} label="ctx" />}
      </div>
    )
  }

  // popped out: collapse to a slim bar so the monitoring page stays clean
  if (view === 'popped') {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex flex-wrap items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" />
        <span className="text-[12px] text-zinc-400 shrink-0">Terminal running in a separate tab</span>
        <HandoffActions provider={providerId} root={root} slug={slug} id={id} cwd={cwd} title={title} disabled={loading} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            try {
              const w = window.open(url || '', `agentdeck-term-${key || myKey}`)
              if (w) {
                popoutRef.current = w
                w.focus()
              }
            } catch {}
          }}
          className="text-[12px] text-sky-300/90 hover:text-sky-200"
        >
          focus tab
        </button>
        <button type="button" onClick={reEmbed} className="text-[12px] text-zinc-400 hover:text-zinc-200">
          ⧉ re-embed
        </button>
        <button type="button" onClick={stop} className="text-[12px] text-zinc-500 hover:text-red-300" title={presentation.endTitle}>
          End ✕
        </button>
      </div>
    )
  }

  // hidden: collapsed but tmux + ttyd kept running — bring it back with "show"
  if (view === 'hidden') {
    return (
      <div className="shrink-0 border-t border-zinc-800 bg-ink-900/60 px-4 py-2 flex flex-wrap items-center gap-3">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
        <span className="text-[12px] text-zinc-400 shrink-0">Terminal hidden · tmux still running</span>
        <HandoffActions provider={providerId} root={root} slug={slug} id={id} cwd={cwd} title={title} disabled={loading} />
        <span className="flex-1" />
        <button type="button" onClick={reEmbed} className="text-[12px] text-sky-300/90 hover:text-sky-200">
          ▸ show
        </button>
        <button type="button" onClick={popOut} className="text-[12px] text-zinc-400 hover:text-zinc-200">
          ⤢ pop out
        </button>
        <button type="button" onClick={stop} className="text-[12px] text-zinc-500 hover:text-red-300" title={presentation.endTitle}>
          End ✕
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={presentation.panelClass} style={{ height: h }}>
      <ResizeHandle targetRef={wrapRef} onHeight={setH} height={h} min={160} max={1200} title="Drag to resize the terminal" />
      <div className={presentation.headerClass}>
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
        <span className="text-zinc-400">
          <Title isNew={isNew} resume={resume} id={id} />
        </span>
        {presentation.headerError && err && (
          <span className="text-red-300 truncate" title={err}>
            ⚠ {err}
          </span>
        )}
        <div className="flex-1" />
        <ContextMeter summary={contextSummary} used={contextUsed} label="ctx" />
        <HandoffActions provider={providerId} root={root} slug={slug} id={id} cwd={cwd} title={title} disabled={loading} />
        <OpenAppButtons onOpenTool={onOpenTool} className="mr-1" />
        <button type="button" onClick={popOut} className="text-zinc-500 hover:text-sky-300" title="Open in a new browser tab and collapse this panel">
          ⤢ pop out
        </button>
        <button
          type="button"
          onClick={() => {
            setFrameLoaded(false)
            setNonce((n) => n + 1)
          }}
          className={presentation.reloadClass}
          title={presentation.reloadTitle}
        >
          {presentation.reloadLabel}
        </button>
        <button type="button" onClick={hide} className="text-zinc-500 hover:text-zinc-200 ml-1" title="Hide this panel but keep the session running">
          ▾ hide
        </button>
        <button type="button" onClick={stop} className="text-zinc-500 hover:text-red-300 ml-1" title={presentation.endTitle}>
          End ✕
        </button>
      </div>
      <TerminalStatus
        loading={loading}
        reconnecting={isLive}
        running={open && !!url}
        frameLoaded={frameLoaded}
        id={id}
        transcriptReady={transcriptReady}
        terminalKey={key}
        repair={
          canLink && key && cwd ? <LinkConversationButton api={api} provider={providerId} root={root || ''} cwd={cwd || ''} terminalKey={key || ''} /> : null
        }
      />
      {presentation.wrapFrame ? (
        <div className="flex-1 min-h-0" style={{ background: 'rgb(var(--ink-terminal))' }}>
          <iframe key={nonce} src={url} onLoad={() => setFrameLoaded(true)} title={presentation.frameTitle} className="w-full h-full border-0" />
        </div>
      ) : (
        <iframe
          key={nonce}
          src={url}
          onLoad={() => setFrameLoaded(true)}
          title={presentation.frameTitle}
          className="flex-1 w-full border-0"
          style={{ background: 'rgb(var(--ink-terminal))' }}
        />
      )}
    </div>
  )
}
