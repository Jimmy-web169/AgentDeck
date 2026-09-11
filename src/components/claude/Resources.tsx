import type { ClaudeResources, ResourceScopeProps } from '../../api/models.ts'
import { errorMessage } from '../../lib/errors.ts'
import { DOCS_BASE, DOCS, FORM_KINDS, SINGLE_KINDS, KINDS, TEMPLATES } from './resourceDefinitions.ts'
import { useEffect, useRef, useState } from 'react'
import { claudeApi as api, useResources, useResourceLoader, useSaveResource, useDeleteResource } from '../../api/index.ts'
import HandoffDialog, { HandoffButton } from '../shared/HandoffDialog.tsx'
import SkillImport from './SkillImport.tsx'
import NewResourceForm from './NewResourceForm.tsx'

export default function Resources({ root, slug }: ResourceScopeProps) {
  const inventory = useResources<ClaudeResources>({ provider: 'claude', root: root || '', slug })
  const inv = inventory.data
  const loadResource = useResourceLoader('claude')
  const saveResource = useSaveResource('claude'),
    deleteResource = useDeleteResource('claude')
  const requestSeq = useRef(0)
  const [sel, setSel] = useState<{ kind: string; name: string } | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setErr] = useState<string | null>(null)
  const err = actionError || inventory.error?.message
  const [confirmDel, setConfirmDel] = useState(false)
  const [creating, setCreating] = useState<{ kind: string } | null>(null)
  const [newName, setNewName] = useState('')
  const [tpl, setTpl] = useState(false) // current buffer is a starter template
  const [showImport, setShowImport] = useState(false)
  const [formKind, setFormKind] = useState<string | null>(null) // guided "+ new" form open for this kind
  const [handoff, setHandoff] = useState(false) // AI hand-off dialog for the current selection

  const reload = () => inventory.refetch()
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the account/project invalidates its outstanding editor request and draft.
  useEffect(() => {
    requestSeq.current++
    setSel(null)
    setContent('')
    setDirty(false)
    setErr(null)
    setBusy(false)
    return () => {
      requestSeq.current++
    }
  }, [root, slug])

  const open = async (kind: string, name: string, allowMissing = false) => {
    const request = ++requestSeq.current
    setBusy(true)
    setErr(null)
    setConfirmDel(false)
    try {
      const r = await loadResource({ root, kind, name, slug })
      if (request !== requestSeq.current) return
      setSel({ kind, name })
      setContent(r.content)
      setDirty(false)
      setTpl(false)
    } catch (e) {
      if (request !== requestSeq.current) return
      if (allowMissing && e && typeof e === 'object' && 'status' in e && e.status === 404) {
        setSel({ kind, name })
        setContent(TEMPLATES[kind] || '')
        setDirty(true)
        setTpl(true)
      } else {
        setErr(errorMessage(e))
      }
    } finally {
      if (request === requestSeq.current) setBusy(false)
    }
  }

  const save = async () => {
    if (!sel) return
    setBusy(true)
    setErr(null)
    try {
      await saveResource.mutateAsync({ ref: { root, kind: sel.kind, name: sel.name, content, slug } })
      setDirty(false)
      setTpl(false)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!sel) return
    setBusy(true)
    setErr(null)
    try {
      await deleteResource.mutateAsync({ ref: { root, kind: sel.kind, name: sel.name, stamp: String(Date.now()), slug } })
      setSel(null)
      setContent('')
      setConfirmDel(false)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!creating) return
    const kind = creating.kind
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setErr(null)
    try {
      await saveResource.mutateAsync({ ref: { root, kind, name, content: TEMPLATES[kind] || '', slug } })
      setCreating(null)
      setNewName('')
      await open(kind, name)
      setTpl(true) // freshly scaffolded from template
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!inv) return <div className="p-8 text-zinc-600">{err ? <span className="text-red-300">{err}</span> : 'Loading resources…'}</div>

  const isProject = inv.scope === 'project'

  // a single config-file row (CLAUDE.md / .mcp.json / settings*.json)
  const fileItem = (s: { kind: string; name: string; exists: boolean; show?: boolean }) => (
    <button
      type="button"
      key={s.kind}
      onClick={() => open(s.kind, s.name, true)}
      className={`w-full text-left px-3 py-1.5 hover:bg-ink-700/50 flex items-center gap-2 ${sel?.kind === s.kind ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
    >
      {s.exists ? (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
      ) : (
        <span className="text-sky-300 text-[12px] leading-none shrink-0 w-1.5 text-center">+</span>
      )}
      <span className={`text-[12.5px] font-mono flex-1 truncate ${s.exists ? 'text-zinc-200' : 'text-zinc-500'}`}>{s.name}</span>
      {s.exists ? (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">{isProject ? 'in project' : 'in source'}</span>
      ) : (
        <span className="text-[9px] px-1.5 py-0.5 rounded border border-dashed border-sky-500/40 text-sky-300 shrink-0">create</span>
      )}
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zinc-800 text-[12px] flex items-center gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isProject ? 'bg-sky-500/15 text-sky-300' : 'bg-zinc-500/15 text-zinc-300'}`}>
          {isProject ? 'PROJECT scope' : 'USER scope'}
        </span>
        <span className="text-zinc-500 font-mono truncate">{inv.base}</span>
        <span className="flex-1" />
        <HandoffButton onClick={() => setHandoff(true)} label="Ask Claude Code" />
      </div>
      {handoff && (
        <HandoffDialog
          api={api}
          providerId="claude"
          providerLabel="Claude Code"
          root={root}
          cwd={isProject ? inv.base : null}
          context={
            sel
              ? {
                  kind: SINGLE_KINDS.some((kind) => kind === sel.kind) ? sel.name : `${sel.kind} "${sel.name}"`,
                  filePath: `${inv.base}/${SINGLE_KINDS.some((kind) => kind === sel.kind) ? sel.name : `${sel.kind}/${sel.name}`}`,
                  content: content || '',
                  docs: DOCS_BASE + (DOCS[sel.kind] || '/en/settings'),
                }
              : {
                  kind: `${isProject ? 'project' : 'folder'}-scope Claude Code configuration`,
                  filePath: inv.base,
                  content: null,
                  docs: DOCS_BASE + '/en/settings',
                }
          }
          onClose={() => setHandoff(false)}
        />
      )}

      <div className="flex flex-1 min-h-0">
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
          {/* legend so the two states are unmistakable */}
          <div className="px-3 py-1.5 border-b border-zinc-800/60 flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {isProject ? 'in project' : 'in source'}
            </span>
            <span className="flex items-center gap-1 text-sky-300">+ tap to create / add</span>
          </div>

          {/* instructions — the project/user memory file */}
          <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-zinc-500">Instructions</div>
          {fileItem({ kind: 'claudeMd', name: 'CLAUDE.md', show: true, exists: inv.claudeMd })}
          <div className="border-b border-zinc-800/60" />

          {KINDS.map(({ key, label, hint }) => (
            <div key={key} className="border-b border-zinc-800/60">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
                  {label}
                  <span
                    className={`text-[10px] normal-case px-1 rounded ${(inv[key] || []).length ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-600'}`}
                    title={(inv[key] || []).length ? (isProject ? 'in project' : 'in source') : 'none yet'}
                  >
                    {(inv[key] || []).length}
                  </span>
                  {DOCS[key] && (
                    <a
                      href={DOCS_BASE + DOCS[key]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-600 hover:text-sky-400 normal-case"
                      title="open Claude Code docs"
                    >
                      ↗
                    </a>
                  )}
                </span>
                <span className="flex gap-2.5">
                  {key === 'skills' && (
                    <button
                      type="button"
                      onClick={() => setShowImport(true)}
                      className="text-[11px] text-sky-300 hover:text-sky-200"
                      title="Import from skills.sh / GitHub"
                    >
                      ↓ import
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (FORM_KINDS.has(key)) setFormKind(key)
                      else {
                        setCreating({ kind: key })
                        setNewName('')
                        setErr(null)
                      }
                    }}
                    className="text-[11px] text-emerald-300 hover:text-emerald-200"
                    title="create a new one"
                  >
                    + new
                  </button>
                </span>
              </div>
              {creating?.kind === key && (
                <div className="px-3 pb-2">
                  <div className="flex gap-1">
                    <input
                      // biome-ignore lint/a11y/noAutofocus: Initial focus follows an explicit create, edit or handoff action.
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && create()}
                      placeholder={hint}
                      className="flex-1 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 font-mono"
                    />
                    <button type="button" onClick={create} disabled={busy} className="text-[11px] px-2 rounded bg-emerald-500/20 text-emerald-200">
                      ok
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(null)
                        setErr(null)
                      }}
                      className="text-[11px] px-2 rounded bg-ink-600 text-zinc-400"
                    >
                      ×
                    </button>
                  </div>
                  {err && <div className="text-[11px] text-red-300 mt-1">{err}</div>}
                </div>
              )}
              {(inv[key] || []).map((it) => (
                <button
                  type="button"
                  key={it.name}
                  onClick={() => open(key, it.name)}
                  className={`w-full text-left px-3 py-1.5 hover:bg-ink-700/50 flex items-start gap-2 ${sel?.kind === key && sel?.name === it.name ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" title={isProject ? 'in project' : 'in source'} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-zinc-200 truncate font-mono">{it.name}</span>
                    {it.description && <span className="block text-[10.5px] text-zinc-500 truncate">{it.description}</span>}
                  </span>
                </button>
              ))}
              {(inv[key] || []).length === 0 && creating?.kind !== key && (
                <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — tap + new</div>
              )}
            </div>
          ))}

          {/* mcp + settings config files — kept last, to match the Codex view */}
          <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-zinc-500">MCP &amp; settings</div>
          {[
            { kind: 'mcpJson', name: '.mcp.json', show: isProject, exists: inv.mcpJson },
            { kind: 'settingsJson', name: 'settings.json', show: true, exists: inv.settingsJson },
            { kind: 'settingsLocalJson', name: 'settings.local.json', show: isProject, exists: inv.settingsLocalJson },
          ]
            .filter((s) => s.show)
            .map(fileItem)}
          <div className="border-b border-zinc-800/60" />

          <div className="px-3 py-3 text-[11px] text-zinc-500 space-y-1">
            <div className="uppercase tracking-wide text-zinc-600">settings summary</div>
            <div>settings.json: {inv.settings ? `${inv.settings.keys.length} keys` : '—'}</div>
            {inv.settings?.model && (
              <div>
                model: <span className="font-mono text-zinc-400">{inv.settings.model}</span>
              </div>
            )}
            {(inv.settings?.hooks?.length || 0) > 0 && <div>hooks: {inv.settings?.hooks.join(', ')}</div>}
            {inv.plugins && <div>plugins: {inv.plugins.installed}</div>}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {sel ? (
            <>
              <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800">
                <span className="text-[13px] font-mono text-zinc-200 truncate">
                  {SINGLE_KINDS.some((kind) => kind === sel.kind) ? sel.name : `${sel.kind}/${sel.name}`}
                </span>
                {DOCS[sel.kind] && (
                  <a
                    href={DOCS_BASE + DOCS[sel.kind]}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-zinc-500 hover:text-sky-400"
                    title="open Claude Code docs"
                  >
                    docs ↗
                  </a>
                )}
                {dirty && <span className="text-[10px] text-amber-300">● unsaved</span>}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !dirty}
                  className="text-[12px] px-3 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  Save
                </button>
                {!SINGLE_KINDS.some((kind) => kind === sel.kind) &&
                  (confirmDel ? (
                    <span className="flex items-center gap-1">
                      <span className="text-[11px] text-red-300">delete?</span>
                      <button type="button" onClick={del} disabled={busy} className="text-[12px] px-2 py-1 rounded bg-red-500/30 text-red-200">
                        yes
                      </button>
                      <button type="button" onClick={() => setConfirmDel(false)} className="text-[12px] px-2 py-1 rounded bg-ink-600 text-zinc-300">
                        no
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDel(true)}
                      disabled={busy}
                      className="text-[12px] px-3 py-1 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  ))}
              </div>
              {tpl && (
                <div className="px-4 py-1.5 text-[11px] text-amber-300/90 bg-amber-500/5 border-b border-amber-500/20 shrink-0">
                  ✎ Starter template — edit the fields and <b>Save</b> to write the file.
                </div>
              )}
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setDirty(true)
                }}
                spellCheck={false}
                className="flex-1 w-full bg-ink-900 text-zinc-200 font-mono text-[13px] leading-6 p-4 resize-none outline-none"
              />
              {err && <div className="px-4 py-2 text-[12px] text-red-300 border-t border-red-500/30">{err}</div>}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-6">
              {isProject
                ? 'Manage this project’s .claude/ config — agents, skills, commands, workflows, rules, output styles, CLAUDE.md.'
                : 'Select a resource to view / edit, or “+ new” to create one.'}
            </div>
          )}
        </div>
      </div>
      {showImport && <SkillImport root={root} slug={slug} onClose={() => setShowImport(false)} onImported={reload} />}
      {formKind && (
        <NewResourceForm
          kind={formKind}
          root={root}
          slug={slug}
          onClose={() => setFormKind(null)}
          onCreated={(k: string, n: string) => {
            reload()
            open(k, n)
          }}
        />
      )}
    </div>
  )
}
