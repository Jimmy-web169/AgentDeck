import { useEffect, useMemo, useState } from 'react'
import useEscToClose from '../../lib/useEscToClose.js'
import { MOD_WORD } from './ShortcutHints.jsx'
import { PROVIDER_LIST } from '../../providers/index.js'

// the provider's docs home and its config kinds (from the registry's docsMap),
// so the brief can list what this CLI can be configured with
const KIND_LABELS = {
  agents: 'sub-agents', agent: 'sub-agents', subagents: 'sub-agents', skills: 'skills', skill: 'skills', commands: 'custom commands / prompts', workflows: 'workflows', rules: 'rules / project memory',
  'output-styles': 'output styles', claudeMd: 'CLAUDE.md instructions', agentsMd: 'AGENTS.md instructions', mcpJson: 'MCP servers', mcp: 'MCP servers', hook: 'hooks', hooks: 'hooks', plugin: 'plugins',
  settingsJson: 'settings', settingsLocalJson: 'local settings', config: 'config file', permissions: 'permissions',
}
export function providerDocs(providerId) {
  const p = PROVIDER_LIST.find((x) => x.id === providerId)
  if (!p) return { docsIndex: null, kinds: [] }
  const seen = new Set()
  const kinds = []
  for (const [k, url] of Object.entries(p.docsMap || {})) {
    const name = KIND_LABELS[k]
    if (!name || seen.has(name)) continue
    seen.add(name)
    kinds.push({ name, docs: /^https?:/.test(url) ? url : `${p.docsBase}${url}` })
  }
  return { docsIndex: p.docsBase || null, kinds }
}

// AI hand-off: AgentDeck never calls a model. You say what you want; AgentDeck
// packs it with what it knows — which file, its current content, the official
// docs page for that kind of setting — into a brief, and opens the provider's
// own terminal seeded with a one-line prompt that points at the brief. The CLI
// reads the docs and does the work in front of you; nothing here edits a file.
//
// `context` describes the thing at hand: { kind, filePath, content, docs }.
// `api` is the provider's client (POST /api/terminal accepts `brief`).

export function composeBriefPreview({ need, providerLabel, kind, filePath, content, docs, cwd, docsIndex = null, kinds = [] }) {
  const lines = [`# AgentDeck hand-off → ${providerLabel}`, '', '## What I want', '', need.trim() || '(write what you want above)', '', '## Where']
  if (kind) lines.push(`- Kind: ${kind}`)
  if (filePath) lines.push(`- File: ${filePath}`)
  if (cwd) lines.push(`- Working folder: ${cwd}`)
  if (docs) lines.push(`- Official docs (read first): ${docs}`)
  if (docsIndex) lines.push(`- Docs index: ${docsIndex}`)
  lines.push('', '## How to work', '', '1. Read the docs first.', '2. Ask, don’t edit: explain each building block that applies and ask whether I want it, one question at a time.', '3. Search the skills ecosystem (find-skills) for what my intent needs and propose matches.', '4. Show the plan, wait for a yes.', '5. Change only what the plan names; show the diff; explain every field.')
  if (kinds.length) lines.push('', `## ${providerLabel}'s building blocks`, '', ...kinds.map((k) => `- ${k.name}`))
  lines.push('', '(the real brief spells these out in full)', '4. If the request is ambiguous, ask first.')
  if (content) lines.push('', `## Current content of ${filePath || 'the file'}`, '', '```', content.length > 2000 ? content.slice(0, 2000) + '\n… (' + (content.length - 2000) + ' more characters in the real brief)' : content, '```')
  return lines.join('\n')
}

