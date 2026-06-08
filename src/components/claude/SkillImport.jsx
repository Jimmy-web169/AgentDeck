import { useState } from 'react'
import { api } from '../../api.js'

// Normalize whatever the user typed (a bare ref or a full `npx skills add ...`
// command) down to the args that follow `skills add`, so we can show the exact
// command that will run before they confirm.
const normalize = (input) =>
  input
    .trim()
    .replace(/^npx\s+(?:-y\s+|--yes\s+)?/i, '')
    .replace(/^(?:skills|add-skill)\s+/i, '')
    .replace(/^add\s+/i, '')
    .trim()

export default function SkillImport({ root, slug, onClose, onImported }) {
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null) // { ok, code, command, output }

  const scopeLabel = slug ? 'this project (./.claude/skills)' : 'the user folder (~/.claude/skills)'
  const previewCmd = ref.trim() ? `npx skills add ${normalize(ref)} -a claude-code${slug ? '' : ' -g'} -y` : ''

  const run = async () => {
    if (!ref.trim() || busy) return
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      const r = await api.skillRun({ root, slug, ref: ref.trim() })
      setResult(r)
      if (r.ok) onImported?.(r)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="w-[760px] max-w-[95vw] max-h-[88vh] bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="text-[14px] text-zinc-100 font-medium">Install a skill</div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl leading-none">×</button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="text-[12px] text-zinc-500">
            Runs the official{' '}
            <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noreferrer" className="text-sky-400 underline">skills</a>{' '}
            CLI — the same as <span className="font-mono text-zinc-400">npx skills add &lt;ref&gt;</span> in a terminal. Paste{' '}
            <span className="font-mono text-zinc-400">owner/repo</span>, a GitHub URL, or a full command (with flags like{' '}
            <span className="font-mono text-zinc-400">--skill &lt;name&gt;</span>). Browse skills at{' '}
            <a href="https://www.skills.sh/" target="_blank" rel="noreferrer" className="text-sky-400 underline">skills.sh</a>.
          </div>

          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="vercel-labs/agent-skills --skill agent-browser"
            className="w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 font-mono placeholder-zinc-600"
          />

          {previewCmd && (
            <div className="text-[12px]">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Will run in {scopeLabel}</div>
              <pre className="bg-ink-900 rounded-md p-2.5 text-[12px] text-emerald-200 whitespace-pre-wrap break-all font-mono">{previewCmd}</pre>
            </div>
          )}

          <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded px-2.5 py-1.5">
            ⚠ This executes an external CLI (<span className="font-mono">npx skills</span>) on this machine. Only install from sources you trust — you run it at your own risk.
          </div>

          <button
            onClick={run}
            disabled={busy || !ref.trim()}
            className="px-4 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-[13px] disabled:opacity-40"
          >
            {busy ? 'Running… (first run fetches the CLI, ~20s)' : 'Run'}
          </button>

          {err && <div className="text-[12px] text-red-300">{err}</div>}

          {result && (
            <div>
              <div className={`text-[12px] mb-1 ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                {result.ok ? '✓ done' : `✕ failed${result.code != null ? ` (exit ${result.code})` : ''}`}
              </div>
              <pre className="bg-ink-900 rounded-md p-3 text-[12px] leading-5 text-zinc-300 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{result.output}</pre>
              {result.ok && (
                <button onClick={onClose} className="mt-2 px-4 py-1.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 text-[13px]">Close</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
