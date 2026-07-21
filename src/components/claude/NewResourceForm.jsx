import { useState } from 'react'
import { claudeApi as api } from '../../api.js'
import useEscToClose from '../../lib/useEscToClose.js'

// Creation-only scaffolding. Fields come straight from the Claude Code docs.
// After create we hand off to the main textarea editor (no form<->frontmatter
// round-trip — the file is authoritative once created).
const SCHEMA = {
  agents: {
    title: 'New agent',
    idLabel: 'file name',
    idPlaceholder: 'code-reviewer.md',
    ext: '.md',
    fields: [
      { k: 'name', label: 'name', required: true, placeholder: 'code-reviewer' },
      { k: 'description', label: 'description — when Claude should delegate to it', area: true, required: true, placeholder: 'Reviews code for security and correctness' },
      { k: 'tools', label: 'tools (comma-separated, optional)', placeholder: 'Read, Grep, Glob' },
      { k: 'model', label: 'model (optional)', placeholder: 'sonnet · opus · haiku' },
    ],
    body: 'You are a ...\n\nReview for:\n1. ...\n',
    fm: (v, id) => ({ name: v.name || id.replace(/\.md$/, ''), description: v.description, tools: v.tools, model: v.model }),
  },
  skills: {
    title: 'New skill',
    idLabel: 'skill folder name (→ /name)',
    idPlaceholder: 'my-skill',
    isDir: true,
    fields: [{ k: 'description', label: 'description — when to use this skill', area: true, required: true }],
    body: '# My Skill\n\nInstructions. Use $ARGUMENTS for input; reference bundled files by name.\n',
    fm: (v, id) => ({ name: id, description: v.description }),
  },
  commands: {
    title: 'New command',
    idLabel: 'file name (→ /name)',
    idPlaceholder: 'fix-issue.md',
    ext: '.md',
    fields: [
      { k: 'description', label: 'description', area: true, required: true },
      { k: 'argument-hint', label: 'argument-hint (optional)', placeholder: '<issue-number>' },
    ],
    body: 'Instructions. Use $ARGUMENTS for input.\n',
    fm: (v) => ({ description: v.description, 'argument-hint': v['argument-hint'] }),
  },
  rules: {
    title: 'New rule',
    idLabel: 'file name',
    idPlaceholder: 'testing.md  (or  frontend/react.md)',
    ext: '.md',
    fields: [{ k: 'paths', label: 'paths globs — one per line (leave empty = always load)', area: true, placeholder: '**/*.test.ts' }],
    body: '# Rules\n\n- convention here\n',
    fm: (v) => {
      const list = (v.paths || '').split('\n').map((s) => s.trim()).filter(Boolean)
      return list.length ? { paths: list } : null
    },
  },
  'output-styles': {
    title: 'New output style',
    idLabel: 'file name',
    idPlaceholder: 'teaching.md',
    ext: '.md',
    fields: [
      { k: 'description', label: 'description', area: true, required: true },
      { k: 'keep-coding-instructions', label: 'keep the default coding instructions', type: 'checkbox' },
    ],
    body: 'Appended to the system prompt — describe how Claude should respond.\n',
    fm: (v) => ({ description: v.description, 'keep-coding-instructions': v['keep-coding-instructions'] || undefined }),
  },
}

const q = (s) => JSON.stringify(String(s)) // valid double-quoted YAML scalar
const needsQuote = (s) => /[:#"'\n]|^\s|\s$/.test(String(s))
function toYaml(obj) {
  const lines = []
  for (const [k, val] of Object.entries(obj)) {
    if (val == null || val === '') continue
    if (Array.isArray(val)) {
      lines.push(`${k}:`)
      val.forEach((x) => lines.push(`  - ${q(x)}`))
    } else if (typeof val === 'boolean') {
      lines.push(`${k}: ${val}`)
    } else {
      lines.push(`${k}: ${needsQuote(val) ? q(val) : val}`)
    }
  }
  return lines.join('\n')
}

export default function NewResourceForm({ kind, root, slug, onClose, onCreated }) {
  useEscToClose(onClose)
  const schema = SCHEMA[kind]
  const [id, setId] = useState('')
  const [vals, setVals] = useState({})
  const [body, setBody] = useState(schema.body)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k, v) => setVals((p) => ({ ...p, [k]: v }))

  const create = async () => {
    const ident = id.trim()
    if (!ident) return setErr('name is required')
    for (const f of schema.fields) if (f.required && !(vals[f.k] || '').trim()) return setErr(`${f.label} is required`)
    setBusy(true)
    setErr(null)
    try {
      const name = schema.isDir ? ident : ident.endsWith(schema.ext) ? ident : ident + schema.ext
      const fmObj = schema.fm(vals, ident)
      const cleaned = fmObj && Object.fromEntries(Object.entries(fmObj).filter(([, v]) => v != null && v !== ''))
      const front = cleaned && Object.keys(cleaned).length ? `---\n${toYaml(cleaned)}\n---\n\n` : ''
      await api.saveResource(root, kind, name, front + body, slug)
      onCreated(kind, name)
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="w-[600px] max-w-[95vw] max-h-[88vh] bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="text-[14px] text-zinc-100 font-medium">{schema.title}</div>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200 text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <Field label={schema.idLabel} required>
            <input autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder={schema.idPlaceholder} className="w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 font-mono placeholder-zinc-600" />
          </Field>
          {schema.fields.map((f) => (
            <Field key={f.k} label={f.label} required={f.required}>
              {f.type === 'checkbox' ? (
                <label className="flex items-center gap-2 text-[13px] text-zinc-300">
                  <input type="checkbox" checked={!!vals[f.k]} onChange={(e) => set(f.k, e.target.checked)} /> enable
                </label>
              ) : f.area ? (
                <textarea value={vals[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} placeholder={f.placeholder} rows={2} className="w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-600 resize-y" />
              ) : (
                <input value={vals[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} placeholder={f.placeholder} className="w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 font-mono placeholder-zinc-600" />
              )}
            </Field>
          ))}
          <Field label="body (editable now, and after create)">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="w-full bg-ink-900 border border-zinc-700 rounded px-2.5 py-1.5 text-[12.5px] text-zinc-200 font-mono resize-y" />
          </Field>
          {err && <div className="text-[12px] text-red-300">{err}</div>}
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="text-[13px] px-3 py-1.5 rounded bg-ink-600 text-zinc-300">Cancel</button>
          <button onClick={create} disabled={busy} className="text-[13px] px-4 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">
            {busy ? '…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </div>
      {children}
    </div>
  )
}
