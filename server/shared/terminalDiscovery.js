import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

// Optional evidence source. Failure/ambiguity leaves the terminal unbound and
// attachable; it must never select the newest transcript in a working folder.
// Process-owned paths also work for legacy tmux sessions without launch IDs.
export function processFiles(tmux, name) {
  if (!tmux || !name || process.platform === 'win32') return []
  try {
    const opts = { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 }
    const roots = execFileSync(tmux, ['list-panes', '-t', name, '-F', '#{pane_pid}'], opts).trim().split(/\s+/).map(Number).filter(Number.isInteger)
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], opts).trim().split('\n').map((s) => s.trim().split(/\s+/).map(Number))
    const pids = new Set(roots)
    for (let depth = 0; depth < 3; depth++) {
      const parents = new Set(pids)
      for (const [pid, parent] of rows) if (parents.has(parent)) pids.add(pid)
    }
    if (!pids.size) return []
    const bin = fs.existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof'
    let output
    try { output = execFileSync(bin, ['-nP', '-Fn', '-p', [...pids].join(',')], opts) }
    catch (e) { output = typeof e.stdout === 'string' ? e.stdout : '' }
    return [...new Set(output.split('\n').filter((s) => s.startsWith('n/')).map((s) => s.slice(1)))]
  } catch { return [] }
}

export function uniqueSession(candidates) {
  const byId = new Map(candidates.filter(Boolean).map((s) => [s.id, s]))
  return byId.size === 1 ? [...byId.values()][0] : null
}
