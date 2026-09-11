import type { TerminalConfig, SavedSession } from '../../shared/terminalTypes.ts'
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

export function prepareAntigravityLaunch({ configDir }: { configDir: string }) {
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
  return {}
}

export function resolveAntigravitySession({ meta, files }: Parameters<NonNullable<TerminalConfig['resolveSession']>>[0]): SavedSession | null {
  if (meta.id) return null
  const dir = resolveRoot(meta.root).dir
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
