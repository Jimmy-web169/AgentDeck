import { useState } from 'react'
import { api } from '../../api.js'

const MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4-mini']
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh']
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop']
// matcher meaning per hook event (from the Codex hooks docs)
const MATCHER_HINT = {
  PreToolUse: 'tool name — e.g. Bash, apply_patch (or Edit|Write), mcp__server__tool',
  PostToolUse: 'tool name — e.g. Bash, apply_patch (or Edit|Write), mcp__server__tool',
  PermissionRequest: 'tool name — e.g. Bash, apply_patch, mcp__server__tool',
  SessionStart: 'start source — startup|resume|clear|compact',
  PreCompact: 'trigger — manual|auto',
  PostCompact: 'trigger — manual|auto',
  SubagentStart: 'subagent type — e.g. explorer, reviewer',
  SubagentStop: 'subagent type — e.g. explorer, reviewer',
}
const NO_MATCHER = new Set(['UserPromptSubmit', 'Stop'])

const TITLES = { agent: 'New custom agent (subagent)', skill: 'New skill', hook: 'New lifecycle hook', mcp: 'New MCP server', agentsMd: 'Edit AGENTS.md' }

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-[12px] text-zinc-300">{label}</div>
      {hint && <div className="text-[11px] text-zinc-600 mb-1">{hint}</div>}
      {children}
    </label>
  )
}

const inputCls = 'w-full bg-ink-700 border border-zinc-700 rounded px-2.5 py-1.5 text-[13px] text-zinc-100 placeholder-zinc-600'

