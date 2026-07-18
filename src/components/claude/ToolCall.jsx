import { useState } from 'react'
import { Pre, Field, MdBox, asText } from '../shared/ToolCallParts.jsx'

// Collapsed header for shell tools: the command must stay visible (a benign
// description must never mask what actually runs); description is appended.
function shellPreview(i) {
  const cmd = typeof i.command === 'string' ? i.command : ''
  const desc = typeof i.description === 'string' ? i.description : ''
  return cmd && desc ? `${cmd} — ${desc}` : cmd || desc
}

// Per-tool accent + how to preview the input on the collapsed header.
const TOOL_META = {
  Bash: { color: 'text-emerald-300', badge: 'bg-emerald-500/15', preview: shellPreview },
  PowerShell: { color: 'text-emerald-300', badge: 'bg-emerald-500/15', preview: shellPreview },
  Read: { color: 'text-sky-300', badge: 'bg-sky-500/15', preview: (i) => i.file_path },
  Edit: { color: 'text-amber-300', badge: 'bg-amber-500/15', preview: (i) => i.file_path },
  Write: { color: 'text-amber-300', badge: 'bg-amber-500/15', preview: (i) => i.file_path },
  Grep: { color: 'text-fuchsia-300', badge: 'bg-fuchsia-500/15', preview: (i) => i.pattern },
  Glob: { color: 'text-fuchsia-300', badge: 'bg-fuchsia-500/15', preview: (i) => i.pattern },
  Task: { color: 'text-violet-300', badge: 'bg-violet-500/15', preview: (i) => i.description },
  Agent: { color: 'text-violet-300', badge: 'bg-violet-500/15', preview: (i) => i.description },
  Workflow: { color: 'text-rose-300', badge: 'bg-rose-500/15', preview: (i) => i.name || 'inline script' },
  WebFetch: { color: 'text-cyan-300', badge: 'bg-cyan-500/15', preview: (i) => i.url },
  WebSearch: { color: 'text-cyan-300', badge: 'bg-cyan-500/15', preview: (i) => i.query },
}

function previewOf(name, input) {
  const m = TOOL_META[name]
  let s = ''
  try {
    s = m?.preview ? m.preview(input) : ''
  } catch {}
  if (!s && input) s = Object.values(input).find((v) => typeof v === 'string') || ''
  return (s || '').toString().replace(/\s+/g, ' ').slice(0, 120)
}

// ---- pretty input views ------------------------------------------------------
// Free prose (descriptions, prompts) — the parts that were written for humans.
function Prose({ children }) {
  if (children == null || children === '') return null
  return <div className="text-[12.5px] leading-5 text-zinc-200 mt-1 whitespace-pre-wrap break-words">{asText(children)}</div>
}

// old → new, git-diff style. The single most unreadable thing as raw JSON.
function DiffBlock({ oldText, newText }) {
  return (
    <div className="mt-1 rounded-md overflow-hidden border border-zinc-700/50 text-[12px] font-mono leading-5">
      <div className="bg-red-500/10 border-l-2 border-red-500/60">
        <div className="px-2.5 pt-1 text-[10px] text-red-300 select-none">− old</div>
        <pre className="px-2.5 pb-2 m-0 whitespace-pre-wrap break-words overflow-x-auto max-h-60 text-red-200">{asText(oldText)}</pre>
      </div>
      <div className="bg-emerald-500/10 border-l-2 border-emerald-500/60 border-t border-zinc-700/40">
        <div className="px-2.5 pt-1 text-[10px] text-emerald-300 select-none">+ new</div>
        <pre className="px-2.5 pb-2 m-0 whitespace-pre-wrap break-words overflow-x-auto max-h-60 text-emerald-200">{asText(newText)}</pre>
      </div>
    </div>
  )
}

const shellView = (i) => {
  if (typeof i.command !== 'string' || !i.command) return null
  return (
    <>
      <Prose>{i.description}</Prose>
      <Pre>{i.command}</Pre>
      {i.dangerouslyDisableSandbox ? (
        <div className="mt-1 text-[12px] leading-5">
          <span className="font-semibold text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded">sandbox disabled</span>
        </div>
      ) : null}
      <Field label="timeout">{i.timeout != null ? `${asText(i.timeout)} ms` : null}</Field>
      <Field label="background">{i.run_in_background ? 'yes' : null}</Field>
    </>
  )
}

