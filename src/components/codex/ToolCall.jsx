import { useState } from 'react'
import { Pre, Field, MdBox, asText, isHuge } from '../shared/ToolCallParts.jsx'

// Render a shell command. Codex has stored it as an argv array (`command`) in
// older rollouts and as a `cmd` string (with `workdir`) in newer ones.
function commandText(input) {
  if (!input) return ''
  if (typeof input.cmd === 'string') return input.cmd
  const c = input.command
  if (Array.isArray(c)) {
    // coerce non-string argv entries so malformed data can't leak objects into render
    const parts = c.map((x) => (typeof x === 'string' ? x : asText(x)))
    // codex sometimes wraps as ["bash","-lc","<script>"] — show the script if so
    if (parts.length === 3 && /^(ba|z|)sh$/.test(parts[0]) && parts[1] === '-lc') return parts[2]
    return parts.join(' ')
  }
  if (typeof c === 'string') return c
  return ''
}

const SHELL = { color: 'text-emerald-300', badge: 'bg-emerald-500/15', preview: commandText }
const AGENT = { color: 'text-violet-300', badge: 'bg-violet-500/15' }

// Per-tool accent + how to preview the input on the collapsed header.
const TOOL_META = {
  shell: SHELL,
  shell_command: SHELL,
  local_shell: SHELL,
  exec_command: SHELL, // current Codex shell tool: { cmd, workdir }
  apply_patch: { color: 'text-amber-300', badge: 'bg-amber-500/15', preview: (i) => (i.changes ? i.changes.map((c) => `${c.kind} ${c.path}`).join(', ') : (i.patch || '').split('\n')[0]) },
  update_plan: { color: 'text-sky-300', badge: 'bg-sky-500/15', preview: (i) => `${(i.plan || i.items || []).length} steps` },
  read_file: { color: 'text-sky-300', badge: 'bg-sky-500/15', preview: (i) => i.path || i.file_path },
  web_search: { color: 'text-cyan-300', badge: 'bg-cyan-500/15', preview: (i) => i.query },
  // subagent orchestration
  spawn_agent: { ...AGENT, preview: (i) => `${i.agent_type || 'agent'}${i.message ? ` — ${i.message}` : ''}` },
  wait_agent: { ...AGENT, preview: (i) => `wait for ${(i.targets || []).length} agent(s)` },
}

function previewOf(name, input) {
  const m = TOOL_META[name]
  let s = ''
  try {
    s = m?.preview ? m.preview(input) : ''
  } catch {}
  if (!s && input) s = Object.values(input).find((v) => typeof v === 'string') || ''
  return (s || '').toString().replace(/\s+/g, ' ').slice(0, 140)
}

// An apply_patch input is already a unified-diff-ish text — color it per line.
function PatchBlock({ text }) {
  const t = asText(text)
  // One div per line gets expensive on huge patches — fall back to plain text.
  if (isHuge(t)) return <Pre>{t}</Pre>
  const lines = t.split('\n')
  return (
    <pre className="bg-ink-900 rounded-md p-2.5 mt-1 overflow-x-auto text-[12px] leading-5 font-mono whitespace-pre-wrap break-words max-h-96">
      {lines.map((l, idx) => {
        const cls = l.startsWith('+')
          ? 'text-emerald-200 bg-emerald-500/10'
          : l.startsWith('-')
            ? 'text-red-200 bg-red-500/10'
            : /^(@@|\*\*\*)/.test(l)
              ? 'text-sky-300'
              : 'text-zinc-300'
        return (
          <div key={idx} className={cls}>
            {l || ' '}
          </div>
        )
      })}
    </pre>
  )
}

const SHELL_TOOLS = new Set(['shell', 'shell_command', 'local_shell', 'exec_command'])

