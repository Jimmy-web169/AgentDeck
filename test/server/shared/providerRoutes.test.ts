import test from 'node:test'
import assert from 'node:assert/strict'
import { makeProviderRoutes } from '../../../server/shared/providerRoutes.ts'
import { makeDispatch } from '../../../server/shared/dispatch.ts'

const methods = [
  'getRoots',
  'postRoots',
  'postRootLabel',
  'deleteRoots',
  'postProbeRun',
  'postProbeAccept',
  'getActivity',
  'getProjects',
  'getSessions',
  'getSession',
  'deleteSession',
  'getRaw',
  'getSubagents',
  'getStats',
  'getHistory',
  'getUsage',
  'getVersion',
  'getMemory',
  'getPlugins',
  'getResources',
  'postResource',
  'deleteResource',
  'skills',
  'postOpen',
  'getBrowse',
  'getPickFolder',
  'postTerminal',
  'getTerminals',
  'getLiveTerminals',
  'getActiveSessions',
  'deleteTerminal',
]
const adapter = (): Parameters<typeof makeProviderRoutes>[0] =>
  Object.fromEntries(methods.map((name) => [name, (query: URLSearchParams, body: unknown) => ({ name, query, body })]))

test('provider route factory preserves query/body identity and provider overrides through real dispatch', async () => {
  const data = adapter(),
    routes = makeProviderRoutes(data)
  assert.equal(Object.keys(routes).length, 31)
  const query = new URLSearchParams({ root: 'synthetic', id: 'one', slug: 'project', name: 'file', kind: 'agent', key: 'terminal' }),
    body = { root: 'synthetic', id: 'one', path: '/fixture', kind: 'agent', name: 'file', what: 'editor', ref: 'example', content: '' }
  const dispatch = makeDispatch({ ...routes, 'GET /api/subagent': () => ({ nested: true }) })
  const read = await dispatch('GET', '/api/sessions', query, body)
  assert.equal(read.status, 200)
  assert.equal((read.body as { name: string; query: URLSearchParams; body: unknown }).name, 'getSessions')
  assert.equal((read.body as { name: string; query: URLSearchParams; body: unknown }).query, query)
  assert.equal((read.body as { name: string; query: URLSearchParams; body: unknown }).body, body)
  assert.deepEqual(await dispatch('GET', '/api/subagent', query), { status: 200, body: { nested: true } })
  assert.equal((await dispatch('GET', '/api/missing', query)).status, 404)
  for (const route of Object.keys(routes)) {
    const [method, path] = route.split(' ')
    const result = await dispatch(method, path, query, body)
    assert.equal(result.status, 200, route)
    assert.equal((result.body as { query: URLSearchParams; body: unknown }).query, query, route)
    assert.equal((result.body as { query: URLSearchParams; body: unknown }).body, body, route)
  }
})

test('null write capabilities preserve provider-specific refusal and incomplete adapters fail at construction', async () => {
  const data = adapter()
  data.id = 'synthetic'
  data.skills = data.postResource = data.deleteResource = null
  data.notWritable = () => {
    throw Object.assign(new Error('Managed by the provider CLI'), { status: 501 })
  }
  const dispatch = makeDispatch(makeProviderRoutes(data))
  for (const [method, path] of [
    ['POST', '/api/skill-run'],
    ['POST', '/api/resource'],
    ['DELETE', '/api/resource'],
  ]) {
    assert.deepEqual(
      await dispatch(method, path, new URLSearchParams({ kind: 'agent', name: 'file' }), { root: 'synthetic', kind: 'agent', name: 'file', ref: 'example' }),
      { status: 501, body: { error: 'Managed by the provider CLI' } }
    )
  }
  assert.equal((await dispatch('GET', '/api/resources', new URLSearchParams())).status, 200)
  delete data.getSessions
  assert.throws(() => makeProviderRoutes(data), /synthetic: missing handler for GET \/api\/sessions/)
})
