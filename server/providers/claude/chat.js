import { WebSocketServer } from 'ws'
import { query } from '@anthropic-ai/claude-agent-sdk'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { resolveRoot, sessionFiles } from './paths.js'
import { findOnPath } from '../../shared/terminal.js'

const MAX = 6 // concurrent live chats (single view + up to 3 multi-session panes, with headroom)
let active = 0

// plan = no execution (safe default) · default = ask each tool via canUseTool ·
// acceptEdits = auto-apply edits · bypass = skip all checks (dangerous)
const PERM_MODES = { plan: 'plan', acceptEdits: 'acceptEdits', default: 'default', bypass: 'bypassPermissions' }

let claudeBin
function findClaude() {
  if (claudeBin !== undefined) return claudeBin
  // findOnPath tries Windows extensions (.exe/.cmd/.bat) — a plain `claude` never matches on win32
  claudeBin = findOnPath(['claude'], [
    path.join(os.homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ])
  return claudeBin
}

// find which project slug a (newly created) session id landed under
function findSlugForId(rootDir, id) {
  if (!id) return null
  const projects = path.join(rootDir, 'projects')
  try {
    for (const slug of fs.readdirSync(projects)) {
      if (fs.existsSync(path.join(projects, slug, `${id}.jsonl`))) return slug
    }
  } catch {}
  return null
}

function readCwd(file) {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(65536)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r && typeof r.cwd === 'string') return r.cwd
      } catch {}
    }
  } catch {}
  return null
}

