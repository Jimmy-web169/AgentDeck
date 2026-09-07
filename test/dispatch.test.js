import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDispatch } from '../server/shared/dispatch.js'

test('dispatch: routes by "METHOD /path", 404 for unknown, errors keep their status', async () => {
  const dispatch = makeDispatch({
    'GET /api/ok': (q) => ({ ok: true, root: q.get('root') }),
    'POST /api/echo': (_q, body) => body,
    'GET /api/teapot': () => {
      const e = new Error('short and stout')
      e.status = 418
      throw e
    },
    'GET /api/boom': () => {
      throw new Error('unexpected')
    },
    'GET /api/async': async () => ({ later: 1 }),
  })
  const q = new URLSearchParams('root=abc')
  assert.deepEqual(await dispatch('GET', '/api/ok', q), { status: 200, body: { ok: true, root: 'abc' } })
  assert.deepEqual(await dispatch('POST', '/api/echo', q, { a: 1 }), { status: 200, body: { a: 1 } })
  assert.deepEqual(await dispatch('GET', '/api/teapot', q), { status: 418, body: { error: 'short and stout' } })
  assert.deepEqual(await dispatch('GET', '/api/boom', q), { status: 500, body: { error: 'unexpected' } })
  assert.deepEqual(await dispatch('GET', '/api/async', q), { status: 200, body: { later: 1 } })
  const miss = await dispatch('DELETE', '/api/ok', q)
  assert.equal(miss.status, 404)
  assert.match(miss.body.error, /no route: DELETE \/api\/ok/)
})

test('dispatch: both providers expose the shared route set', async () => {
  const { PROVIDERS } = await import('../server/registry.js')
  for (const id of ['claude', 'codex']) {
    // an unknown path must be a clean 404, never a throw
    const r = await PROVIDERS[id].dispatch('GET', '/api/definitely-not-a-route', new URLSearchParams())
    assert.equal(r.status, 404, id)
    // a bad root id on a shared endpoint is a 404 from resolveRoot, not a crash
    const s = await PROVIDERS[id].dispatch('GET', '/api/activity', new URLSearchParams('root=nope&days=7'))
    assert.equal(s.status, 404, `${id}: ${JSON.stringify(s.body)}`)
    assert.match(s.body.error, /Unknown root/)
  }
})
