import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const compiled = await build({ stdin: { contents: `
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionRow } from './src/components/shared/HomeView.jsx'
export const render = (s, prefs = {}) => renderToStaticMarkup(createElement(SessionRow, { s, providers: [], live: { ids: new Set() }, termKeys: new Set(), onOpen() {}, ...prefs }))
`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', loader: { '.css': 'empty' } })
const bundled = { exports: {} }
Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
const { render } = bundled.exports

test('session row shows only latest question, with no First/Latest label, escaping user text', () => {
  const html = render({ provider: 'codex', root: 'r', id: 's', title: 'Session name', firstPrompt: 'First question', lastUserPrompt: 'Latest <script>question</script>' })
  assert.match(html, /Session name/)
  assert.match(html, /data-question-preview="latest"/)
  assert.match(html, /data-question-preview="latest" class="[^"]*text-zinc-500/)
  assert.match(html, /<span class="[^"]*text-zinc-200[^"]*">Session name<\/span>/)
  assert.match(html, /Latest &lt;script&gt;question&lt;\/script&gt;/)
  assert.doesNotMatch(html, /data-question-preview="first"|First question|>Latest<|>First</)
  assert.doesNotMatch(html, /<script>/)
})

test('first question is not shown as a redundant extra line when equal to latest', () => {
  const html = render({ provider: 'codex', root: 'r', id: 's', title: 'Session name', firstPrompt: 'Same question', lastUserPrompt: 'Same question' })
  assert.match(html, /data-question-preview="latest"/)
  assert.doesNotMatch(html, /data-question-preview="first"/)
})

for (const showLatestPrompt of [true, false]) {
    test(`only latest question is controlled by visibility=${showLatestPrompt}`, () => {
      const html = render({ title: 'Session name', firstPrompt: 'Opening question', lastUserPrompt: 'Most recent question' }, { showLatestPrompt })
      assert.equal(html.includes('data-question-preview="latest"'), showLatestPrompt)
      assert.equal(html.includes('data-question-preview="first"'), false)
      assert.equal(html.includes('Most recent question'), showLatestPrompt)
      assert.equal(html.includes('Opening question'), false)
      assert.match(html, /Session name/)
    })
}

test('hiding latest or missing latest never falls back to first question', () => {
  const html = render({ title: 'Session name', firstPrompt: 'Same question', lastUserPrompt: 'Same question' }, { showLatestPrompt: false })
  assert.doesNotMatch(html, /data-question-preview="first"/)
  assert.doesNotMatch(html, /data-question-preview="latest"/)
  assert.doesNotMatch(render({ title: 'Same question', firstPrompt: 'Same question' }), /data-question-preview/)
  assert.doesNotMatch(render({ title: 'Empty session' }), /data-question-preview/)
  assert.doesNotMatch(render({ title: 'Session title', firstPrompt: 'Opening question' }), /Opening question|data-question-preview/)
  assert.doesNotMatch(render({ title: 'Same question', lastUserPrompt: 'Same question' }), /data-question-preview/, 'title already shows the latest question')
})
