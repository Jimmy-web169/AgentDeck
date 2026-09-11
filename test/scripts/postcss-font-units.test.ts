import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import fontUnits from '../../scripts/postcss-font-units.ts'

describe('postcss-font-units', () => {
  test('legacy px typography scales with rem text, without changing pixel geometry', async () => {
    const result = await postcss([fontUnits()]).process(
      '.text { font-size:13px; line-height:18px; width:300px; border:1px solid; } .relative {font-size:1rem;line-height:1.5}',
      { from: undefined }
    )
    assert.match(result.css, /font-size:0.8125rem/)
    assert.match(result.css, /line-height:1.125rem/)
    assert.match(result.css, /width:300px/)
    assert.match(result.css, /border:1px solid/)
    assert.match(result.css, /font-size:1rem;line-height:1.5/)
  })

  test('generated Tailwind arbitrary font utilities also pass through the typography normalizer', async () => {
    const result = await postcss([
      tailwindcss({ content: [{ raw: '<div class="text-[13px] text-sm leading-[18px]"></div>' }], corePlugins: { preflight: false } }),
      fontUnits(),
    ]).process('@tailwind utilities;', { from: undefined })
    assert.match(result.css, /font-size: 0.8125rem/)
    assert.match(result.css, /font-size: 0.875rem/)
    assert.match(result.css, /line-height: 1.125rem/)
    assert.doesNotMatch(result.css, /(?:font-size|line-height):[^;}]*px/)
  })
})
