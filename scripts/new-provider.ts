import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDER_METHODS } from '../server/shared/providerRoutes.ts'

const own = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
interface Inspection {
  data: unknown
  frontend: unknown
  serverRegistered: boolean
  frontendRegistered: boolean
  metadataRegistered: boolean
  descriptorErrors: string[]
  fixtures: string[]
}
export function dataGaps(id: string, value: unknown): string[] {
  const gaps: string[] = [],
    data = own(value)
  if (data.id !== id) gaps.push(`DATA.id must be ${id}`)
  for (const [route, method] of Object.entries(PROVIDER_METHODS)) {
    const refused = ['postResource', 'deleteResource', 'skills'].includes(method) && data[method] === null && typeof data.notWritable === 'function'
    if (typeof data[method] !== 'function' && !refused) gaps.push(`DATA.${method} missing (${route})`)
  }
  for (const method of ['findBin', 'resumeArgs', 'promptArgs'])
    if (typeof own(data.terminal)[method] !== 'function') gaps.push(`DATA.terminal.${method} missing`)
  return gaps
}
export function frontendGaps(id: string, value: unknown): string[] {
  const gaps: string[] = [],
    frontend = own(value)
  if (frontend.id !== id) gaps.push(`frontend.id must be ${id}`)
  for (const field of ['label', 'color']) if (typeof frontend[field] !== 'string' || !frontend[field]) gaps.push(`frontend.${field} missing`)
  if (!frontend.App && !Object.keys(own(frontend.components)).length) gaps.push('frontend.components or App missing')
  if (!Array.isArray(frontend.sessionTabs) || !frontend.sessionTabs.length) gaps.push('frontend.sessionTabs missing')
  for (const method of ['session', 'fork', 'resources', 'deleteResource', 'open'])
    if (typeof own(frontend.addressing)[method] !== 'function') gaps.push(`frontend.addressing.${method} missing`)
  if (!['nested', 'independent-sessions'].includes(String(own(frontend.capabilities).subagentModel))) gaps.push('frontend.capabilities.subagentModel missing')
  return gaps
}
export function providerGaps(id: string, input: Inspection): string[] {
  const gaps = [...dataGaps(id, input.data), ...frontendGaps(id, input.frontend)]
  if (!input.serverRegistered) gaps.push('server/registry: provider is not registered')
  if (!input.frontendRegistered) gaps.push('src/providers/index: provider is not registered')
  if (!input.metadataRegistered) gaps.push('src/providers/metadata: provider is not registered')
  for (const error of input.descriptorErrors) gaps.push(`descriptor: ${error}`)
  if (!input.fixtures.some((file) => /\.(jsonl|json|sqlite|db)$/.test(file) && !file.startsWith('expected/'))) gaps.push('fixture input missing')
  if (!input.fixtures.some((file) => /^expected\/.+\.json$/.test(file)))
    gaps.push('fixture golden missing; run check:spec -- --update after implementing the parser')
  return gaps
}

