import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import SkillImport from './SkillImport.jsx'
import NewResourceForm from './NewResourceForm.jsx'

const DOCS_BASE = 'https://code.claude.com/docs'
const DOCS = {
  agents: '/en/sub-agents',
  skills: '/en/skills',
  commands: '/en/skills',
  workflows: '/en/workflows',
  rules: '/en/memory',
  'output-styles': '/en/output-styles',
  claudeMd: '/en/memory',
  mcpJson: '/en/mcp',
  settingsJson: '/en/settings',
  settingsLocalJson: '/en/settings',
}
// kinds whose "+ new" opens the guided form (workflows stay JS-template only)
const FORM_KINDS = new Set(['agents', 'skills', 'commands', 'rules', 'output-styles'])
// single config files (no list / no delete; edited in place)
const SINGLE_KINDS = ['claudeMd', 'mcpJson', 'settingsJson', 'settingsLocalJson']

// Order kept in sync with the Codex resources view so the categories the two
// providers share (Instructions, Agents, Skills, …, MCP, Settings) line up.
const KINDS = [
  { key: 'agents', label: 'Agents', hint: 'name.md' },
  { key: 'skills', label: 'Skills', hint: 'skill-folder-name' },
  { key: 'commands', label: 'Commands', hint: 'name.md' },
  { key: 'rules', label: 'Rules', hint: 'name.md or sub/name.md' },
  { key: 'output-styles', label: 'Output styles', hint: 'name.md' },
  { key: 'workflows', label: 'Workflows', hint: 'name.js' },
]

const TEMPLATES = {
  agents: '---\nname: my-agent\ndescription: what this agent does\ntools: Read, Grep, Glob\n---\nYou are ...\n',
  commands: '---\ndescription: what this command does\nargument-hint: <arg>\n---\nInstructions. Use $ARGUMENTS for input.\n',
  workflows:
    "export const meta = {\n  name: 'my-workflow',\n  description: 'what it does',\n  phases: [{ title: 'Step' }],\n}\n\nphase('Step')\nconst out = await agent('do something')\nreturn out\n",
  skills: '---\nname: my-skill\ndescription: when to use this skill\n---\n# My Skill\nInstructions.\n',
  rules: '---\npaths:\n  - "src/**/*.ts"\n---\n\n# Rule\n- Convention that loads when a matching file is in context\n',
  'output-styles': '---\ndescription: what this style does\nkeep-coding-instructions: true\n---\nAppended to the system prompt.\n',
  claudeMd: '# Project conventions\n\n## Commands\n- Build: \n- Test: \n\n## Rules\n- \n',
  // Every MCP transport, as a multi-server example so you can see how each looks.
  mcpJson: `{
  "mcpServers": {
    "http-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer \${API_TOKEN}" }
    },
    "sse-server": {
      "type": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": { "X-API-Key": "\${API_KEY}" }
    },
    "stdio-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "SOME_API_KEY": "\${SOME_API_KEY}" }
    },
    "ws-server": {
      "type": "ws",
      "url": "wss://mcp.example.com/socket",
      "headers": { "Authorization": "Bearer \${TOKEN}" }
    }
  }
}
`,
  settingsJson: '{\n  "permissions": {\n    "allow": [],\n    "deny": []\n  }\n}\n',
  settingsLocalJson: '{\n  "permissions": {\n    "allow": []\n  }\n}\n',
}

