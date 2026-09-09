import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { HOME_VIEWS, loadTabs, TABS_KEY } from '../src/lib/tabs.js'
import { fromHash, toHash } from '../src/lib/route.js'

const compiled = await build({ stdin: { contents: `
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Actions from './src/components/shared/HandoffActions.jsx'
import Dialog from './src/components/shared/ConversationHandoffDialog.jsx'
export const actions = (props) => renderToStaticMarkup(createElement(Actions, props))
export const dialog = (mode) => renderToStaticMarkup(createElement(Dialog, { mode, source: { provider: 'future', root: 'r', id: 's', cwd: '/current/project', title: 'Work' }, providers: [], onOpen() {}, onClose() {} }))
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic' })
const module = { exports: {} }
Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { actions, dialog } = module.exports

test('saved conversations have two local actions; unsaved conversations have neither', () => {
  const html = actions({ provider: 'future', root: 'r', id: 's' })
  assert.match(html, /Continue with another AI/)
  assert.match(html, /Export JSONL/)
  assert.equal(actions({ provider: 'future', root: 'r' }), '')
  for (const provider of ['claude', 'codex']) {
    const panel = fs.readFileSync(`src/components/${provider}/TerminalPanel.jsx`, 'utf8')
    assert.equal((panel.match(/<HandoffActions /g) || []).length, 4, 'actions remain available in collapsed, hidden, popped and embedded terminal states')
  }
})

test('export-only and send dialogs explain full history and have no draft/approval workflow', () => {
  const exported = dialog('export'), sending = dialog('send')
  assert.match(exported, /Save JSONL only/)
  assert.doesNotMatch(exported, /Receiving AI \/ root/)
  assert.match(exported, /Exporting does not start or send anything/)
  assert.match(sending, /Receiving AI \/ root/)
  assert.match(sending, /Save JSONL &amp; open new tab/)
  assert.match(sending, /The new AI uses the same folder/)
  for (const html of [exported, sending]) {
    assert.doesNotMatch(html, /Approve snapshot|Create staging draft|Last visible messages/)
    assert.match(html, /including subagent conversations/)
    assert.match(html, /\.agentdeck\/handoffs/)
    assert.doesNotMatch(html, /<input[^>]*value="\/current\/project"/, 'folder is not an editable launch field')
  }
})

test('global context navigation is retired; old links and persisted context tabs land safely on Activity', () => {
  assert.equal(HOME_VIEWS.some((v) => v.k === 'context'), false)
  assert.equal(toHash({ kind: 'context', contextId: 'old' }), '#/')
  assert.deepEqual(fromHash('#/context/old', ['claude']), { provider: null, view: 'activity' })
  const oldStorage = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: (key) => key === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'old', target: { kind: 'context', contextId: 'old' } }], activeKey: 'old' }) : null }
    assert.deepEqual(loadTabs().tabs[0].target, { provider: null, view: 'activity', focus: null })
  } finally { if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage }
  assert.doesNotMatch(fs.readFileSync('src/components/shared/TabStrip.jsx', 'utf8'), /onHandoff|canHandoff/)
})
