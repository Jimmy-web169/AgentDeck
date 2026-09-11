import { execFileSync } from 'node:child_process'
import { sourceKey } from '../../shared/identity.ts'
import { findTmux } from './terminalBinary.ts'
import { processFiles } from './terminalDiscovery.ts'
import type { ChangeEvent } from '../../shared/types.d.ts'
import type { TerminalConfig, TerminalMetadata, TerminalPoolEntry } from './terminalTypes.ts'

export function createTerminalInventory(providers: Map<string, TerminalConfig>, sessions: Map<string, TerminalPoolEntry>) {
  // All live AgentDeck tmux sessions on the box — including ones with no ttyd
  // currently attached (e.g. after closing the browser or restarting the server).
  // Metadata is read back from each session's AGENTDECK_META env var. `attached`
  // reflects whether something (a ttyd or a real terminal) is viewing it now.
  const LEGACY_PROVIDER: Record<string, string> = { agy: 'antigravity' }
  const terminalObservers = new Set<(entry: TerminalMetadata) => void>()
  function observeTerminals(listener: (entry: TerminalMetadata) => void) {
    terminalObservers.add(listener)
    return () => terminalObservers.delete(listener)
  }
  const discovered = new Map<string, { at: number; version: number }>()
  const discoveryVersions = new Map<string, number>()
  const discoveryScope = (meta: Pick<TerminalMetadata, 'provider' | 'root'>) => sourceKey(String(meta.provider), String(meta.root))

  // Watcher events invalidate evidence, but never constitute ownership evidence.
  // Keep provider/root isolation and a short burst throttle for expensive probes.
  function noteTerminalChanges(changes: ChangeEvent[]) {
    for (const scope of new Set(changes.filter((c) => c.provider && c.root).map(discoveryScope))) {
      discoveryVersions.set(scope, (discoveryVersions.get(scope) || 0) + 1)
    }
  }

  function listLiveTmux(): TerminalMetadata[] {
    const tmux = findTmux()
    if (!tmux) return []
    let rows: string[]
    try {
      // stderr dropped: with no tmux server running, tmux prints "no server running on …" on every poll
      rows = execFileSync(tmux, ['list-sessions', '-F', '#{session_name}\t#{session_attached}\t#{socket_path}'], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .filter(Boolean)
    } catch {
      return [] // tmux server not running / no sessions
    }
    const out: TerminalMetadata[] = []
    for (const row of rows) {
      const [name, attached, tmuxSocket] = row.split('\t')
      if (!name?.startsWith('agentdeck-')) continue
      let meta: TerminalMetadata = {}
      try {
        // tmux prints just the named variable; psmux (the Windows tmux stand-in)
        // prints the whole environment — pick the right line either way.
        const env = execFileSync(tmux, ['show-environment', '-t', name, 'AGENTDECK_META'], {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        const line = env
          .split('\n')
          .map((s) => s.trim())
          .find((s) => s.startsWith('AGENTDECK_META='))
        if (line) meta = JSON.parse(Buffer.from(line.slice('AGENTDECK_META='.length), 'base64').toString('utf8'))
      } catch {}
      // sessions started before the id was stored carry the CLI title instead
      if (meta.provider && LEGACY_PROVIDER[meta.provider]) meta.provider = LEGACY_PROVIDER[meta.provider]
      const provider = providers.get(meta.provider || '')
      const last = discovered.get(name)
      const version = discoveryVersions.get(discoveryScope(meta)) || 0
      const dirty = last && last.version !== version
      if (provider?.resolveSession && (!last || Date.now() - last.at >= (dirty ? 500 : 4000))) {
        try {
          const observed = provider.resolveSession({ meta, files: () => processFiles(tmux, name) })
          if (observed?.id && (observed.id !== meta.id || observed.slug !== meta.slug || observed.title !== meta.title)) {
            meta = { ...meta, ...observed, isNew: false }
            execFileSync(tmux, ['set-environment', '-t', `=${name}`, 'AGENTDECK_META', Buffer.from(JSON.stringify(meta)).toString('base64')], {
              stdio: 'ignore',
              timeout: 2000,
            })
            const pool = sessions.get(meta.key || '')
            if (pool) pool.meta = { ...pool.meta, ...meta }
          }
        } catch {
          /* Unavailable evidence does not make a live terminal disappear. */
        }
        discovered.set(name, { at: Date.now(), version })
      }
      const entry = { ...meta, tmuxName: name, tmuxSocket: tmuxSocket || null, attached: attached !== '0' }
      out.push(entry)
      for (const listener of terminalObservers) {
        try {
          listener(entry)
        } catch {
          /* An optional audit projection must not break terminal inventory. */
        }
      }
    }
    return out
  }

  return { observeTerminals, noteTerminalChanges, listLiveTmux, forgetTerminal: (name: string) => discovered.delete(name) }
}