export default function Resources({ root, slug }) {
  const [inv, setInv] = useState(null)
  const [sel, setSel] = useState(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [creating, setCreating] = useState(null)
  const [newName, setNewName] = useState('')
  const [tpl, setTpl] = useState(false) // current buffer is a starter template
  const [showImport, setShowImport] = useState(false)
  const [formKind, setFormKind] = useState(null) // guided "+ new" form open for this kind

  const reload = async () => {
    setErr(null)
    try {
      setInv(await api.resources(root, slug))
    } catch (e) {
      setErr(e.message)
    }
  }
  useEffect(() => {
    setSel(null)
    setContent('')
    setInv(null)
    reload()
  }, [root, slug])

  const open = async (kind, name, allowMissing = false) => {
    setBusy(true)
    setErr(null)
    setConfirmDel(false)
    try {
      const r = await api.resource(root, kind, name, slug)
      setSel({ kind, name })
      setContent(r.content)
      setDirty(false)
      setTpl(false)
    } catch (e) {
      if (allowMissing) {
        setSel({ kind, name })
        setContent(TEMPLATES[kind] || '')
        setDirty(true)
        setTpl(true)
      } else {
        setErr(e.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!sel) return
    setBusy(true)
    setErr(null)
    try {
      await api.saveResource(root, sel.kind, sel.name, content, slug)
      setDirty(false)
      setTpl(false)
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!sel) return
    setBusy(true)
    setErr(null)
    try {
      await api.deleteResource(root, sel.kind, sel.name, String(Date.now()), slug)
      setSel(null)
      setContent('')
      setConfirmDel(false)
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const kind = creating.kind
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setErr(null)
    try {
      await api.saveResource(root, kind, name, TEMPLATES[kind] || '', slug)
      setCreating(null)
      setNewName('')
      await reload()
      await open(kind, name)
      setTpl(true) // freshly scaffolded from template
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!inv) return <div className="p-8 text-zinc-600">{err ? <span className="text-red-300">{err}</span> : 'Loading resources…'}</div>

  const isProject = inv.scope === 'project'

  // a single config-file row (CLAUDE.md / .mcp.json / settings*.json)
  const fileItem = (s) => (
    <button
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
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">in project</span>
      ) : (
        <span className="text-[9px] px-1.5 py-0.5 rounded border border-dashed border-sky-500/40 text-sky-300 shrink-0">create</span>
      )}
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zinc-800 text-[12px] flex items-center gap-2 shrink-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isProject ? 'bg-sky-500/15 text-sky-300' : 'bg-zinc-500/15 text-zinc-300'}`}>
          {isProject ? 'PROJECT scope' : 'FOLDER (user) scope'}
        </span>
        <span className="text-zinc-500 font-mono truncate">{inv.base}</span>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
          {/* legend so the two states are unmistakable */}
          <div className="px-3 py-1.5 border-b border-zinc-800/60 flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> in project</span>
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
                    title={(inv[key] || []).length ? 'in project' : 'none yet'}
                  >
                    {(inv[key] || []).length}
                  </span>
                  {DOCS[key] && (
                    <a href={DOCS_BASE + DOCS[key]} target="_blank" rel="noreferrer" className="text-zinc-600 hover:text-sky-400 normal-case" title="open Claude Code docs">↗</a>
                  )}
                </span>
                <span className="flex gap-2.5">
                  {key === 'skills' && (
                    <button onClick={() => setShowImport(true)} className="text-[11px] text-sky-300 hover:text-sky-200" title="Import from skills.sh / GitHub">↓ import</button>
                  )}
                  <button
                    onClick={() => {
                      if (FORM_KINDS.has(key)) setFormKind(key)
                      else { setCreating({ kind: key }); setNewName(''); setErr(null) }
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
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder={hint} className="flex-1 bg-ink-700 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 font-mono" />
                    <button onClick={create} disabled={busy} className="text-[11px] px-2 rounded bg-emerald-500/20 text-emerald-200">ok</button>
                    <button onClick={() => { setCreating(null); setErr(null) }} className="text-[11px] px-2 rounded bg-ink-600 text-zinc-400">×</button>
                  </div>
                  {err && <div className="text-[11px] text-red-300 mt-1">{err}</div>}
                </div>
              )}
              {(inv[key] || []).map((it) => (
                <button key={it.name} onClick={() => open(key, it.name)} className={`w-full text-left px-3 py-1.5 hover:bg-ink-700/50 flex items-start gap-2 ${sel?.kind === key && sel?.name === it.name ? 'bg-sky-500/10 border-l-2 border-sky-500' : ''}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" title="in project" />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-zinc-200 truncate font-mono">{it.name}</span>
                    {it.description && <span className="block text-[10.5px] text-zinc-500 truncate">{it.description}</span>}
                  </span>
                </button>
              ))}
              {(inv[key] || []).length === 0 && creating?.kind !== key && <div className="px-3 pb-2 text-[11px] text-zinc-600 italic">none yet — tap + new</div>}
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
            {inv.settings?.model && <div>model: <span className="font-mono text-zinc-400">{inv.settings.model}</span></div>}
            {inv.settings?.hooks?.length > 0 && <div>hooks: {inv.settings.hooks.join(', ')}</div>}
            {inv.plugins && <div>plugins: {inv.plugins.installed}</div>}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {sel ? (
            <>
              <div className="h-11 shrink-0 flex items-center gap-3 px-4 border-b border-zinc-800">
                <span className="text-[13px] font-mono text-zinc-200 truncate">{SINGLE_KINDS.includes(sel.kind) ? sel.name : `${sel.kind}/${sel.name}`}</span>
                {DOCS[sel.kind] && (
                  <a href={DOCS_BASE + DOCS[sel.kind]} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-sky-400" title="open Claude Code docs">docs ↗</a>
                )}
                {dirty && <span className="text-[10px] text-amber-300">● unsaved</span>}
                <div className="flex-1" />
                <button onClick={save} disabled={busy || !dirty} className="text-[12px] px-3 py-1 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40">Save</button>
                {!SINGLE_KINDS.includes(sel.kind) &&
                  (confirmDel ? (
                    <span className="flex items-center gap-1">
                      <span className="text-[11px] text-red-300">delete?</span>
                      <button onClick={del} disabled={busy} className="text-[12px] px-2 py-1 rounded bg-red-500/30 text-red-200">yes</button>
                      <button onClick={() => setConfirmDel(false)} className="text-[12px] px-2 py-1 rounded bg-ink-600 text-zinc-300">no</button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDel(true)} disabled={busy} className="text-[12px] px-3 py-1 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20">Delete</button>
                  ))}
              </div>
              {tpl && (
                <div className="px-4 py-1.5 text-[11px] text-amber-300/90 bg-amber-500/5 border-b border-amber-500/20 shrink-0">
                  ✎ Starter template — edit the fields and <b>Save</b> to write the file.
                </div>
              )}
              <textarea value={content} onChange={(e) => { setContent(e.target.value); setDirty(true) }} spellCheck={false} className="flex-1 w-full bg-ink-900 text-zinc-200 font-mono text-[13px] leading-6 p-4 resize-none outline-none" />
              {err && <div className="px-4 py-2 text-[12px] text-red-300 border-t border-red-500/30">{err}</div>}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-6">
              {isProject ? 'Manage this project’s .claude/ config — agents, skills, commands, workflows, rules, output styles, CLAUDE.md.' : 'Select a resource to view / edit, or “+ new” to create one.'}
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
          onCreated={(k, n) => {
            reload()
            open(k, n)
          }}
        />
      )}
    </div>
  )
}
