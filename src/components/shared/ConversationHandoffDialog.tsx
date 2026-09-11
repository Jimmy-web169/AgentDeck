import { errorMessage } from '../../lib/errors.ts'
import { homeSourceKey } from '../../../shared/identity.ts'
import { useEffect, useRef, useState } from 'react'
import { useDeckMutation, useHandoffStatusCommand, useHandoffDestinations } from '../../api/index.ts'
import { liveTarget } from '../../lib/tabs.ts'
import useEscToClose from '../../lib/useEscToClose.ts'
import type { Handoff } from '../../../shared/types.js'

const btn = 'px-3 py-2 rounded-lg text-xs bg-ink-600 text-zinc-200 hover:bg-ink-500 disabled:opacity-40'
const input = 'mt-1.5 w-full rounded-lg border border-zinc-700 bg-ink-900 px-3 py-2 text-sm text-zinc-200'
export default function ConversationHandoffDialog({
  source,
  mode,
  providers,
  onClose,
  onOpen,
}: {
  source: import('../../../shared/types.d.ts').Target
  mode: string
  providers: import('../../lib/providerColors.ts').ColorProvider[]
  onClose: () => void
  onOpen: (target: import('../../../shared/types.d.ts').Target, options?: { newTab?: boolean }) => void
}) {
  const exportHandoff = useDeckMutation('exportHandoff')
  const sendHandoff = useDeckMutation('sendHandoff')
  const checkStatus = useHandoffStatusCommand()
  const sending = mode === 'send'
  const targets = useHandoffDestinations(sending)
  const destinations = targets.data?.destinations || []
  const [pickedDestination, setDestination] = useState('')
  const preferred =
    destinations.find((s) => s.provider !== source.provider) ||
    destinations.find((s) => homeSourceKey(s) !== homeSourceKey({ provider: source.provider || '', root: source.root || '' })) ||
    destinations[0]
  const destination = destinations.some((s) => homeSourceKey(s) === pickedDestination) ? pickedDestination : preferred ? homeSourceKey(preferred) : ''
  const [task, setTask] = useState(''),
    [result, setResult] = useState<Handoff | null>(null),
    [actionError, setError] = useState('')
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState('')
  const loading = sending && targets.isPending
  const error = actionError || targets.error?.message || ''
  const inFlight = useRef(false),
    exported = useRef<Handoff | null>(null)
  useEscToClose(onClose, !busy)
  useEffect(() => {
    if (!busy) return
    const guard = (e: { preventDefault: () => void; returnValue: string }) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [busy])
  const show = (value: Handoff) => {
    exported.current = value
    setResult(value)
    if (value.state === 'launched' && value.terminal) {
      onOpen(liveTarget(value.terminal), { newTab: true })
      onClose()
    }
  }
  const run = async (check = false) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      if (check) {
        const current = exported.current
        if (!current) throw new Error('No export is available to check.')
        setProgress('Checking the exact terminal…')
        show(await checkStatus(current.id))
        return
      }
      let value = exported.current
      if (!value) {
        setProgress('Reading the complete conversation and subagents, then saving JSONL…')
        value = await exportHandoff.mutateAsync({ source, task: task.trim() || null })
        exported.current = value
        setResult(value)
      }
      if (!sending || !value.history.complete) return
      const [provider, root] = JSON.parse(destination)
      setProgress('JSONL saved. Starting a new conversation in the source folder…')
      // Mark uncertain BEFORE the network call. A lost response can mean a
      // successful CLI launch. Only Check is offered until status is known.
      show({ ...value, state: 'dispatching' })
      show(await sendHandoff.mutateAsync({ id: value.id, target: { provider, root } }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const canSend = !loading && !!destination
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={sending ? 'Continue with another AI' : 'Export conversation'}
        className="w-[40rem] max-w-full max-h-[90vh] overflow-y-auto bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base text-zinc-100">{sending ? 'Continue with another AI' : 'Export conversation'}</h2>
          <button type="button" className={btn} disabled={busy} aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="text-xs text-zinc-400">{source.title || source.id}</p>
        <p className="text-sm text-zinc-300">
          Saves all locally available user and AI messages, including subagent conversations, to a portable JSONL. Tool calls, tool output and thinking are
          excluded.
        </p>
        {sending && (
          <>
            <label className="block text-xs text-zinc-400">
              Receiving AI / root
              <select
                className={input}
                value={destination}
                disabled={busy || loading || (!!result && (result.state !== 'exported' || !result.history.complete))}
                onChange={(e) => setDestination(e.target.value)}
              >
                {!destination && <option value="">{loading ? 'Loading…' : 'No receiving AI available'}</option>}
                {destinations.map((s) => (
                  <option key={homeSourceKey(s)} value={homeSourceKey(s)}>
                    {providers.find((p: { id: string }) => p.id === s.provider)?.label || s.provider} · {s.rootLabel}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-zinc-400 break-words">
              Working folder: {source.cwd || 'Resolved from the original conversation'}
              <br />
              The new AI uses the same folder. Your source session stays open; files are shared, not copied.
            </p>
          </>
        )}
        <label className="block text-xs text-zinc-400">
          Next task (optional)
          <textarea
            className={input}
            rows={3}
            maxLength={8000}
            disabled={busy || !!result}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Leave blank to let the receiving AI ask what to do next."
          />
        </label>
        <p className="text-xs text-zinc-500">
          Saved in AgentDeck’s .agentdeck/handoffs. Conversation text may contain private information and old paths. Old paths are historical reference, not the
          new working directory. The first JSONL record explains how to read the handoff.
        </p>
        {result && (
          <div role="status" className="rounded-lg border border-zinc-700 p-3 space-y-2">
            <p className="text-sm text-zinc-200">
              JSONL saved · {result.history.messages} messages · {result.history.conversations} conversations
            </p>
            <p className="text-xs text-zinc-400 break-all">{result.file}</p>
            <p className="text-xs text-zinc-500">
              {(result.bytes / 1024).toFixed(1)} KiB · {result.filename}
            </p>
            {!result.history.complete && (
              <p className="text-xs text-amber-300">
                Incomplete history — {result.history.warnings.map((w) => w.code).join(', ')}. Warnings are included in the file. It has not been sent to an AI.
              </p>
            )}
            {result.error && <p className="text-xs text-amber-300">{result.error}</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" aria-live="polite" className="text-sm text-sky-300">
            {progress}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(!result || (sending && result.state === 'exported' && result.history.complete)) && (
            <button type="button" className={`${btn} !bg-sky-600 hover:!bg-sky-500 !text-white`} disabled={busy || (sending && !canSend)} onClick={() => run()}>
              {sending ? 'Save JSONL & open new tab' : 'Save JSONL only'}
            </button>
          )}
          {result && ['dispatching', 'unknown'].includes(result.state) && (
            <button type="button" className={btn} disabled={busy} onClick={() => run(true)}>
              Check existing conversation · do not resend
            </button>
          )}
          <button type="button" className={btn} disabled={busy} onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
        {!sending && <p className="text-xs text-zinc-500">Exporting does not start or send anything to an AI.</p>}
      </div>
    </div>
  )
}
