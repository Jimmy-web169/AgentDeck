#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDir, planStateMigration, applyStateMigration } from '../server/shared/state.ts'

// No startup migration: operators inspect a plan, stop the configured service,
// and explicitly apply. The copy operation never removes legacy state.
export function migrateState(args: string[]) {
  let directory = configDir(),
    apply = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--apply') apply = true
    else if (arg === '--config-dir' && args[i + 1] && !args[i + 1].startsWith('--')) directory = path.resolve(args[++i])
    else if (arg === '--help') {
      return {
        help: 'Usage: npm run migrate:state -- [--config-dir <directory>] [--apply]\nDefault is a read-only plan. Stop the service using this config directory before --apply. Legacy files are retained.',
      }
    } else throw Error(`Unknown or incomplete argument: ${arg}`)
  }
  const entries = apply ? applyStateMigration(directory) : planStateMigration(directory)
  return { mode: apply ? 'apply' : 'plan', directory, entries }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = migrateState(process.argv.slice(2))
    console.log(JSON.stringify(result, null, 2))
    if (result.entries?.some((entry) => entry.status === 'conflict' || entry.status === 'blocked')) process.exitCode = 1
  } catch (error) {
    const entries = error && typeof error === 'object' && 'entries' in error ? error.entries : undefined
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), entries }, null, 2))
    process.exitCode = 1
  }
}
