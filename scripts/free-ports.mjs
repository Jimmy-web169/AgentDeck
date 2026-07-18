#!/usr/bin/env node
// Free the AgentDeck dev ports before starting — cross-platform.
// Kills whatever is LISTENING on the given TCP ports (defaults: API 47841, web 47842).
//
// Used by the `predev`/`preserver` npm hooks and by `make stop`, so a stale server
// never blocks a restart with EADDRINUSE. Replaces the old `lsof`-based Makefile
// recipe, which silently no-op'd on Windows (lsof isn't installed there) and left
// the port held — the root cause of the "address already in use" loop.
import { execSync } from 'node:child_process'

const isWin = process.platform === 'win32'

const ports = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0)
if (ports.length === 0) ports.push(47841, 47842)

// Return the PIDs of processes LISTENING on `port`, or [] if none / tool missing.
function pidsOnPort(port) {
  const pids = new Set()
  try {
    if (isWin) {
      // netstat columns: Proto  Local Address  Foreign Address  State  PID
      const out = execSync('netstat -ano -p TCP', { encoding: 'utf8' })
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue
        const cols = line.trim().split(/\s+/)
        const local = cols[1] || '' // e.g. 127.0.0.1:47841 or [::1]:47841
        if (!local.endsWith(`:${port}`)) continue
        const pid = cols[cols.length - 1]
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid)
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
      for (const pid of out.split(/\s+/)) if (/^\d+$/.test(pid)) pids.add(pid)
    }
  } catch {
    // non-zero exit = no listener (or tool absent) → nothing to free
  }
  return [...pids]
}

for (const port of ports) {
  const pids = pidsOnPort(port)
  if (pids.length === 0) {
    console.log(`nothing on :${port}`)
    continue
  }
  for (const pid of pids) {
    try {
      if (isWin) execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' })
      else process.kill(Number(pid), 'SIGKILL')
      console.log(`stopped :${port} (pid ${pid})`)
    } catch (e) {
      console.log(`could not free :${port} (pid ${pid}): ${e.message}`)
    }
  }
}
