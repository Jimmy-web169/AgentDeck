#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { configDir, stateDir, stateFile, stateDirectory } from '../server/shared/state.ts'

type SeedFile = { name: string; data: string }
export type ContainerSeed = { files: SeedFile[]; sources: string[]; bytes: number }
const OWNERS = fs
  .readdirSync(fileURLToPath(new URL('../spec/providers/', import.meta.url)))
  .filter((name) => /^[a-z][a-z0-9-]*\.yaml$/.test(name))
  .map((name) => name.slice(0, -5))
  .sort()

// Only intentional application records are copied. Runtime PIDs, sockets,
// caches and provider-owned homes never enter the seed or the image.
export function prepareContainerSeed(base = configDir()): ContainerSeed {
  const files: SeedFile[] = []
  const sources = new Set<string>()
  let bytes = 0
  const add = (source: string, name: string) => {
    const stat = fs.lstatSync(source)
    if (!stat.isFile()) throw Error(`Expected a regular state file: ${source}`)
    if (bytes + stat.size > 64 * 1024 * 1024) throw Error('State exceeds the 64 MiB import limit; import exports separately')
    const data = fs.readFileSync(source)
    if (name.endsWith('.json')) JSON.parse(data.toString('utf8'))
    bytes += data.length
    if (bytes > 64 * 1024 * 1024) throw Error('State exceeds the 64 MiB import limit; import exports separately')
    files.push({ name, data: data.toString('base64') })
  }
  const walk = (source: string, name: string) => {
    if (!fs.lstatSync(source).isDirectory()) throw Error(`Expected a regular state directory: ${source}`)
    for (const child of fs.readdirSync(source, { withFileTypes: true })) {
      if (child.name.startsWith('.migration-')) throw Error('Finish the pending state migration before importing')
      const file = path.join(source, child.name),
        target = `${name}/${child.name}`
      if (child.isDirectory()) walk(file, target)
      else add(file, target)
    }
  }
  for (const owner of OWNERS) {
    const roots = stateFile('roots', owner, base)
    if (fs.existsSync(roots)) {
      const records: unknown = JSON.parse(fs.readFileSync(roots, 'utf8'))
      if (!Array.isArray(records)) throw Error(`Invalid roots array: ${roots}`)
      for (const root of records) {
        if (!root || typeof root.dir !== 'string' || !path.isAbsolute(root.dir)) throw Error(`Root must have an absolute directory: ${roots}`)
        sources.add(root.dir)
      }
      add(roots, `roots/${owner}.json`)
    }
    const probe = stateFile('probe', owner, base)
    if (fs.existsSync(probe)) add(probe, `probe/${owner}.json`)
  }
  for (const owner of ['handoffs', 'dashboards'] as const) {
    const directory = stateDirectory(owner, base)
    if (fs.existsSync(directory)) walk(directory, owner)
  }
  return { files, sources: [...sources].sort(), bytes }
}

export function sourceMountArgs(sources: string[]): string[] {
  return [...new Set(sources)].flatMap((source) => {
    if (
      !path.isAbsolute(source) ||
      source.includes(',') ||
      source.includes('\n') ||
      ['/', '/Users', '/home', '/data', '/opt', '/opt/agentdeck'].includes(source)
    )
      throw Error(`Unsupported source mount: ${source}`)
    if (!fs.statSync(source).isDirectory()) throw Error(`Source directory is unavailable: ${source}`)
    return ['--mount', `type=bind,src=${source},dst=${source},readonly`]
  })
}

