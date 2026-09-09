import { useEffect, useRef, useState } from 'react'
import { deckApi } from '../../lib/deckApi.js'
import { liveTarget } from '../../lib/tabs.js'
import useEscToClose from '../../lib/useEscToClose.js'

const btn = 'px-3 py-2 rounded-lg text-xs bg-ink-600 text-zinc-200 hover:bg-ink-500 disabled:opacity-40'
const input = 'mt-1.5 w-full rounded-lg border border-zinc-700 bg-ink-900 px-3 py-2 text-sm text-zinc-200'
const sourceKey = (s) => JSON.stringify([s.provider, s.root])
export default function ConversationHandoffDialog({ source, mode, providers, onClose, onOpen }) {
  const sending = mode === 'send'
  const [destinations, setDestinations] = useState([]), [destination, setDestination] = useState('')
  const [task, setTask] = useState(''), [result, setResult] = useState(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [loading, setLoading] = useState(sending)
  const inFlight = useRef(false), exported = useRef(null)
  useEscToClose(onClose, !busy)
  useEffect(() => {
    if (!sending) return
    let stale = false
    deckApi('handoff/destinations').then((r) => {
      if (stale) return
      setDestinations(r.destinations)
      const next = r.destinations.find((s) => s.provider !== source.provider) || r.destinations.find((s) => sourceKey(s) !== sourceKey(source)) || r.destinations[0]
      setDestination(next ? sourceKey(next) : '')
    }).catch((e) => { if (!stale) setError(e.message) }).finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [sending, source])
  useEffect(() => {
    if (!busy) return
    const guard = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [busy])
  const show = (value) => {
    exported.current = value; setResult(value)
    if (value.state === 'launched' && value.terminal) {
      onOpen(liveTarget(value.terminal), { newTab: true }); onClose()
    }
  }
  const run = async (check = false) => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (check) {
        setProgress('Checking the exact terminal…')
        show(await deckApi(`handoff/status?id=${encodeURIComponent(exported.current.id)}`))
        return
      }
      let value = exported.current
      if (!value) {
        setProgress('Reading the complete conversation and subagents, then saving JSONL…')
        value = await deckApi('handoff/export', { source, task: task.trim() || null })
        exported.current = value; setResult(value)
      }
      if (!sending || !value.history.complete) return
      const [provider, root] = JSON.parse(destination)
      setProgress('JSONL saved. Starting a new conversation in the source folder…')
      // Mark uncertain BEFORE the network call. A lost response can mean a
      // successful CLI launch. Only Check is offered until status is known.
      show({ ...value, state: 'dispatching' })
      show(await deckApi('handoff/send', { id: value.id, target: { provider, root } }))
    } catch (e) { setError(e.message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const canSend = !loading && !!destination
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
    <div role="dialog" aria-modal="true" aria-label={sending ? 'Continue with another AI' : 'Export conversation'} className="w-[40rem] max-w-full max-h-[90vh] overflow-y-auto bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-base text-zinc-100">{sending ? 'Continue with another AI' : 'Export conversation'}</h2><button className={btn} disabled={busy} aria-label="Close" onClick={onClose}>✕</button></div>
      <p className="text-xs text-zinc-400">{source.title || source.id}</p>
      <p className="text-sm text-zinc-300">Saves all locally available user and AI messages, including subagent conversations, to a portable JSONL. Tool calls, tool output and thinking are excluded.</p>
      {sending && <>
        <label className="block text-xs text-zinc-400">Receiving AI / root<select className={input} value={destination} disabled={busy || loading || (!!result && (result.state !== 'exported' || !result.history.complete))} onChange={(e) => setDestination(e.target.value)}>
          {!destination && <option value="">{loading ? 'Loading…' : 'No receiving AI available'}</option>}
          {destinations.map((s) => <option key={sourceKey(s)} value={sourceKey(s)}>{providers.find((p) => p.id === s.provider)?.label || s.provider} · {s.rootLabel}</option>)}
        </select></label>
        <p className="text-xs text-zinc-400 break-words">Working folder: {source.cwd || 'Resolved from the original conversation'}<br />The new AI uses the same folder. Your source session stays open; files are shared, not copied.</p>
      </>}
      <label className="block text-xs text-zinc-400">Next task (optional)<textarea className={input} rows="3" maxLength={8000} disabled={busy || !!result} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Leave blank to let the receiving AI ask what to do next." /></label>
      <p className="text-xs text-zinc-500">Saved in AgentDeck’s .agentdeck/handoffs. Conversation text may contain private information and old paths. Old paths are historical reference, not the new working directory. The first JSONL record explains how to read the handoff.</p>
      {result && <div role="status" className="rounded-lg border border-zinc-700 p-3 space-y-2">
        <p className="text-sm text-zinc-200">JSONL saved · {result.history.messages} messages · {result.history.conversations} conversations</p>
        <p className="text-xs text-zinc-400 break-all">{result.file}</p>
        <p className="text-xs text-zinc-500">{(result.bytes / 1024).toFixed(1)} KiB · {result.filename}</p>
        {!result.history.complete && <p className="text-xs text-amber-300">Incomplete history — {result.history.warnings.map((w) => w.code).join(', ')}. Warnings are included in the file. It has not been sent to an AI.</p>}
        {result.error && <p className="text-xs text-amber-300">{result.error}</p>}
      </div>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {busy && <p role="status" aria-live="polite" className="text-sm text-sky-300">{progress}</p>}
      <div className="flex flex-wrap gap-2">
        {(!result || (sending && result.state === 'exported' && result.history.complete)) && <button className={`${btn} !bg-sky-600 hover:!bg-sky-500 !text-white`} disabled={busy || (sending && !canSend)} onClick={() => run()}>{sending ? 'Save JSONL & open new tab' : 'Save JSONL only'}</button>}
        {result && ['dispatching', 'unknown'].includes(result.state) && <button className={btn} disabled={busy} onClick={() => run(true)}>Check existing conversation · do not resend</button>}
        <button className={btn} disabled={busy} onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>
      </div>
      {!sending && <p className="text-xs text-zinc-500">Exporting does not start or send anything to an AI.</p>}
    </div>
  </div>
}
