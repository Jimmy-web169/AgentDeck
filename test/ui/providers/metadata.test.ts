// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PROVIDER_METADATA, providerMetadata } from '../../../src/providers/metadata.ts'
import { idAddressing, slugAddressing } from '../../../src/providers/addressing.ts'
import { PROVIDERS } from '../../../src/providers/index.ts'

test('provider metadata selects native addressing without importing UI descriptors', () => {
  assert.deepEqual(Object.keys(PROVIDER_METADATA), ['claude', 'codex', 'antigravity'])
  assert.equal(providerMetadata('claude').addressing, slugAddressing)
  assert.equal(providerMetadata('codex').addressing, idAddressing)
  assert.equal(providerMetadata('antigravity').addressing, idAddressing)
  assert.throws(() => providerMetadata('toString'), /unsupported provider/)
})

test('UI descriptors reuse the sole provider metadata catalog without divergent identities', () => {
  assert.deepEqual(Object.keys(PROVIDERS), Object.keys(PROVIDER_METADATA))
  for (const [id, metadata] of Object.entries(PROVIDER_METADATA)) {
    for (const [key, value] of Object.entries(metadata)) assert.equal((PROVIDERS as Record<string, Record<string, unknown>>)[id][key], value, `${id}.${key}`)
  }
})

test('registered UI providers satisfy the scaffold descriptor completion contract', async () => {
  const { frontendGaps } = await import('../../../scripts/new-provider.ts')
  for (const [id, descriptor] of Object.entries(PROVIDERS)) assert.deepEqual(frontendGaps(id, descriptor), [], id)
})
