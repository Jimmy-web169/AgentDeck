import { test } from 'vitest'
import assert from 'node:assert/strict'
import { type Attributes, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeSourceLabel } from '../../../../src/components/shared/HomeSourceLabel.tsx'
const render = (
  props:
    | (Attributes & {
        source: { provider?: string; root?: string; rootLabel?: string }
        providers: readonly import('../../../../src/lib/providerColors.ts').ColorProvider[]
      })
    | null
    | undefined
) => renderToStaticMarkup(createElement(HomeSourceLabel, props))
test('source labels preserve the registered provider, account label and safe fallback text', () => {
  const providers = [{ id: 'future', label: 'Future AI' }]
  const html = render({ providers, source: { provider: 'future', root: 'r', rootLabel: 'Work <root>' } })
  assert.match(html, /Future AI/)
  assert.match(html, /Work &lt;root&gt;/)
  assert.match(html, /text-zinc-500/)
  const fallback = render({ providers, source: { provider: 'unregistered', root: 'account-id' } })
  assert.match(fallback, /unregistered/)
  assert.match(fallback, /account-id/)
})