export default function HandoffDialog({ api, providerId, providerLabel, root, cwd = null, slug = null, context = {}, placeholder, onClose }) {
  useEscToClose(onClose)
  const [need, setNeed] = useState(context.need || '')
  const [includeContent, setIncludeContent] = useState(true)
  const [showBrief, setShowBrief] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null) // { key, reused, brief }
  const [err, setErr] = useState(null)
  useEffect(() => setNeed(context.need || ''), [context.need])

  const { docsIndex, kinds } = useMemo(() => providerDocs(providerId), [providerId])
  const brief = useMemo(
    () => composeBriefPreview({ need, providerLabel, kind: context.kind, filePath: context.filePath, content: includeContent ? context.content : null, docs: context.docs, cwd, docsIndex, kinds }),
    [need, providerLabel, context, includeContent, cwd, docsIndex, kinds]
  )

  const go = async () => {
    if (!need.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const body = { root, title: `✦ ${need.trim().slice(0, 48)}`, brief: { need: need.trim(), kind: context.kind || null, filePath: context.filePath || null, content: includeContent ? context.content || null : null, docs: context.docs || null, docsIndex, kinds } }
      if (cwd) body.cwd = cwd
      else if (slug) body.slug = slug
      const res = await api.terminal(body)
      setDone(res)
      // the provider app shows the terminal for this target; the shell routes it like the Live panel does
      window.dispatchEvent(new CustomEvent('agentdeck:open-terminal', { detail: { provider: providerId, root, slug: slug || null, cwd: cwd || null, title: body.title, kind: 'tmux', draft: true } }))
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-[640px] max-w-[95vw] max-h-[88vh] bg-ink-800 border border-zinc-700 rounded-xl shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <div className="text-[13px] text-zinc-100 font-medium">Ask {providerLabel} to do it</div>
            <div className="text-[11px] text-zinc-500 truncate">{context.kind ? `${context.kind}${context.filePath ? ` · ${context.filePath}` : ''}` : 'opens the provider’s own terminal with a brief; AgentDeck edits nothing'}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-zinc-500 hover:text-zinc-200 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {!done ? (
            <>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">What do you want?</span>
                <textarea
                  autoFocus
                  value={need}
                  onChange={(e) => setNeed(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && go()}
                  rows={4}
                  placeholder={placeholder || 'Say what you want in your own words — e.g. “set this project up for me”, “format code after every edit”, “let it read our GitHub issues”. The agent asks about the details.'}
                  className="mt-1 w-full bg-ink-900 border border-zinc-700 rounded px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 resize-y"
                />
              </label>
              <div className="text-[11.5px] text-zinc-500 space-y-1">
                <div>The brief {providerLabel} receives:</div>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>your request, verbatim</li>
                  {context.kind && <li>the kind of setting{context.filePath ? ' and its file' : ''}</li>}
                  {context.docs && <li>the <a href={context.docs} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">official docs page ↗</a> for it — read first, by instruction</li>}
                  {context.content != null && (
                    <li>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={includeContent} onChange={(e) => setIncludeContent(e.target.checked)} className="accent-sky-500" />
                        the file’s current content ({String(context.content).length} chars)
                      </label>
                    </li>
                  )}
                  <li>this CLI’s building blocks ({kinds.length}) with their docs, so it can ask you which ones you want</li>
                  <li>how to work: read the docs, interview you first (one question at a time), search find-skills for skills your intent needs, show the plan, then the diff</li>
                </ul>
              </div>
              <button onClick={() => setShowBrief((s) => !s)} className="text-[11px] text-zinc-500 hover:text-zinc-200">{showBrief ? 'hide the brief' : 'preview the brief'}</button>
              {showBrief && <pre className="text-[11px] leading-5 font-mono text-zinc-400 whitespace-pre-wrap break-words bg-ink-900 rounded-lg p-3 max-h-64 overflow-y-auto">{brief}</pre>}
              {err && <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}
            </>
          ) : (
            <div className="space-y-2 text-[13px] text-zinc-300">
              <div>{done.reused ? `A terminal for this folder was already open — it was reused. The brief is at:` : `${providerLabel} is starting in its terminal with the brief.`}</div>
              <div className="font-mono text-[11.5px] text-zinc-400 break-all">{done.brief}</div>
              {done.reused && <div className="text-[12px] text-zinc-500">Paste into that terminal: <span className="font-mono text-zinc-300">read {done.brief} and do what it asks</span></div>}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 shrink-0 flex items-center gap-2">
          <span className="text-[11px] text-zinc-600">{MOD_WORD}+Enter to send</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200">{done ? 'Close' : 'Cancel'}</button>
          {!done && (
            <button onClick={go} disabled={busy || !need.trim()} className="text-[12px] px-3 py-1.5 rounded bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40">
              {busy ? 'starting…' : `Open in ${providerLabel} ▸`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// the small entry button the Config views and Insights show
export function HandoffButton({ onClick, label = 'Ask the agent', title = 'Hand this to the CLI: your request + the file + its official docs, in its own terminal', className = '' }) {
  return (
    <button onClick={onClick} title={title} className={`text-[11.5px] px-2 py-1 rounded bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 inline-flex items-center gap-1 ${className}`}>
      <span aria-hidden>✦</span> {label}
    </button>
  )
}
