import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'
// Original test group: dispatch. Assertions retained during module-path migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeDispatch } from '../../../server/shared/dispatch.ts'
import { makeFixture as generateFixture } from '../../helpers/fixture.ts'

const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime()

test('dispatch: routes by "METHOD /path", 404 for unknown, errors keep their status', async () => {
  const dispatch = makeDispatch({
    'GET /api/ok': (q) => ({ ok: true, root: q.get('root') }),
    'POST /api/echo': (_q, body) => body,
    'GET /api/teapot': () => {
      const e = Object.assign(new Error('short and stout'), { status: 418 })
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
  assert.match((miss.body as { error: string }).error, /no route: DELETE \/api\/ok/)
})

test('dispatch: every provider exposes the shared route set', async () => {
  // a config dir of its own with one generated root per provider: on a CI runner
  // there is no ~/.claude, and "No tracked folders" would replace "Unknown root"
  const { PROVIDERS } = await import('../../../server/registry.ts')
  const out = path.join(temporaryDirectory('agentdeck-dispatch-'), 'root')
  generateFixture({ out, scenario: 'single-project', seed: 7, now: NOW, platform: 'posix' })
  const prev = process.env.AGENTDECK_CONFIG_DIR
  process.env.AGENTDECK_CONFIG_DIR = out
  try {
    for (const id of ['claude', 'codex', 'antigravity']) {
      // an unknown path must be a clean 404, never a throw
      const r = await PROVIDERS[id].dispatch('GET', '/api/definitely-not-a-route', new URLSearchParams())
      assert.equal(r.status, 404, id)
      // a bad root id on a shared endpoint is a 404 from resolveRoot, not a crash
      const s = await PROVIDERS[id].dispatch('GET', '/api/activity', new URLSearchParams('root=nope&days=7'))
      assert.equal(s.status, 404, `${id}: ${JSON.stringify(s.body)}`)
      assert.match((s.body as { error: string }).error, /Unknown root/)
    }
  } finally {
    if (prev === undefined) delete process.env.AGENTDECK_CONFIG_DIR
    else process.env.AGENTDECK_CONFIG_DIR = prev
    fs.rmSync(path.dirname(out), { recursive: true, force: true })
  }
})