// Drive the real Claude via the Agent SDK (Claudian-style): resume the session,
// stream events to the browser, and round-trip tool permissions over the WS.
// noServer: index.js routes /chat/<provider> upgrades here (origin checked there)
export function makeChatWss() {
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => {
    const send = (o) => {
      try {
        ws.send(JSON.stringify(o))
      } catch {}
    }
    let root, slug, id, cwd, claude
    let currentId // null until a new session is created on its first turn
    let abort = null
    let streaming = false
    let closed = false
    let counted = false
    const pending = new Map() // reqId -> { resolve, input, toolName }
    const alwaysAllow = new Set() // tools the user chose "allow all this session" for
    let reqSeq = 0

    try {
      const url = new URL(req.url, 'http://localhost')
      if (active >= MAX) {
        send({ type: 'error', error: `Too many live chats open (max ${MAX}).` })
        return ws.close()
      }
      root = resolveRoot(url.searchParams.get('root'))
      slug = url.searchParams.get('slug')
      const isNew = url.searchParams.get('new') === '1'
      if (isNew) {
        // start a brand-new conversation: no resume. cwd from an explicit path
        // (new project anywhere) or, failing that, a sibling session in the slug.
        id = null
        const explicitCwd = url.searchParams.get('cwd')
        if (explicitCwd) {
          let stat
          try {
            stat = fs.statSync(explicitCwd)
          } catch {}
          if (!stat || !stat.isDirectory()) {
            send({ type: 'error', error: `Not a directory: ${explicitCwd}` })
            return ws.close()
          }
          cwd = explicitCwd
        } else {
          const sibs = slug ? sessionFiles(root.dir, slug) : []
          if (!sibs.length) {
            send({ type: 'error', error: 'Cannot start a new conversation here — no existing session in this project to determine the working directory.' })
            return ws.close()
          }
          cwd = readCwd(sibs[0].file)
        }
      } else {
        id = url.searchParams.get('id')
        const f = slug && id && sessionFiles(root.dir, slug).find((x) => x.id === id)
        if (!f) {
          send({ type: 'error', error: 'session not found' })
          return ws.close()
        }
        cwd = readCwd(f.file)
      }
      currentId = id
      if (!cwd || !fs.existsSync(cwd)) cwd = root.dir
      claude = findClaude()
      if (!claude) {
        send({ type: 'error', error: 'claude executable not found' })
        return ws.close()
      }
      active++
      counted = true
      send({ type: 'ready', account: root.label, cwd, isNew })
    } catch (e) {
      send({ type: 'error', error: String(e?.message || e) })
      return ws.close()
    }

    const canUseTool = (toolName, input) =>
      new Promise((resolve) => {
        // "allow all <tool> this session" → auto-allow without a prompt (like the TUI)
        if (alwaysAllow.has(toolName)) return resolve({ behavior: 'allow', updatedInput: input })
        const reqId = ++reqSeq
        pending.set(reqId, { resolve, input, toolName }) // keep input: an 'allow' result must echo updatedInput
        send({ type: 'permission', reqId, toolName, input })
      })

    async function runTurn(message, mode) {
      if (streaming) return send({ type: 'error', error: 'a turn is already in progress' })
      streaming = true
      abort = new AbortController()
      let sawStreamText = false
      let turnSessionId = currentId // confirmed: resume appends to the same id; track in case a future fork changes it
      send({ type: 'turn-start' })
      // scrub inherited claude child-session markers: with them present, the
      // spawned claude stops persisting transcripts (see shared/terminal.js)
      const env = { ...process.env, CLAUDE_CONFIG_DIR: root.dir } // env REPLACES — must spread
      for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PID']) delete env[k]
      try {
        for await (const m of query({
          prompt: message,
          options: {
            resume: currentId || undefined, // undefined = start a new session
            cwd,
            env,
            permissionMode: PERM_MODES[mode] || 'plan',
            pathToClaudeCodeExecutable: claude,
            includePartialMessages: true,
            abortController: abort,
            canUseTool,
            stderr: () => {},
          },
        })) {
          if (closed) break
          if (m.session_id) {
            turnSessionId = m.session_id // system/init + result carry the real session id
            if (!currentId) {
              currentId = m.session_id // a new session was just created — pin it for subsequent turns
              send({ type: 'session-created', sessionId: currentId, slug: findSlugForId(root.dir, currentId) || slug })
            }
          }
          if (m.type === 'stream_event') {
            const ev = m.event
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              sawStreamText = true
              send({ type: 'delta', text: ev.delta.text })
            }
          } else if (m.type === 'assistant' && m.message?.content) {
            for (const b of m.message.content) {
              if (b.type === 'text' && !sawStreamText) send({ type: 'text', text: b.text })
              else if (b.type === 'thinking') send({ type: 'thinking', text: b.thinking || '' })
              else if (b.type === 'tool_use') send({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
            }
          } else if (m.type === 'user' && m.message?.content && Array.isArray(m.message.content)) {
            for (const b of m.message.content) {
              if (b?.type === 'tool_result') {
                send({
                  type: 'tool_result',
                  tool_use_id: b.tool_use_id,
                  content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
                  is_error: !!b.is_error,
                })
              }
            }
          } else if (m.type === 'result') {
            send({ type: 'result', subtype: m.subtype, is_error: !!m.is_error })
          }
        }
      } catch (e) {
        send({ type: 'error', error: String(e?.message || e) })
      } finally {
        streaming = false
        abort = null
        send({ type: 'turn-end', sessionId: turnSessionId, slug: findSlugForId(root.dir, turnSessionId) || slug })
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
      } else if (m.type === 'permission-response') {
        const entry = pending.get(m.reqId)
        if (entry) {
          pending.delete(m.reqId)
          if (m.behavior === 'allow') {
            // scope:'always' → remember this tool for the session (no more prompts for it)
            if (m.scope === 'always') alwaysAllow.add(entry.toolName)
            // AskUserQuestion: the user's selection rides in updatedInput.answers (question text → label)
            const updatedInput = m.answers ? { ...entry.input, answers: m.answers } : entry.input
            entry.resolve({ behavior: 'allow', updatedInput }) // allow REQUIRES updatedInput
          } else {
            entry.resolve({ behavior: 'deny', message: 'Denied in AgentDeck' })
          }
        }
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
      for (const { resolve } of pending.values()) resolve({ behavior: 'deny', message: 'disconnected' })
      pending.clear()
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
