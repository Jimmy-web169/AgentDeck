import { temporaryDirectory } from '../../../helpers/tmpConfigDir.ts'
// Original groups remain named below; test assertions are unchanged.
import test from 'node:test'
import { describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { uriToPath } from '../../../../server/providers/antigravity/sqlite.ts'
import { buildIndex, listProjects, childrenOf, cwdForId, invalidateIndex, isSessionId, NO_CWD } from '../../../../server/providers/antigravity/paths.ts'

describe('antigravity/antigravity/paths', async () => {
  // The Antigravity (agy) provider reads an unpublished format: JSONL transcripts
  // under brain/<id>/ plus protobuf blobs in SQLite. These tests pin the parts
  // that do not need node:sqlite — transcript pairing, noise stripping, the
  // sub-agent links read from the transcripts, the raw protobuf decoder — on
  // the fictional fixture in spec/fixtures/antigravity/.

  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

  const FX = path.join(REPO, 'spec', 'fixtures', 'antigravity')

  const PARENT = '7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f'

  const CHILD = 'c3a9f0d4-2b1e-4f6a-9c8d-5e7f1a2b3c4d'

  // ---- discovery + links (a brain/ tree built from the fixture, no SQLite) ------------

  function makeHome() {
    const home = temporaryDirectory('agentdeck-agy-')
    for (const [id, file] of [
      [PARENT, 'session-7d1c4e2a.jsonl'],
      [CHILD, 'child-c3a9f0d4.jsonl'],
    ]) {
      const logs = path.join(home, 'brain', id, '.system_generated', 'logs')
      fs.mkdirSync(logs, { recursive: true })
      fs.copyFileSync(path.join(FX, file), path.join(logs, 'transcript_full.jsonl'))
    }
    fs.mkdirSync(path.join(home, 'brain', 'not-a-session'), { recursive: true }) // ignored: not a UUID
    return home
  }

  test('paths: the child is linked to its parent from the transcripts alone and inherits the spawn workspace', () => {
    const home = makeHome()
    invalidateIndex(home)
    const { byId } = buildIndex(home)
    assert.deepEqual([...byId.keys()].sort(), [CHILD, PARENT].sort())
    const child = byId.get(CHILD)
    assert.ok(child)
    assert.equal(child.parentId, PARENT, 'send_message Recipient → parent')
    assert.ok(child)
    assert.equal(child.isSubagent, true)
    assert.deepEqual(
      childrenOf(home, PARENT).map((c) => c.id),
      [CHILD]
    )
    // neither has a SQLite sidecar or a last_conversations entry: the parent lands in
    // the no-workspace bucket, the child takes the workspaceUris of its spawn record
    assert.equal(cwdForId(home, PARENT), null)
    assert.equal(cwdForId(home, CHILD), uriToPath('file:///home/demo/code/orbit-api'))
    const projects = listProjects(home)
    assert.ok(
      projects.some((p) => p.slug === NO_CWD && p.cwd === null),
      'a "(no workspace)" project exists'
    )
    const ws = projects.find((p) => p.slug !== NO_CWD)
    assert.ok(ws)
    assert.equal(ws.sessionCount, 0, 'sub-agents are not counted as sessions of their workspace')
  })

  test('paths: cache/last_conversations.json supplies the workspace the sidecar cannot', () => {
    const home = makeHome()
    fs.mkdirSync(path.join(home, 'cache'), { recursive: true })
    const cwd = process.platform === 'win32' ? 'C:\\demo\\orbit-api' : '/home/demo/code/orbit-api'
    fs.writeFileSync(path.join(home, 'cache', 'last_conversations.json'), JSON.stringify({ [cwd]: PARENT }))
    invalidateIndex(home)
    assert.equal(cwdForId(home, PARENT), cwd)
    assert.equal(cwdForId(home, CHILD), cwd, 'the child inherits the parent workspace over its own spawn URI')
    assert.ok(!listProjects(home).some((p) => p.slug === NO_CWD), 'no orphan bucket once every session has a workspace')
  })

  test('paths: isSessionId accepts brain dir names only', () => {
    assert.equal(isSessionId(PARENT), true)
    assert.equal(isSessionId('not-a-session'), false)
    assert.equal(isSessionId(`${PARENT}/x`), false)
  })
})
