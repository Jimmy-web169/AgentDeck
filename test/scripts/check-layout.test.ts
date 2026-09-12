import test from 'node:test'
import assert from 'node:assert/strict'
import { type LayoutBaseline, knownLayoutIssue, layoutIssueKey, waitForSettledScene } from '../../scripts/check-layout.ts'

test('scene readiness accepts late data only when the settled page satisfies the original predicate', async () => {
  const calls: string[][] = []
  const cdp = {
    waitFor: async (predicate: string) => {
      calls.push(['initial', predicate])
      return false
    },
    eval: async (predicate: string) => {
      calls.push(['final', predicate])
      return true
    },
  }
  const predicate = 'pageHasRequiredData'
  assert.equal(
    await waitForSettledScene(cdp, predicate, async () => {
      calls.push(['settled'])
      return true
    }),
    true
  )
  assert.deepEqual(calls, [['initial', predicate], ['settled'], ['final', predicate]])
})

test('scene readiness rejects pending APIs and a page that loses its ready state', async () => {
  const cdp = { waitFor: async () => true, eval: async () => assert.fail('pending API must not be accepted') }
  assert.equal(await waitForSettledScene(cdp, 'ready', async () => false), false)
  assert.equal(await waitForSettledScene({ ...cdp, eval: async () => false }, 'ready', async () => true), false)
  await assert.rejects(
    waitForSettledScene(
      {
        ...cdp,
        eval: async () => {
          throw new Error('CDP closed')
        },
      },
      'ready',
      async () => true
    ),
    /CDP closed/
  )
})

test('layout baselines do not allow platform-specific findings on another operating system', () => {
  const row = { scene: 'stats', theme: 'light', width: 900 }
  const violation = { rule: 'horizontal-clipping', selector: 'main > p' }
  const key = layoutIssueKey(row, violation)
  const baseline: LayoutBaseline = { platforms: ['darwin', 'linux'], known: { [key]: 'WP-5' }, exclusive: { [key]: ['linux'] } }
  assert.equal(knownLayoutIssue(baseline, row, violation, 'linux'), true)
  assert.equal(knownLayoutIssue(baseline, row, violation, 'darwin'), false)
  assert.equal(knownLayoutIssue(baseline, row, violation, 'win32'), false)
  assert.equal(knownLayoutIssue(baseline, row, { ...violation, selector: 'new selector' }, 'linux'), false)
  assert.equal(knownLayoutIssue({ ...baseline, exclusive: {} }, row, violation, 'darwin'), true)
})

test('a contrast capture speaks for every platform; a geometry capture does not', () => {
  const row = { scene: 'session-conversation', theme: 'midnight', width: 1440 }
  const contrast = { rule: 'text-contrast', selector: 'main > span' }
  const clipping = { rule: 'horizontal-clipping', selector: 'main > span' }
  const baseline: LayoutBaseline = {
    platforms: ['darwin', 'linux'],
    known: { [layoutIssueKey(row, contrast)]: 'WP-5', [layoutIssueKey(row, clipping)]: 'WP-5' },
    exclusive: { [layoutIssueKey(row, contrast)]: ['darwin'], [layoutIssueKey(row, clipping)]: ['darwin'] },
  }
  assert.equal(knownLayoutIssue(baseline, row, contrast, 'darwin'), true)
  assert.equal(knownLayoutIssue(baseline, row, contrast, 'linux'), true)
  assert.equal(knownLayoutIssue(baseline, row, clipping, 'darwin'), true)
  assert.equal(knownLayoutIssue(baseline, row, clipping, 'linux'), false)
  // an unrecorded contrast finding is still new, and an unlisted platform stays unfiltered
  assert.equal(knownLayoutIssue(baseline, row, { ...contrast, selector: 'main > em' }, 'linux'), false)
  assert.equal(knownLayoutIssue(baseline, row, contrast, 'win32'), false)
})

test('layout readiness failures are never baselined and legacy captures belong only to darwin', () => {
  const row = { scene: 'stats', theme: 'light', width: 900 }
  const violation = { rule: 'scene-not-ready', selector: 'document' }
  const baseline: LayoutBaseline = { known: { [layoutIssueKey(row, violation)]: 'WP-5' } }
  assert.equal(knownLayoutIssue(baseline, row, violation, 'darwin'), false)
  const clipping = { ...violation, rule: 'horizontal-clipping' }
  baseline.known[layoutIssueKey(row, clipping)] = 'WP-5'
  assert.equal(knownLayoutIssue(baseline, row, clipping, 'darwin'), true)
  assert.equal(knownLayoutIssue(baseline, row, clipping, 'linux'), false)
})