export default function NewResourceForm({ kind, scope, root, slug, initial, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    transport: 'stdio',
    event: 'PreToolUse',
    content: initial || '',
    ...{},
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = { root, scope, slug, kind }
      if (kind === 'agent') {
        Object.assign(body, {
          name: f.name, description: f.description, model: f.model, sandbox_mode: f.sandbox_mode,
          model_reasoning_effort: f.model_reasoning_effort,
          nickname_candidates: (f.nicknames || '').split(',').map((s) => s.trim()).filter(Boolean),
          developer_instructions: f.developer_instructions,
        })
      } else if (kind === 'skill') {
        Object.assign(body, { name: f.name, description: f.description, body: f.body })
      } else if (kind === 'hook') {
        Object.assign(body, { event: f.event, matcher: NO_MATCHER.has(f.event) ? '' : f.matcher, command: f.command, timeout: f.timeout, statusMessage: f.statusMessage })
      } else if (kind === 'mcp') {
        Object.assign(body, {
          id: f.id, transport: f.transport, command: f.command, url: f.url, bearer_token_env_var: f.bearer_token_env_var,
          args: (f.args || '').split(/\s+/).filter(Boolean),
        })
      } else if (kind === 'agentsMd') {
        Object.assign(body, { content: f.content })
      }
      await api.createResource(body)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-16 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg my-8 rounded-lg border border-zinc-700 bg-ink-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-[13px] font-medium text-zinc-100">{TITLES[kind]}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded ${scope === 'project' ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{scope === 'project' ? 'project scope' : 'user scope'}</span>
        </div>

        <div className="p-4 space-y-3">
          {kind === 'agent' && (
            <>
              <Field label="Name" hint="file name + how Codex refers to this agent (e.g. reviewer)"><input className={inputCls} value={f.name || ''} onChange={set('name')} placeholder="reviewer" /></Field>
              <Field label="Description" hint="when Codex should pick this agent"><input className={inputCls} value={f.description || ''} onChange={set('description')} placeholder="PR reviewer focused on correctness, security, tests" /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Model" hint="optional"><input className={inputCls} list="cxm-models" value={f.model || ''} onChange={set('model')} placeholder="inherit" /><datalist id="cxm-models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist></Field>
                <Field label="Sandbox" hint="optional"><select className={inputCls} value={f.sandbox_mode || ''} onChange={set('sandbox_mode')}><option value="">inherit</option>{SANDBOXES.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
                <Field label="Reasoning" hint="optional"><select className={inputCls} value={f.model_reasoning_effort || ''} onChange={set('model_reasoning_effort')}><option value="">inherit</option>{EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
              </div>
              <Field label="Nicknames" hint="optional, comma-separated display names"><input className={inputCls} value={f.nicknames || ''} onChange={set('nicknames')} placeholder="Atlas, Delta, Echo" /></Field>
              <Field label="Developer instructions" hint="the agent's core behavior (required)"><textarea className={`${inputCls} h-28 resize-y`} value={f.developer_instructions || ''} onChange={set('developer_instructions')} placeholder="Review code like an owner. Prioritize correctness, security, and missing tests." /></Field>
            </>
          )}

          {kind === 'skill' && (
            <>
              <Field label="Name" hint="folder name (e.g. release-notes)"><input className={inputCls} value={f.name || ''} onChange={set('name')} placeholder="release-notes" /></Field>
              <Field label="Description" hint="explain exactly when this skill should trigger"><input className={inputCls} value={f.description || ''} onChange={set('description')} placeholder="Use when drafting release notes from merged PRs." /></Field>
              <Field label="Instructions (SKILL.md body)" hint="markdown steps Codex follows when the skill is used"><textarea className={`${inputCls} h-40 resize-y`} value={f.body || ''} onChange={set('body')} placeholder={'# Release notes\n\nSummarize merged PRs since the last tag…'} /></Field>
            </>
          )}

          {kind === 'hook' && (
            <>
              <Field label="Event" hint="point in the agent loop to run your command"><select className={inputCls} value={f.event} onChange={set('event')}>{HOOK_EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}</select></Field>
              {!NO_MATCHER.has(f.event) && <Field label="Matcher" hint={MATCHER_HINT[f.event] || 'optional regex — blank matches all'}><input className={inputCls} value={f.matcher || ''} onChange={set('matcher')} placeholder="Bash" /></Field>}
              <Field label="Command" hint="shell command Codex runs; receives a JSON event on stdin (required)"><input className={inputCls} value={f.command || ''} onChange={set('command')} placeholder='python3 "$(git rev-parse --show-toplevel)/.codex/hooks/check.py"' /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Timeout (s)" hint="optional, default 600"><input className={inputCls} type="number" value={f.timeout || ''} onChange={set('timeout')} placeholder="30" /></Field>
                <Field label="Status message" hint="optional, shown while running"><input className={inputCls} value={f.statusMessage || ''} onChange={set('statusMessage')} placeholder="Checking command" /></Field>
              </div>
            </>
          )}

          {kind === 'mcp' && (
            <>
              <Field label="Server id" hint="short name (e.g. context7)"><input className={inputCls} value={f.id || ''} onChange={set('id')} placeholder="context7" /></Field>
              <Field label="Transport"><select className={inputCls} value={f.transport} onChange={set('transport')}><option value="stdio">stdio (local command)</option><option value="http">streamable HTTP (url)</option></select></Field>
              {f.transport === 'http' ? (
                <>
                  <Field label="URL" hint="server endpoint (required)"><input className={inputCls} value={f.url || ''} onChange={set('url')} placeholder="https://mcp.example.com/mcp" /></Field>
                  <Field label="Bearer token env var" hint="optional — env var holding the token"><input className={inputCls} value={f.bearer_token_env_var || ''} onChange={set('bearer_token_env_var')} placeholder="EXAMPLE_TOKEN" /></Field>
                </>
              ) : (
                <>
                  <Field label="Command" hint="launcher command (required)"><input className={inputCls} value={f.command || ''} onChange={set('command')} placeholder="npx" /></Field>
                  <Field label="Args" hint="space-separated arguments"><input className={inputCls} value={f.args || ''} onChange={set('args')} placeholder="-y @upstash/context7-mcp" /></Field>
                </>
              )}
            </>
          )}

          {kind === 'agentsMd' && (
            <Field label="AGENTS.md" hint="project/user instructions Codex reads before working (markdown)"><textarea className={`${inputCls} h-64 resize-y font-mono`} value={f.content} onChange={set('content')} placeholder={'# Project guidelines\n\n- Always run tests after editing.\n'} /></Field>
          )}

          {error && <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded bg-ink-700 text-zinc-300 hover:text-zinc-100">Cancel</button>
          <button onClick={submit} disabled={busy} className="text-[12px] px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