// Pretty input views per tool; anything unlisted (or throwing) falls back to
// the raw JSON block, so unknown shapes lose nothing.
function prettyInput(name, input) {
  if (!input) return null
  try {
    if (SHELL_TOOLS.has(name)) {
      const cmd = commandText(input)
      if (!cmd) return null
      return (
        <>
          <Pre>{cmd}</Pre>
          <Field label="workdir">{input.workdir}</Field>
        </>
      )
    }
    if (name === 'apply_patch' && typeof input.patch === 'string') return <PatchBlock text={input.patch} />
    if (name === 'read_file') {
      const p = input.path ?? input.file_path
      return p == null ? null : <Field label="file">{p}</Field>
    }
    if (name === 'web_search') return input.query == null ? null : <Field label="query">{input.query}</Field>
    if (name === 'update_plan') {
      const items = Array.isArray(input.plan) ? input.plan : Array.isArray(input.items) ? input.items : []
      if (!items.length) return null
      return (
        <ul className="mt-1 space-y-0.5 text-[12.5px] leading-5 text-zinc-300 list-none">
          {items.map((it, idx) => {
            const o = it && typeof it === 'object' ? it : null
            const label = typeof it === 'string' ? it : asText(o?.step ?? o?.text ?? it)
            return (
              <li key={idx} className="flex gap-2">
                <span className="text-zinc-600 select-none">{o?.status === 'completed' ? '☑' : o?.status === 'in_progress' ? '◐' : '☐'}</span>
                <span>{label}</span>
              </li>
            )
          })}
        </ul>
      )
    }
    if (name === 'spawn_agent') {
      if (input.agent_type == null && input.message == null) return null
      return (
        <>
          <Field label="agent" mono={false}>{input.agent_type}</Field>
          {typeof input.message === 'string' ? <MdBox>{input.message}</MdBox> : <Field label="message">{input.message}</Field>}
        </>
      )
    }
  } catch {}
  return null
}

// Natural-language outputs read better as Markdown; command output stays mono.
const MD_OUTPUT = new Set(['spawn_agent', 'wait_agent', 'web_search'])

export default function ToolCall({ part }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const meta = TOOL_META[part.name] || { color: 'text-zinc-300', badge: 'bg-zinc-500/15' }
  const result = part.result
  const err = result?.isError
  const exit = result?.meta && typeof result.meta.exit_code === 'number' ? result.meta.exit_code : null
  const pretty = !raw && prettyInput(part.name, part.input)
  const outText = result ? (typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2)) : ''
  // JSON-looking output reads better (and parses faster) as plain text.
  const outAsMd = !raw && !err && MD_OUTPUT.has(part.name) && !/^[{[]/.test(outText.trimStart())

  return (
    <div className={`rounded-lg border ${err ? 'border-red-500/40' : 'border-zinc-700/70'} bg-ink-700/60 my-2`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ink-600/40 rounded-lg"
      >
        <span className="text-zinc-500 text-xs w-3">{open ? '▾' : '▸'}</span>
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${meta.badge} ${meta.color}`}>{part.name || 'tool'}</span>
        <span className="text-zinc-400 text-[12px] font-mono truncate flex-1">{previewOf(part.name, part.input)}</span>
        {err ? (
          <span className="text-[10px] text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded">{exit != null ? `exit ${exit}` : 'error'}</span>
        ) : result ? (
          <span className="text-[10px] text-zinc-500">✓</span>
        ) : (
          <span className="text-[10px] text-zinc-600">no result</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="flex items-center justify-between mt-1">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">input</div>
            <button
              onClick={() => setRaw(!raw)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-ink-600 text-zinc-400 hover:text-zinc-200"
              title="toggle raw JSON view"
            >
              {raw ? 'pretty' : 'raw'}
            </button>
          </div>
          {pretty || <Pre>{JSON.stringify(part.input ?? {}, null, 2)}</Pre>}
          {result && (
            <>
              <div className={`text-[11px] uppercase tracking-wide mt-2 ${err ? 'text-red-400' : 'text-zinc-500'}`}>
                output{err ? ' (error)' : ''}
              </div>
              {outAsMd ? <MdBox>{outText}</MdBox> : <Pre>{outText}</Pre>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