const docker = (args: string[], input?: string) => {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw Error(result.stderr || result.stdout || `docker exited ${result.status}`)
  return result.stdout.trim()
}
// The receiving side runs this same strictly checked module inside the image.
// Preflight the complete packet before writing; never overwrite existing state.
export function applyContainerSeed(input: unknown, base: string): number {
  if (!fs.lstatSync(base).isDirectory()) throw Error('State destination must be a regular directory')
  if (fs.readdirSync(base).length) throw Error('State volume is not empty; refusing to overwrite')
  if (
    !input ||
    typeof input !== 'object' ||
    !('files' in input) ||
    !Array.isArray(input.files) ||
    !('sources' in input) ||
    !Array.isArray(input.sources) ||
    !input.sources.every((source: unknown) => typeof source === 'string' && path.isAbsolute(source))
  )
    throw Error('Invalid seed packet')
  let bytes = 0
  const seen = new Set<string>()
  const files = input.files.map((file: unknown) => {
    if (!file || typeof file !== 'object' || !('name' in file) || typeof file.name !== 'string' || !('data' in file) || typeof file.data !== 'string')
      throw Error('Invalid seed file')
    const name = file.name
    if (name.includes('\0')) throw Error('Invalid seed path')
    if (!/^(roots|probe|handoffs|dashboards)\//.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..') || name.includes('\\'))
      throw Error('Invalid seed path')
    const target = path.resolve(base, name)
    if (!target.startsWith(`${path.resolve(base)}${path.sep}`) || seen.has(target)) throw Error('Invalid or duplicate seed path')
    seen.add(target)
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw Error('Invalid seed encoding')
    const data = Buffer.from(file.data, 'base64')
    bytes += data.length
    if (bytes > 64 * 1024 * 1024) throw Error('Seed exceeds 64 MiB')
    if (name.endsWith('.json')) JSON.parse(data.toString('utf8'))
    return { target, data }
  })
  for (const file of files) {
    for (let parent = path.dirname(file.target); parent !== path.resolve(base); parent = path.dirname(parent)) {
      if (seen.has(parent)) throw Error('Conflicting seed file and directory paths')
    }
  }
  // Exclusive mkdir reserves the empty volume before writes, so simultaneous
  // imports cannot merge two otherwise valid packets into one state tree.
  fs.mkdirSync(path.join(base, 'runtime'), { mode: 0o700 })
  for (const file of files) {
    fs.mkdirSync(path.dirname(file.target), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file.target, file.data, { flag: 'wx', mode: 0o600 })
  }
  fs.writeFileSync(path.join(base, 'runtime/container-sources.json'), JSON.stringify(input.sources), { flag: 'wx', mode: 0o600 })
  return files.length
}

export function containerMain(command: string | undefined) {
  if (command === 'apply-seed') {
    const count = applyContainerSeed(JSON.parse(fs.readFileSync(0, 'utf8')), stateDir())
    console.log(`Imported ${count} state files; source data stays on the host.`)
    return
  }
  if (command === 'read-sources') {
    process.stdout.write(fs.readFileSync(path.join(stateDir(), 'runtime/container-sources.json'), 'utf8'))
    return
  }
  const image = process.env.CONTAINER_IMAGE || 'agentdeck:local'
  const volume = process.env.CONTAINER_STATE_VOLUME || 'agentdeck-container-state'
  const mount = `type=volume,src=${volume},dst=/data/.agentdeck`
  if (command === 'plan' || command === 'import') {
    const seed = prepareContainerSeed()
    sourceMountArgs(seed.sources)
    if (command === 'plan')
      console.log(
        JSON.stringify(
          {
            base: configDir(),
            volume,
            files: seed.files.map((file) => file.name),
            sources: seed.sources,
            bytes: seed.bytes,
            mode: 'copy once; sources mounted read-only at their original paths',
          },
          null,
          2
        )
      )
    else
      console.log(
        docker(
          ['run', '--rm', '-i', '--network', 'none', '--mount', mount, '--entrypoint', 'node', image, 'scripts/container.ts', 'apply-seed'],
          JSON.stringify(seed)
        )
      )
    return
  }
  if (command !== 'up-local') throw Error('Usage: node scripts/container.ts plan|import|up-local')
  const port = Number(process.env.CONTAINER_PORT || 47861)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [47841, 47842, Number(process.env.AGENTDECK_PORT || 47841)].includes(port))
    throw Error('Choose an unused container port different from local API/Vite ports')
  const sources: string[] = JSON.parse(
    docker(['run', '--rm', '--network', 'none', '--mount', `${mount},readonly`, '--entrypoint', 'node', image, 'scripts/container.ts', 'read-sources'])
  )
  const projects: unknown = JSON.parse(process.env.CONTAINER_PROJECT_DIRS || '[]')
  if (!Array.isArray(projects) || !projects.every((item) => typeof item === 'string'))
    throw Error('CONTAINER_PROJECT_DIRS must be a JSON array of absolute paths')
  const args = sourceMountArgs([...sources, ...projects])
  console.log(
    docker([
      'run',
      '--detach',
      '--init',
      '--name',
      process.env.CONTAINER_NAME || 'agentdeck-container',
      '--hostname',
      process.env.CONTAINER_HOSTNAME || volume,
      '--publish',
      `127.0.0.1:${port}:47841`,
      '--mount',
      mount,
      ...args,
      image,
    ])
  )
  console.log(`AgentDeck container: http://localhost:${port}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    containerMain(process.argv[2])
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