const agentView = (i) => {
  if (i.subagent_type == null && i.description == null && i.prompt == null) return null
  return (
    <>
      <Field label="agent" mono={false}>{i.subagent_type}</Field>
      <Field label="task" mono={false}>{i.description}</Field>
      {typeof i.prompt === 'string' ? <MdBox>{i.prompt}</MdBox> : <Field label="prompt">{i.prompt}</Field>}
    </>
  )
}

// Per-tool input renderers. Anything not listed (or throwing) falls back to
// the raw JSON block, so unknown/odd shapes lose nothing.
const INPUT_VIEWS = {
  Bash: shellView,
  PowerShell: shellView,
  Read: (i) => {
    if (typeof i.file_path !== 'string' || !i.file_path) return null
    let lines = null
    if (i.offset != null || i.limit != null) {
      const off = i.offset == null ? 1 : Number(i.offset)
      const lim = i.limit == null ? 2000 : Number(i.limit)
      lines =
        Number.isFinite(off) && Number.isFinite(lim)
          ? `${off} – ${off + lim - 1}`
          : [i.offset != null ? `offset ${asText(i.offset)}` : null, i.limit != null ? `limit ${asText(i.limit)}` : null]
              .filter(Boolean)
              .join(', ')
    }
    return (
      <>
        <Field label="file">{i.file_path}</Field>
        <Field label="lines">{lines}</Field>
        <Field label="pages">{i.pages}</Field>
      </>
    )
  },
  Edit: (i) => {
    const hasDiff = typeof i.old_string === 'string' && typeof i.new_string === 'string'
    if (!hasDiff && (typeof i.file_path !== 'string' || !i.file_path)) return null
    return (
      <>
        <Field label="file">{i.file_path}</Field>
        <Field label="mode">{i.replace_all ? 'replace all occurrences' : null}</Field>
        {hasDiff ? <DiffBlock oldText={i.old_string} newText={i.new_string} /> : null}
      </>
    )
  },
  Write: (i) => {
    if (i.file_path == null && i.content == null) return null
    return (
      <>
        <Field label="file">{i.file_path}</Field>
        <Pre>{i.content}</Pre>
      </>
    )
  },
  Grep: (i) => {
    if (i.pattern == null) return null
    return (
      <>
        <Field label="pattern">{i.pattern}</Field>
        <Field label="path">{i.path}</Field>
        <Field label="glob">{i.glob}</Field>
        <Field label="type">{i.type}</Field>
        <Field label="mode">{i.output_mode}</Field>
      </>
    )
  },
  Glob: (i) => {
    if (i.pattern == null) return null
    return (
      <>
        <Field label="pattern">{i.pattern}</Field>
        <Field label="path">{i.path}</Field>
      </>
    )
  },
  Task: agentView,
  Agent: agentView,
  WebFetch: (i) => {
    if (i.url == null && i.prompt == null) return null
    return (
      <>
        <Field label="url">{i.url}</Field>
        <Prose>{i.prompt}</Prose>
      </>
    )
  },
  WebSearch: (i) => (i.query == null ? null : <Field label="query">{i.query}</Field>),
}

// Tools whose output is natural language, best read as Markdown. Everything
// else (file contents, command output, listings) stays monospace.
const MD_OUTPUT = new Set(['Task', 'Agent', 'WebFetch', 'WebSearch'])

function renderInput(name, input) {
  const view = INPUT_VIEWS[name]
  if (!view || !input) return null
  try {
    return view(input)
  } catch {
    return null
  }
}

export default function ToolCall({ part }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const meta = TOOL_META[part.name] || { color: 'text-zinc-300', badge: 'bg-zinc-500/15' }
  const result = part.result
  const err = result?.isError
  const inputStr = JSON.stringify(part.input ?? {}, null, 2)
  // Input shows the raw-JSON block for every tool; Edit is the one exception —
  // its old→new diff is far more readable than JSON (toggle back with `raw`).
  const pretty = !raw && part.name === 'Edit' && renderInput(part.name, part.input)
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
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${meta.badge} ${meta.color}`}>
          {part.server ? '🌐 ' : ''}
          {part.name || 'tool'}
        </span>
        <span className="text-zinc-400 text-[12px] font-mono truncate flex-1">{previewOf(part.name, part.input)}</span>
        {err ? (
          <span className="text-[10px] text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded">error</span>
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
            {/* Everything but Edit always shows JSON — the toggle only exists where a diff view does. */}
            {part.name === 'Edit' && (
              <button
                onClick={() => setRaw(!raw)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-ink-600 text-zinc-400 hover:text-zinc-200"
                title="toggle raw JSON view"
              >
                {raw ? 'pretty' : 'raw'}
              </button>
            )}
          </div>
          {pretty || <Pre>{inputStr}</Pre>}
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
