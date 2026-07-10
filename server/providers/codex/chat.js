import { WebSocketServer } from 'ws'
import { Codex } from '@openai/codex-sdk'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveRoot, cwdForId, isSessionId } from './paths.js'
import { findOnPath } from '../../shared/terminal.js'

const MAX = 6 // concurrent live chats (single view + a few panes, with headroom)
let active = 0

// The Codex SDK is non-interactive: instead of a per-tool permission callback
// (Claude's canUseTool), Codex governs tool use with a sandbox + approval policy
// chosen up front. We expose three escalating modes.
const MODES = {
  'read-only': { sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false },
  auto: { sandboxMode: 'workspace-write', approvalPolicy: 'never', networkAccessEnabled: false },
  'full-access': { sandboxMode: 'danger-full-access', approvalPolicy: 'never', networkAccessEnabled: true },
}

let codexBin
function findCodex() {
  if (codexBin !== undefined) return codexBin
  // findOnPath tries Windows extensions (.exe/.cmd/.bat) — a plain `codex` never matches on win32
  codexBin = findOnPath(['codex'], [
    path.join(os.homedir(), '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ])
  return codexBin
}

// Normalise a Codex SDK ThreadItem into the compact shape the browser renders.
// Every item carries the SDK id so the client can upsert in_progress→completed.
function normalizeItem(item, done) {
  switch (item.type) {
    case 'agent_message':
      return { id: item.id, kind: 'message', text: item.text || '' }
    case 'reasoning':
      return { id: item.id, kind: 'thinking', text: item.text || '' }
    case 'command_execution':
      return {
        id: item.id,
        kind: 'tool',
        name: 'shell',
        input: { command: item.command },
        status: item.status,
        result: item.aggregated_output || '',
        exitCode: item.exit_code ?? null,
        isError: item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0),
      }
    case 'file_change':
      return {
        id: item.id,
        kind: 'tool',
        name: 'apply_patch',
        input: { changes: item.changes || [] },
        status: item.status,
        isError: item.status === 'failed',
      }
    case 'mcp_tool_call':
      return {
        id: item.id,
        kind: 'tool',
        name: `${item.server}.${item.tool}`,
        input: item.arguments,
        status: item.status,
        result: item.error?.message || (item.result ? JSON.stringify(item.result.structured_content ?? item.result.content) : ''),
        isError: !!item.error || item.status === 'failed',
      }
    case 'web_search':
      // these SDK items carry no status field — derive it from the event phase
      return { id: item.id, kind: 'tool', name: 'web_search', input: { query: item.query }, status: done ? 'completed' : 'in_progress' }
    case 'todo_list':
      return { id: item.id, kind: 'tool', name: 'update_plan', input: { items: item.items || [] }, status: done ? 'completed' : 'in_progress' }
    case 'error':
      return { id: item.id, kind: 'error', text: item.message || 'error' }
    default:
      return null
  }
}

// Drive the real Codex via the official SDK: start or resume a thread, stream
// items to the browser. Each WS is one conversation, kept alive across navigation.
// noServer: index.js routes /chat/<provider> upgrades here (origin checked there)
export function makeChatWss() {
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const send = (o) => {
      try {
        ws.send(JSON.stringify(o))
      } catch {}
    }
    let root, cwd
    let currentId = null // null until a new thread is created on its first turn
    let abort = null
    let streaming = false
    let closed = false
    let counted = false
    let codex = null

    try {
      const url = new URL(req.url, 'http://localhost')
      if (active >= MAX) {
        send({ type: 'error', error: `Too many live chats open (max ${MAX}).` })
        return ws.close()
      }
      root = resolveRoot(url.searchParams.get('root'))
      const isNew = url.searchParams.get('new') === '1'
      if (isNew) {
        const explicitCwd = url.searchParams.get('cwd')
        const slug = url.searchParams.get('slug') // slug is the cwd for codex projects
        cwd = explicitCwd || (slug && path.isAbsolute(slug) ? slug : null)
        if (!cwd) {
          send({ type: 'error', error: 'Cannot start a new conversation — no working directory given.' })
          return ws.close()
        }
        let stat
        try {
          stat = fs.statSync(cwd)
        } catch {}
        if (!stat || !stat.isDirectory()) {
          send({ type: 'error', error: `Not a directory: ${cwd}` })
          return ws.close()
        }
      } else {
        currentId = url.searchParams.get('id')
        if (!isSessionId(currentId)) {
          send({ type: 'error', error: 'invalid session id' })
          return ws.close()
        }
        cwd = cwdForId(root.dir, currentId)
      }
      if (!cwd || !fs.existsSync(cwd)) cwd = root.dir
      const bin = findCodex()
      if (!bin) {
        send({ type: 'error', error: 'codex executable not found — install it with `npm i -g @openai/codex`.' })
        return ws.close()
      }
      // env is passed wholesale (SDK won't inherit process.env when env is set),
      // with CODEX_HOME pinned to this tracked root so the right login/config is used.
      codex = new Codex({ codexPathOverride: bin, env: { ...process.env, CODEX_HOME: root.dir } })
      active++
      counted = true
      send({ type: 'ready', account: root.label, cwd, isNew })
    } catch (e) {
      send({ type: 'error', error: String(e?.message || e) })
      return ws.close()
    }

    async function runTurn(message, mode) {
      if (streaming) return send({ type: 'error', error: 'a turn is already in progress' })
      streaming = true
      abort = new AbortController()
      const opts = { ...(MODES[mode] || MODES['read-only']), workingDirectory: cwd, skipGitRepoCheck: true }
      send({ type: 'turn-start' })
      try {
        const thread = currentId ? codex.resumeThread(currentId, opts) : codex.startThread(opts)
        const { events } = await thread.runStreamed(message, { signal: abort.signal })
        for await (const ev of events) {
          if (closed) break
          if (ev.type === 'thread.started') {
            if (!currentId) {
              currentId = ev.thread_id
              send({ type: 'session-created', sessionId: currentId, slug: cwd })
            }
          } else if (ev.type === 'item.started' || ev.type === 'item.updated' || ev.type === 'item.completed') {
            const item = normalizeItem(ev.item, ev.type === 'item.completed')
            if (item) send({ type: 'item', item })
          } else if (ev.type === 'turn.failed') {
            send({ type: 'error', error: ev.error?.message || 'turn failed' })
          } else if (ev.type === 'error') {
            send({ type: 'error', error: ev.message || 'stream error' })
          }
        }
      } catch (e) {
        if (!closed) send({ type: 'error', error: String(e?.message || e) })
      } finally {
        streaming = false
        abort = null
        send({ type: 'turn-end', sessionId: currentId, slug: cwd })
      }
    }

    ws.on('message', (raw) => {
      let m
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (m.type === 'send' && typeof m.message === 'string' && m.message.trim()) {
        runTurn(m.message, m.permissionMode)
      } else if (m.type === 'abort') {
        try {
          abort?.abort()
        } catch {}
      }
    })

    const cleanup = () => {
      if (closed) return
      closed = true
      try {
        abort?.abort()
      } catch {}
      if (counted) {
        active = Math.max(0, active - 1)
        counted = false
      }
    }
    ws.on('close', cleanup)
    ws.on('error', cleanup)
  })
  return wss
}
