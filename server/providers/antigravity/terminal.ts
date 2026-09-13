import type { TerminalConfig, SavedSession } from '../../shared/terminalTypes.ts'
import crypto from 'node:crypto'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { resolveRoot, sessionFileById, readTitle, isSessionId, NO_CWD } from './paths.ts'
import { uniqueSession } from '../../shared/terminalDiscovery.ts'

export function resolveSavedAntigravitySession({ root, id }: Parameters<NonNullable<TerminalConfig['resolveSavedSession']>>[0]): SavedSession | null {
  if (!isSessionId(id)) return null
  const entry = sessionFileById(root.dir, id)
  return entry && !entry.isSubagent ? { id, slug: entry.cwd || NO_CWD, cwd: entry.cwd, title: readTitle(root.dir, id) } : null
}

// agy writes one log per process into its home's `log/` directory and records
// there which conversation it created or resumed. Naming that file per launch
// (`--log-file`) turns it into exact evidence on every platform, including
// Windows, where the process tree cannot be read. The CLI writes the file; the
// name only makes it findable.
export const launchLogFile = (configDir: string, key: string) =>
  path.join(configDir, 'log', `agentdeck-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}.log`)

// Without a launch key this only validates the data folder (the registry's context-target check).
export function prepareAntigravityLaunch({ configDir, key }: { configDir: string; key?: string }) {
  const actual = path.join(os.homedir(), '.gemini', 'antigravity-cli')
  const real = (p: string) => {
    try {
      return fs.realpathSync(p)
    } catch {
      return path.resolve(p)
    }
  }
  if (real(configDir) !== real(actual))
    throw Object.assign(
      new Error('agy cannot select this tracked data folder. Use its CLI folder (~/.gemini/antigravity-cli) to start or resume a conversation.'),
      { status: 409 }
    )
  if (!key) return {}
  const logFile = launchLogFile(configDir, key)
  return { args: ['--log-file', logFile], meta: { logFile } }
}

// The conversation this process runs: the last one its log reports as created,
// resumed or found active. Listings of other conversations (`active=false`) are
// not evidence. Only the tail is read; a long session's log keeps growing.
const LOG_TAIL = 512 * 1024
export function conversationFromLog(file: string | null | undefined): string | null {
  if (typeof file !== 'string' || !file) return null
  let text: string
  try {
    const size = fs.statSync(file).size
    const fd = fs.openSync(file, 'r')
    try {
      const length = Math.min(size, LOG_TAIL)
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, size - length)
      text = buffer.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  const ids = [...text.matchAll(/(?:Created conversation|Resuming conversation|found conversation) ([0-9a-f-]{36})(?: \(active=true\))?(?=\s|$)/gi)]
    .filter((m) => !/found conversation/i.test(m[0]) || /active=true/.test(m[0]))
    .map((m) => m[1])
  return ids.at(-1) || null
}

export function resolveAntigravitySession({ meta, files }: Parameters<NonNullable<TerminalConfig['resolveSession']>>[0]): SavedSession | null {
  if (meta.id) return null
  const dir = resolveRoot(meta.root).dir
  const logged = conversationFromLog(typeof meta.logFile === 'string' ? meta.logFile : null)
  if (logged) {
    const entry = sessionFileById(dir, logged)
    if (entry && !entry.isSubagent) return { id: logged, slug: entry.cwd || meta.cwd, cwd: entry.cwd || meta.cwd, title: readTitle(dir, logged) || meta.title }
  }
  return uniqueSession(
    files().flatMap((file) => {
      const relative = path.relative(dir, file).split(path.sep).join('/')
      const match = relative.match(/^(?:conversations\/([0-9a-f-]{36})\.db(?:-wal|-shm)?|brain\/([0-9a-f-]{36})\/)/i)
      const id = match?.[1] || match?.[2]
      if (!id) return []
      const entry = sessionFileById(dir, id)
      if (!entry || entry.isSubagent) return []
      return [{ id, slug: entry.cwd || meta.cwd, cwd: entry.cwd || meta.cwd, title: readTitle(dir, id) || meta.title }]
    })
  )
}
