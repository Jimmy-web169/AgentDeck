import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDERS } from './registry.ts'
import { createServer } from './http.ts'
import { stopAllTerminals, noteTerminalChanges, registerTerminalProvider } from './shared/terminal.ts'
import { scheduleProbes, runAllProbes } from './shared/formatProbe.ts'
import { configDir, isolatedConfig } from './shared/roots.ts'
import { migrateStateOnStartup, stateDir } from './shared/state.ts'
import { dashboards } from './deck/dashboards.ts'

const PORT = Number(process.env.AGENTDECK_PORT || 47841)
const DEV_UI_PORT = Number(process.env.AGENTDECK_WEB_PORT || 47842)
const HOST = '127.0.0.1'
// Provider imports are declarative; process-owned terminal registration begins here.
for (const provider of Object.values(PROVIDERS)) {
  if (provider.terminal) registerTerminalProvider(provider.terminal)
}
// Legacy state converges into .agentdeck/ on every start: clean copies happen
// here with the originals retained, and anything conflicting stays where it is.
const migration = migrateStateOnStartup()
if (migration.status === 'copied')
  console.log(`  state: copied ${migration.entries.filter((entry) => entry.status === 'copied').length} legacy item(s) into ${stateDir()}; originals retained`)
else if (migration.status === 'skipped')
  console.warn(
    `  state: legacy files left in place (${migration.entries.filter((entry) => entry.status !== 'identical').length} conflicting or blocked); inspect with: npm run migrate:state -- --config-dir ${configDir()}`
  )
else if (migration.status === 'failed') console.warn(`  state: migration did not complete (${migration.error}); legacy files remain authoritative`)
const host = createServer({
  providers: PROVIDERS,
  dist: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist'),
  devUiPort: DEV_UI_PORT,
  onChange: noteTerminalChanges,
  onRootsChanged: () => runAllProbes(PROVIDERS),
})
let stopProbes = () => {}

host.server.on('error', (error) => {
  if ('code' in error && error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`)
    console.error('  Choose another AGENTDECK_PORT, or stop only the instance you intend to replace.\n')
    process.exit(1)
  }
  throw error
})

host.server.listen(PORT, HOST, () => {
  const address = host.server.address()
  const port = address && typeof address === 'object' ? address.port : PORT
  const boundHost = address && typeof address === 'object' ? address.address : HOST
  console.log(`\n  AgentDeck API  →  http://localhost:${port}  (bind: ${boundHost})`)
  console.log(`  providers: ${Object.keys(PROVIDERS).join(', ')}`)
  if (isolatedConfig()) console.log(`  config dir: ${configDir()}  (AGENTDECK_CONFIG_DIR — default roots are NOT added)`)
  if (process.env.NODE_ENV !== 'production') console.log(`  dev UI: http://localhost:${DEV_UI_PORT}\n`)
  stopProbes = scheduleProbes(PROVIDERS)
})

let processesStopped = false
function stopProcesses() {
  if (processesStopped) return
  processesStopped = true
  stopProbes()
  stopAllTerminals()
  dashboards.closeFrontends()
}
process.on('exit', stopProcesses)
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    stopProcesses()
    const deadline = setTimeout(() => {
      console.error('[shutdown] timed out waiting for watcher handles; forcing exit')
      process.exit(1)
    }, 5000)
    try {
      await host.close()
      clearTimeout(deadline)
      process.exit(0)
    } catch (error) {
      clearTimeout(deadline)
      console.error(error)
      process.exit(1)
    }
  })
}
