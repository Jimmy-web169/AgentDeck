import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api.js'
import Markdown from '../shared/Markdown.jsx'

// last two path segments of a cwd/slug, for the project picker labels
function shortPath(cwd, slug) {
  const p = cwd || slug || ''
  const parts = p.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || p || '(unknown)'
}

// Claude stores memory PER PROJECT (projects/<slug>/memory/*.md). This view is
// surfaced at folder(user) scope to match Codex's Memory view, so it lets you
// pick a project and browse that project's memory. The underlying per-project
// data model and `api.memory(root, slug)` call are unchanged — only the entry
// point moved here from the session tab bar.
export default function MemoryView({ root, projects = [] }) {
  const [slug, setSlug] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null) // file name in edit mode
  const [draft, setDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState(null) // file name pending delete confirmation
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // default to the first project once projects arrive (or when the root changes)
  useEffect(() => {
    if (projects.some((p) => p.slug === slug)) return
    setSlug(projects[0]?.slug || null)
  }, [projects, slug])

  const load = useCallback(() => {
    if (!root || !slug) {
      setData(null)
      return
    }
    setLoading(true)
    api
      .memory(root, slug)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [root, slug])

  useEffect(() => {
    setEditing(null)
    setConfirmDel(null)
    setCreating(false)
    setNewName('')
    setErr(null)
    load()
  }, [load])

  const save = async () => {
    if (editing == null) return
    setBusy(true)
    setErr(null)
    try {
      await api.saveMemory(root, slug, editing, draft)
      setEditing(null)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const del = async (name) => {
    setBusy(true)
    setErr(null)
    try {
      await api.deleteMemory(root, slug, name)
      setConfirmDel(null)
      if (editing === name) setEditing(null)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    const fname = name.endsWith('.md') ? name : `${name}.md`
    // the write endpoint overwrites by design (that's how edit saves) — guard
    // here so "+ new" can't silently blank an existing memory file
    const exists = (fname === 'MEMORY.md' && data?.index != null) || data?.files?.some((f) => f.name === fname)
    if (exists) {
      setErr(`${fname} already exists — edit it instead`)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await api.saveMemory(root, slug, fname, '')
      setCreating(false)
      setNewName('')
      setEditing(fname)
      setDraft('')
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // shared header actions for a memory card (the MEMORY.md index card included)
  const actions = (name, content) =>
    editing === name ? (
      <>
        <button onClick={save} disabled={busy} className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">Save</button>
        <button onClick={() => setEditing(null)} className="text-[11px] px-2 py-0.5 rounded bg-ink-600 text-zinc-300">Cancel</button>
      </>
    ) : confirmDel === name ? (
      <>
        <span className="text-[11px] text-red-300">trash?</span>
        <button onClick={() => del(name)} disabled={busy} className="text-[11px] px-2 py-0.5 rounded bg-red-500/30 text-red-200">yes</button>
        <button onClick={() => setConfirmDel(null)} className="text-[11px] px-2 py-0.5 rounded bg-ink-600 text-zinc-300">no</button>
      </>
    ) : (
      <>
        <button onClick={() => { setEditing(name); setDraft(content); setConfirmDel(null) }} className="text-[11px] px-2 py-0.5 rounded bg-ink-700 text-zinc-400 hover:text-zinc-200">Edit</button>
        <button onClick={() => setConfirmDel(name)} title="Move to the OS trash (recoverable)" className="text-[11px] px-2 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20">Delete</button>
      </>
    )

  const editor = (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      spellCheck={false}
      className="w-full h-64 bg-ink-900 text-zinc-200 font-mono text-[13px] leading-6 p-3 rounded border border-zinc-700 resize-y outline-none"
    />
  )

  const { index, files } = data || {}
  // index == null (not falsy): an existing-but-empty MEMORY.md still renders its card
  const empty = data && index == null && (!files || files.length === 0)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
      {/* project picker — memory is stored per project */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500 shrink-0">Project</span>
        <select
          value={slug || ''}
          onChange={(e) => setSlug(e.target.value)}
          className="flex-1 min-w-0 bg-ink-700 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-300"
        >
          {projects.length === 0 && <option value="">no projects</option>}
          {projects.map((p) => (
            <option key={p.slug} value={p.slug} title={p.cwd || p.slug}>
              {shortPath(p.cwd, p.slug)}
            </option>
          ))}
        </select>
        {slug &&
          (creating ? (
            <span className="flex items-center gap-1 shrink-0">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                placeholder="file-name.md"
                autoFocus
                className="w-40 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 placeholder-zinc-600"
              />
              <button onClick={create} disabled={busy || !newName.trim()} className="text-[11px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">Create</button>
              <button onClick={() => { setCreating(false); setNewName('') }} className="text-[11px] px-2 py-1 rounded bg-ink-600 text-zinc-300">×</button>
            </span>
          ) : (
            <button onClick={() => setCreating(true)} className="shrink-0 text-[12px] px-2 py-1 rounded bg-ink-700 text-emerald-300/80 hover:text-emerald-200 border border-zinc-700">+ new</button>
          ))}
      </div>

      {err && <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}

      {loading && <div className="text-center text-zinc-600 py-10">Loading memory…</div>}
      {!loading && empty && <div className="text-center text-zinc-600 py-10">This project has no memory yet.</div>}
      {!loading && index != null && (
        <div className="rounded-lg border border-zinc-800 bg-ink-900/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex-1">MEMORY.md (index)</div>
            {actions('MEMORY.md', index)}
          </div>
          {editing === 'MEMORY.md' ? editor : <Markdown>{index}</Markdown>}
        </div>
      )}
      {!loading &&
        files?.map((f) => (
          <div key={f.name} className="rounded-lg border border-zinc-800 bg-ink-700/40 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[12px] font-mono text-amber-200/80 flex-1 truncate">{f.name}</div>
              {actions(f.name, f.content)}
            </div>
            {editing === f.name ? editor : <Markdown>{f.content}</Markdown>}
          </div>
        ))}
    </div>
  )
}
