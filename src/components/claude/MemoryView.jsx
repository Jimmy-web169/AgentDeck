import { useEffect, useState } from 'react'
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

  // default to the first project once projects arrive (or when the root changes)
  useEffect(() => {
    if (projects.some((p) => p.slug === slug)) return
    setSlug(projects[0]?.slug || null)
  }, [projects, slug])

  useEffect(() => {
    if (!root || !slug) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .memory(root, slug)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [root, slug])

  const { index, files } = data || {}
  const empty = data && !index && (!files || files.length === 0)

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
      </div>

      {loading && <div className="text-center text-zinc-600 py-10">Loading memory…</div>}
      {!loading && empty && <div className="text-center text-zinc-600 py-10">This project has no memory yet.</div>}
      {!loading && index && (
        <div className="rounded-lg border border-zinc-800 bg-ink-900/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">MEMORY.md (index)</div>
          <Markdown>{index}</Markdown>
        </div>
      )}
      {!loading &&
        files?.map((f) => (
          <div key={f.name} className="rounded-lg border border-zinc-800 bg-ink-700/40 p-4">
            <div className="text-[12px] font-mono text-amber-200/80 mb-2">{f.name}</div>
            <Markdown>{f.content}</Markdown>
          </div>
        ))}
    </div>
  )
}
