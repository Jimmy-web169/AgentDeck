import { temporaryDirectory, withConfigDir } from '../../../helpers/tmpConfigDir.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addRoot, invalidateIndex } from '../../../../server/providers/antigravity/paths.ts'
import { conversationFromLog, launchLogFile, prepareAntigravityLaunch, resolveAntigravitySession } from '../../../../server/providers/antigravity/terminal.ts'

// agy names the conversation it runs in its own per-process log. AgentDeck
// gives each launch its own log file, so the binding is exact on Windows too,
// where the process tree (the POSIX evidence) cannot be read.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const FX = path.join(REPO, 'spec', 'fixtures', 'antigravity')
const PARENT = '7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f'
const CHILD = 'c3a9f0d4-2b1e-4f6a-9c8d-5e7f1a2b3c4d'
const STRANGER = '11111111-2222-4333-8444-555555555555'

function makeHome() {
  const home = temporaryDirectory('agentdeck-agy-terminal-')
  for (const [id, file] of [
    [PARENT, 'session-7d1c4e2a.jsonl'],
    [CHILD, 'child-c3a9f0d4.jsonl'],
  ]) {
    const logs = path.join(home, 'brain', id, '.system_generated', 'logs')
    fs.mkdirSync(logs, { recursive: true })
    fs.copyFileSync(path.join(FX, file), path.join(logs, 'transcript_full.jsonl'))
  }
  return home
}
const line = (text: string) => `I0913 15:25:30.635178      972 server.go:1177] ${text}\n`

test('each launch gets its own agy log file inside the CLI home, and only the real home may launch', () => {
  const home = path.join(os.homedir(), '.gemini', 'antigravity-cli')
  const prepared = prepareAntigravityLaunch({ configDir: home, key: 'antigravity|root|launch|one' })
  assert.deepEqual(prepared.args, ['--log-file', launchLogFile(home, 'antigravity|root|launch|one')])
  assert.equal(prepared.meta.logFile, prepared.args[1])
  assert.equal(path.dirname(prepared.meta.logFile), path.join(home, 'log'))
  assert.match(path.basename(prepared.meta.logFile), /^agentdeck-[0-9a-f]{16}\.log$/)
  assert.notEqual(launchLogFile(home, 'antigravity|root|launch|one'), launchLogFile(home, 'antigravity|root|launch|two'))
  assert.throws(() => prepareAntigravityLaunch({ configDir: temporaryDirectory('agentdeck-agy-other-'), key: 'k' }), { status: 409 })
})

test('the log names the conversation the process runs: created, resumed or found active; listings are not evidence', () => {
  const dir = temporaryDirectory('agentdeck-agy-log-')
  const file = path.join(dir, 'agentdeck-test.log')
  assert.equal(conversationFromLog(file), null)
  assert.equal(conversationFromLog(null), null)
  fs.writeFileSync(file, line('Starting new conversation (agent=false)') + line(`found conversation ${STRANGER} (active=false)`))
  assert.equal(conversationFromLog(file), null, 'an inactive listing names nothing')
  fs.appendFileSync(file, line(`Created conversation ${PARENT}`) + line(`GetConversationDetail: found conversation ${PARENT} (active=true)`))
  assert.equal(conversationFromLog(file), PARENT)
  fs.appendFileSync(file, line(`Resuming conversation ${CHILD}`))
  assert.equal(conversationFromLog(file), CHILD, 'the last conversation the process reports wins')
  // only the tail of a long log is read, and the newest report is still found there
  fs.writeFileSync(file, line('noise').repeat(20000) + line(`Created conversation ${PARENT}`))
  assert.equal(conversationFromLog(file), PARENT)
})

test('a terminal binds to the conversation its log names when that conversation exists and is not a sub-agent', async () => {
  const config = temporaryDirectory('agentdeck-agy-config-')
  const home = makeHome()
  const logs = path.join(home, 'log')
  fs.mkdirSync(logs)
  await withConfigDir(config, async () => {
    invalidateIndex(home)
    const { id: root } = addRoot(home, 'agy')
    const meta = { root, cwd: '/home/demo/code/orbit-api', title: 'New conversation', launchId: 'l1' }
    const logFile = path.join(logs, 'agentdeck-1.log')
    const resolve = (extra: Record<string, unknown> = {}) => resolveAntigravitySession({ meta: { ...meta, logFile, ...extra }, files: () => [] })
    assert.equal(resolve(), null, 'no log yet: nothing to bind, the terminal stays attachable')
    fs.writeFileSync(logFile, line(`Created conversation ${STRANGER}`))
    assert.equal(resolve(), null, 'a conversation the home does not hold is not bound')
    fs.writeFileSync(logFile, line(`Created conversation ${CHILD}`))
    assert.equal(resolve(), null, 'a sub-agent conversation is never a terminal’s conversation')
    fs.writeFileSync(logFile, line(`Created conversation ${PARENT}`))
    assert.deepEqual(resolve(), { id: PARENT, slug: meta.cwd, cwd: meta.cwd, title: 'New conversation' })
    assert.equal(resolve({ id: PARENT }), null, 'an identified terminal is never rebound')
    assert.equal(resolveAntigravitySession({ meta, files: () => [] }), null, 'without a log file the process evidence decides, and here there is none')
  })
})
