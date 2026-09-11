import { after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STAGING = fileURLToPath(new URL('../../tmp/', import.meta.url))

export function temporaryDirectory(prefix = 'agentdeck-test-') {
  fs.mkdirSync(STAGING, { recursive: true })
  const dir = fs.mkdtempSync(path.join(STAGING, prefix))
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

export async function withConfigDir<T>(dir: string | null | undefined, fn: () => T | Promise<T>) {
  const previous = process.env.AGENTDECK_CONFIG_DIR
  if (dir == null) delete process.env.AGENTDECK_CONFIG_DIR
  else process.env.AGENTDECK_CONFIG_DIR = dir
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.AGENTDECK_CONFIG_DIR
    else process.env.AGENTDECK_CONFIG_DIR = previous
  }
}
