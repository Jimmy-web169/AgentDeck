import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import postcss from 'postcss'

const css = postcss.parse(fs.readFileSync('src/components/shared/conversationLayout.css', 'utf8'))
function declarations(selector) {
  const result = {}
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls((d) => { result[d.prop] = d.value })
  })
  return result
}

test('long prose and advisor payloads wrap within the transcript, without globally hiding overflow', () => {
  assert.equal(declarations('.conversation-content').width, '100%')
  assert.equal(declarations('.conversation-content')['min-width'], '0')
  for (const selector of ['.conversation-content', '.conversation-content .md', '.conversation-content .whitespace-pre-wrap']) {
    assert.equal(declarations(selector)['overflow-wrap'], 'anywhere')
  }
  css.walkRules((rule) => {
    assert.ok(rule.selectors.every((s) => s.startsWith('.conversation-content')))
    rule.walkDecls((d) => {
      assert.ok(!['font-size', 'color'].includes(d.prop), 'layout fix does not change typography')
      assert.ok(!['hidden', 'clip'].includes(d.value), 'do not solve wrapping by losing content')
    })
  })
})

test('code and tables scroll only within their bounded blocks; metadata wraps', () => {
  for (const selector of ['.conversation-content pre', '.conversation-content .md table']) {
    assert.equal(declarations(selector)['max-width'], '100%')
    assert.equal(declarations(selector)['overflow-x'], 'auto')
  }
  assert.equal(declarations('.conversation-content .md table').display, 'block')
  assert.equal(declarations('.conversation-content .conversation-message-meta')['flex-wrap'], 'wrap')
})

const compiled = await build({ stdin: { contents: `
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ClaudeConversation from './src/components/claude/Conversation.jsx'
import SharedConversation from './src/components/codex/Conversation.jsx'
import { ProviderApiContext } from './src/lib/providerApi.js'
export const render = (provider, data, compact) => renderToStaticMarkup(createElement(ProviderApiContext.Provider, { value: { provider } }, createElement(provider === 'claude' ? ClaudeConversation : SharedConversation, { data, compact })))
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.css': 'empty' } })
const bundled = { exports: {} }
Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
const { render } = bundled.exports
const token = 'OpaquePayload'.repeat(3000)
for (const provider of ['claude', 'codex', 'antigravity']) {
  for (const compact of [false, true]) {
    test(`${provider} ${compact ? 'inline subagent' : 'main'} conversation applies width rules without truncating text`, () => {
      const data = { summary: { id: 'layout-test', title: 'Long history', models: [], tokens: {} }, timeline: [
        { kind: 'user', text: token },
        { kind: 'assistant', parts: [{ kind: provider === 'claude' ? 'advisor' : 'text', text: token }] },
      ] }
      const html = render(provider, data, compact)
      assert.match(html, /class="conversation-content /)
      assert.match(html, /class="conversation-message-meta /)
      assert.equal(html.split(token).length - 1, 2, 'both complete payloads remain readable/copyable')
      if (provider === 'claude') assert.match(html, />advisor<\/div>/)
    })
  }
}
