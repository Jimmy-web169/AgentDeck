import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import fontUnits from '../scripts/postcss-font-units.mjs'

test('legacy px typography scales with rem text, without changing pixel geometry', async () => {
  const result = await postcss([fontUnits()]).process('.text { font-size:13px; line-height:18px; width:300px; border:1px solid; } .relative {font-size:1rem;line-height:1.5}', { from: undefined })
  assert.match(result.css, /font-size:0.8125rem/)
  assert.match(result.css, /line-height:1.125rem/)
  assert.match(result.css, /width:300px/)
  assert.match(result.css, /border:1px solid/)
  assert.match(result.css, /font-size:1rem;line-height:1.5/)
})

test('generated Tailwind arbitrary font utilities also pass through the typography normalizer', async () => {
  const result = await postcss([tailwindcss({ content: [{ raw: '<div class="text-[13px] text-sm leading-[18px]"></div>' }], corePlugins: { preflight: false } }), fontUnits()]).process('@tailwind utilities;', { from: undefined })
  assert.match(result.css, /font-size: 0.8125rem/)
  assert.match(result.css, /font-size: 0.875rem/)
  assert.match(result.css, /line-height: 1.125rem/)
  assert.doesNotMatch(result.css, /(?:font-size|line-height):[^;}]*px/)
})

test('first paint restores only supported font sizes and tolerates unavailable storage', () => {
  const script = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  for (const size of [90, 100, 110, 125, 150, 0, '150', 999]) {
    const root = { dataset: {}, style: {} }
    vm.runInNewContext(script, { document: { documentElement: root }, localStorage: { getItem: (key) => key === 'agentdeck_prefs' ? JSON.stringify({ fontSize: size }) : null } })
    assert.equal(root.style.fontSize, [90, 100, 110, 125, 150].includes(size) ? `${size}%` : undefined)
  }
  assert.doesNotThrow(() => vm.runInNewContext(script, { localStorage: { getItem() { throw Error('blocked') } } }))
})