export function scaffoldProvider(id: string, directory: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(id) || ['deck', 'shared'].includes(id)) throw Error('Use a lowercase provider ID; deck and shared are reserved')
  const root = path.resolve(directory),
    label = id[0].toUpperCase() + id.slice(1)
  const registries = ['server/registry.ts', 'src/providers/index.ts', 'src/providers/metadata.ts']
  const locations = [
    `server/providers/${id}`,
    `src/providers/${id}.ts`,
    `src/providers/${id}.jsx`,
    `src/providers/${id}.tsx`,
    `spec/providers/${id}.yaml`,
    `spec/fixtures/${id}`,
  ]
  for (const file of registries) if (!fs.statSync(path.join(root, file)).isFile()) throw Error(`Missing registry: ${file}`)
  for (const file of locations) if (fs.existsSync(path.join(root, file))) throw Error(`Refusing to overwrite ${file}`)
  const files: Record<string, string> = {
    [`server/providers/${id}/data.ts`]: `import { TERMINAL_CONFIG } from './terminal.ts'\n// Implement every handler reported by the provider contract test.\nexport const DATA = { id: ${JSON.stringify(id)}, terminal: TERMINAL_CONFIG }\n`,
    [`server/providers/${id}/api.ts`]: `import { makeDispatch } from '../../shared/dispatch.ts'\nimport { makeProviderRoutes } from '../../shared/providerRoutes.ts'\nimport { DATA } from './data.ts'\nexport const dispatch = makeDispatch(makeProviderRoutes(DATA))\n`,
    [`server/providers/${id}/paths.ts`]: `// Use makeRoots and stateFile from server/shared; provider-native homes stay native.\nexport function loadRoots(): never { throw new Error('TODO: implement ${id} root discovery') }\n`,
    [`server/providers/${id}/parser.ts`]: `// Native records enter as unknown; narrow fields before reading them.\nexport function readRecords(_file: string): unknown[] { throw new Error('TODO: read provider records') }\nexport function buildTimeline(_records: unknown[]): never { throw new Error('TODO: normalize timeline') }\nexport function summarize(_records: unknown[], _id: string): never { throw new Error('TODO: summarize session') }\n`,
    [`server/providers/${id}/resources.ts`]: `export function inventory(_root: string): never { throw new Error('TODO: discover resources and declare writable capabilities') }\n`,
    [`server/providers/${id}/terminal.ts`]: `// Declare configuration only; server bootstrap owns registration.\nexport const TERMINAL_CONFIG = {\n  id: ${JSON.stringify(id)}, title: ${JSON.stringify(label)}, envKey: null, checkOrigin: true,\n  findBin: (): string | null => null, // TODO: findOnPath using the provider's documented install paths\n  resumeArgs: (_id: string): string[] => { throw new Error('TODO: verified native resume arguments') },\n  promptArgs: (_prompt: string): string[] => { throw new Error('TODO: verified native prompt arguments') },\n}\n`,
    [`src/providers/${id}.ts`]: `// Wire module-level provider components and metadata before registering.\nexport default { id: ${JSON.stringify(id)}, label: ${JSON.stringify(label)}, color: 'sky', components: {}, sessionTabs: [], addressing: {}, capabilities: {} }\n`,
    [`spec/providers/${id}.yaml`]: `# Complete against spec/provider.schema.json using native fixtures.\nspec: agentdeck/provider/v1\nid: ${id}\nlabel: ${label}\nstatus: draft\n# TODO: cli, roots, sessions, timeline, tokens, capabilities, probe\n`,
    [`spec/fixtures/${id}/README.md`]: `# ${label} parser fixtures\n\nAdd fictional native-format input and maintain expected/*.json with check:spec.\nDo not register the provider until its contract and vocabulary checks pass.\n`,
  }
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content, { flag: 'wx' })
  }
  const notes = [
    `// TODO provider ${id}: import its dispatch, loadRoots, DATA.terminal and watch/home/history adapters; add one PROVIDERS entry.`,
    `// TODO provider ${id}: import './${id}.ts' and add it to PROVIDERS and PROVIDER_LIST after its contract passes.`,
    `// TODO provider ${id}: add id/label/apiAddr/addressing here; the frontend descriptor must spread this same metadata.`,
  ]
  registries.forEach((file, index) => {
    fs.appendFileSync(path.join(root, file), `\n${notes[index]}\n`)
  })
  return Object.keys(files)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const id = process.argv[2]
    if (!id || process.argv.length !== 3) throw Error('Usage: npm run new:provider -- <id>')
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const files = scaffoldProvider(id, root)
    console.log(`Created ${files.length} draft files for ${id}. Registry TODOs are inactive until the implementation passes its contract.`)
    console.log(files.join('\n'))
    console.log('Complete provider-contract tests, check:spec, check:providers, and the frontend descriptor tests before enabling the registry entries.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
