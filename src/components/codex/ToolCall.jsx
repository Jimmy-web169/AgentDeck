import { useState } from 'react'

// Render a shell command. Codex has stored it as an argv array (`command`) in
// older rollouts and as a `cmd` string (with `workdir`) in newer ones.
function commandText(input) {
  if (!input) return ''
  if (typeof input.cmd === 'string') return input.cmd
  const c = input.command
  if (Array.isArray(c)) {
    // codex sometimes wraps as ["bash","-lc","<script>"] — show the script if so
    if (c.length === 3 && /^(ba|z|)sh$/.test(c[0]) && c[1] === '-lc') return c[2]
    return c.join(' ')
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

function Pre({ children }) {
  return (
    <pre className="bg-ink-900 rounded-md p-2.5 mt-1 overflow-x-auto text-[12px] leading-5 font-mono text-zinc-300 whitespace-pre-wrap break-words max-h-96">
      {children}
    </pre>
  )
}

const SHELL_TOOLS = new Set(['shell', 'shell_command', 'local_shell', 'exec_command'])

function renderInput(name, input) {
  if (SHELL_TOOLS.has(name) && commandText(input)) return commandText(input)
  if (name === 'apply_patch' && typeof input.patch === 'string') return input.patch
  return JSON.stringify(input ?? {}, null, 2)
}

export default function ToolCall({ part }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[part.name] || { color: 'text-zinc-300', badge: 'bg-zinc-500/15' }
  const result = part.result
  const err = result?.isError
  const exit = result?.meta && typeof result.meta.exit_code === 'number' ? result.meta.exit_code : null

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
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 mt-1">input</div>
          <Pre>{renderInput(part.name, part.input)}</Pre>
          {result && (
            <>
              <div className={`text-[11px] uppercase tracking-wide mt-2 ${err ? 'text-red-400' : 'text-zinc-500'}`}>
                output{err ? ' (error)' : ''}
              </div>
              <Pre>{typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2)}</Pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
