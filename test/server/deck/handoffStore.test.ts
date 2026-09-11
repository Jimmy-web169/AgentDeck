import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { openHandoffStore } from '../../../server/deck/handoffStore.ts'
import { applyStateMigration } from '../../../server/shared/state.ts'
import { temporaryDirectory } from '../../helpers/tmpConfigDir.ts'

test('portable exports share legacy fallback and pending-migration ownership with briefs', () => {
  const base = temporaryDirectory('handoff-state-owner-')
  const legacy = path.join(base, 'handoffs'),
    current = path.join(base, '.agentdeck', 'handoffs')
  fs.mkdirSync(legacy)
  fs.writeFileSync(path.join(legacy, 'brief.md'), 'Keep the legacy brief.\n')
  const save = (store: ReturnType<typeof openHandoffStore>) =>
    store.save({
      header: {
        type: 'handoff',
        handoff: {
          version: 1,
          readingGuide: [],
          exportId: crypto.randomUUID(),
          exportedAt: '2026-09-10T00:00:00.000Z',
          projectName: 'migration',
          sourceProvider: 'future',
          task: null,
          history: { complete: true, messages: 1, conversations: 1, includes: ['messages'], excludes: [], warnings: [] },
        },
      },
      records: [{ type: 'message', text: 'Portable history' }],
      source: { provider: 'future', root: 'r', id: 'session' },
      cwd: base,
    })
  const first = save(openHandoffStore(base))
  assert.equal(path.dirname(first.file), legacy)
  assert.equal(fs.existsSync(current), false)
  const bytes = fs.readFileSync(first.file)
  fs.mkdirSync(current, { recursive: true })
  fs.copyFileSync(first.file, path.join(current, first.filename))
  fs.writeFileSync(path.join(current, '.migration-pending'), 'Interrupted copy\n')
  const pending = openHandoffStore(base)
  assert.equal(path.dirname(pending.verify(first.id).file), legacy)
  const second = save(pending)
  assert.equal(path.dirname(second.file), legacy)
  applyStateMigration(base)
  const migrated = openHandoffStore(base)
  for (const item of [first, second]) assert.equal(path.dirname(migrated.verify(item.id).file), current)
  assert.deepEqual(fs.readFileSync(migrated.verify(first.id).file), bytes)
  assert.deepEqual(fs.readFileSync(first.file), bytes, 'original remains readable')
  assert.equal(fs.readFileSync(path.join(current, 'brief.md'), 'utf8'), 'Keep the legacy brief.\n')
})
