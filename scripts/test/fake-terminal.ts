#!/usr/bin/env node
// Isolated process fixture: never starts a real CLI, tmux server, or socket.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const dir = process.env.AGENTDECK_TEST_POOL
if (!dir) process.exit(2)
const bin = path.basename(process.argv[1])
const args = process.argv.slice(2)
const value = (flag: string) => args[args.indexOf(flag) + 1]
const sessionFile = (name: string) => {
  name = name.replace(/^=/, '')
  if (!/^agentdeck-[a-f0-9]{12}$/.test(name)) throw Error('invalid fixture session name')
  return path.join(dir, name + '.json')
}
if (bin === 'ttyd') {
  const i = args.indexOf('attach-session')
  if (i >= 0) execFileSync(args[i - 1], ['has-session', '-t', args[i + 2]])
  setInterval(() => {}, 1000)
} else if (bin === 'tmux') {
  if (args[0] === 'new-session') {
    const file = sessionFile(value('-s'))
    if (fs.existsSync(file)) process.exit(1)
    const meta = args.find((s) => s.startsWith('AGENTDECK_META='))
    if (!meta) throw Error('missing fixture metadata')
    fs.writeFileSync(file, JSON.stringify({ meta: meta.slice('AGENTDECK_META='.length), args }))
  } else if (args[0] === 'list-sessions') {
    for (const f of fs.readdirSync(dir).filter((s: string) => /^agentdeck-.*\.json$/.test(s))) console.log(f.slice(0, -5) + '\t0')
  } else if (args[0] === 'show-environment') {
    const state = JSON.parse(fs.readFileSync(sessionFile(value('-t')), 'utf8'))
    console.log('AGENTDECK_META=' + state.meta)
  } else if (args[0] === 'has-session') {
    if (!fs.existsSync(sessionFile(value('-t')))) process.exit(1)
  } else if (args[0] === 'set-environment' && args.includes('-t')) {
    const file = sessionFile(value('-t'))
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.meta = args.at(-1)
    fs.writeFileSync(file, JSON.stringify(state))
  } else if (args[0] === 'kill-session') {
    fs.rmSync(sessionFile(value('-t')), { force: true })
  }
} else if (args.includes('--help')) console.log('--session-id --resume')
