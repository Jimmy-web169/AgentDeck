import test from 'node:test'
import assert from 'node:assert/strict'
import { decideUpdate } from '../../scripts/update-providers.ts'

const never = async () => {
  throw new Error('the prompt must not be shown')
}

test('make all asks before updating provider CLIs and a plain Enter means no', async () => {
  const asked: string[] = []
  const answering = (answer: string) => async (question: string) => {
    asked.push(question)
    return answer
  }
  for (const yes of ['y', 'Y', 'yes', ' YES '])
    assert.equal((await decideUpdate({ ask: true, env: {}, interactive: true, prompt: answering(yes) })).run, true, yes)
  for (const no of ['', 'n', 'N', 'no', 'later'])
    assert.equal((await decideUpdate({ ask: true, env: {}, interactive: true, prompt: answering(no) })).run, false, no)
  assert.match(asked[0], /\[y\/N\]/)
  assert.equal(asked.length, 9)
})

test('environment answers and non-interactive shells never hold startup on a question', async () => {
  assert.deepEqual(await decideUpdate({ ask: true, env: { AGENTDECK_SKIP_UPDATE: '1' }, interactive: true, prompt: never }), {
    run: false,
    reason: 'skipped (AGENTDECK_SKIP_UPDATE=1)',
  })
  assert.equal((await decideUpdate({ ask: true, env: { AGENTDECK_UPDATE: '1' }, interactive: false, prompt: never })).run, true)
  const quiet = await decideUpdate({ ask: true, env: {}, interactive: false, prompt: never })
  assert.equal(quiet.run, false)
  assert.match(quiet.reason, /AGENTDECK_UPDATE=1/)
  // `make update` (no --ask) still updates outright unless skipped
  assert.equal((await decideUpdate({ ask: false, env: {}, interactive: false, prompt: never })).run, true)
  assert.equal((await decideUpdate({ ask: false, env: { AGENTDECK_SKIP_UPDATE: '1' }, interactive: true, prompt: never })).run, false)
})
