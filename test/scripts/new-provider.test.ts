import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { scaffoldProvider, providerGaps } from '../../scripts/new-provider.ts'
import { PROVIDER_METHODS } from '../../server/shared/providerRoutes.ts'
import { temporaryDirectory } from '../helpers/tmpConfigDir.ts'
import { idAddressing } from '../../src/providers/addressing.ts'

function workspace() {
  const root = temporaryDirectory('provider-scaffold-')
  for (const file of ['server/registry.ts', 'src/providers/index.ts', 'src/providers/metadata.ts']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '// Existing providers remain unchanged.\n')
  }
  return root
}

test('provider scaffold creates owned TS skeletons and inactive registry reminders without copying a provider page', async () => {
  const root = workspace()
  const files = scaffoldProvider('demo', root)
  assert.equal(files.length, 9)
  assert.ok(files.every((file) => fs.existsSync(path.join(root, file))))
  assert.equal(files.filter((file) => file.endsWith('.ts')).length, 7)
  assert.ok(fs.readFileSync(path.join(root, 'server/registry.ts'), 'utf8').startsWith('// Existing providers remain unchanged.'))
  assert.match(fs.readFileSync(path.join(root, 'src/providers/metadata.ts'), 'utf8'), /TODO provider demo/)
  const { DATA } = await import(pathToFileURL(path.join(root, 'server/providers/demo/data.ts')).href)
  const { default: frontend } = await import(pathToFileURL(path.join(root, 'src/providers/demo.ts')).href)
  const input = {
    data: DATA,
    frontend,
    serverRegistered: false,
    frontendRegistered: false,
    metadataRegistered: false,
    descriptorErrors: ['missing cli'],
    fixtures: ['README.md'],
  }
  const missing = providerGaps('demo', input)
  assert.equal(missing.filter((message) => message.startsWith('DATA.') && message.includes(' missing (')).length, 31)
  assert.ok(missing.includes('DATA.getSessions missing (GET /api/sessions)'))
  assert.ok(missing.includes('frontend.addressing.session missing'))
  assert.ok(missing.includes('descriptor: missing cli'))
  assert.ok(missing.includes('fixture input missing'))
  // This is the contract's structural completion boundary; parser responses are
  // independently checked against schema/goldens by check:spec and HTTP tests.
  const complete = {
    ...input,
    data: { ...DATA, ...Object.fromEntries(Object.values(PROVIDER_METHODS).map((method) => [method, () => ({})])) },
    frontend: {
      ...frontend,
      components: { Conversation: () => null },
      sessionTabs: [{ k: 'conversation' }],
      addressing: idAddressing,
      capabilities: { subagentModel: 'independent-sessions' },
    },
    serverRegistered: true,
    frontendRegistered: true,
    metadataRegistered: true,
    descriptorErrors: [],
    fixtures: ['session.jsonl', 'expected/session.json'],
  }
  assert.deepEqual(providerGaps('demo', complete), [])
  complete.data.postResource = complete.data.deleteResource = complete.data.skills = null
  complete.data.notWritable = () => {
    throw Object.assign(Error('read only'), { status: 501 })
  }
  assert.deepEqual(providerGaps('demo', complete), [])
})

test('provider scaffold rejects traversal, reserved IDs and existing targets before changing registries', () => {
  const root = workspace(),
    registry = path.join(root, 'server/registry.ts')
  const before = fs.readFileSync(registry, 'utf8')
  for (const id of ['../escape', 'Invalid', 'deck', 'shared', '']) assert.throws(() => scaffoldProvider(id, root), /provider ID/)
  assert.equal(fs.readFileSync(registry, 'utf8'), before)
  scaffoldProvider('demo', root)
  const after = fs.readFileSync(registry, 'utf8')
  assert.throws(() => scaffoldProvider('demo', root), /overwrite/)
  assert.equal(fs.readFileSync(registry, 'utf8'), after)
})
