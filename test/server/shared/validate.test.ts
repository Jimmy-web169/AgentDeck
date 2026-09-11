import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { makeDispatch } from '../../../server/shared/dispatch.ts'
import { requireFields, requireQuery, readJsonBody } from '../../../server/shared/validate.ts'

test('required fields reject missing and non-string identities before a mutation runs', async () => {
  let mutations = 0
  const dispatch = makeDispatch({
    'POST /api/resource': (_q, body) => {
      const fields = requireFields(body, ['root', 'kind'])
      mutations++
      return { content: fields.content }
    },
  })
  for (const body of [null, [], false, 0, 'value', {}, { root: 'a' }, { root: [], kind: 'agents' }, { root: 0, kind: 'agents' }]) {
    const result = await dispatch('POST', '/api/resource', new URLSearchParams(), body)
    assert.equal(result.status, 400)
  }
  assert.equal(mutations, 0)
  assert.deepEqual(await dispatch('POST', '/api/resource', new URLSearchParams(), { root: 'a', kind: 'agents', content: '' }), {
    status: 200,
    body: { content: '' },
  })
  assert.equal(mutations, 1)
})
test('query validation retains encoded values and permits unrelated optional empty fields', () => {
  const query = new URLSearchParams('root=account+one&slug=%2Ffixture%2Fproject&label=')
  assert.equal(requireQuery(query, ['root', 'slug']), query)
  assert.equal(query.get('root'), 'account one')
  assert.equal(query.get('label'), '')
  assert.throws(() => requireQuery(query, ['id']), { status: 400, message: 'missing id' })
})
test('JSON body parsing preserves split UTF-8, empty bodies, and explicit malformed/oversize errors', async () => {
  const bytes = Buffer.from(JSON.stringify({ content: '繁體中文 🌱' }))
  assert.deepEqual(await readJsonBody(Readable.from([...bytes].map((byte) => Buffer.from([byte])))), { content: '繁體中文 🌱' })
  assert.deepEqual(await readJsonBody(Readable.from([])), {})
  await assert.rejects(readJsonBody(Readable.from(['{'])), { status: 400, message: 'invalid JSON body' })
  await assert.rejects(readJsonBody(Readable.from(['12345']), { limit: 4 }), { status: 413, message: 'request body too large' })
  for (const value of [null, [], false, 3]) assert.deepEqual(await readJsonBody(Readable.from([JSON.stringify(value)])), value)
})
