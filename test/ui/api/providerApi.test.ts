import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createApi, ProviderApiContext, useProviderApi, useProviderLabel, useProviderResume } from '../../../src/api/providerApi.ts'

function ProviderCopy() {
  return createElement('span', null, [useProviderApi().provider, useProviderLabel(), useProviderResume()].join(' / '))
}

test('provider context retains the default client and provider-specific CLI copy', () => {
  assert.equal(renderToStaticMarkup(createElement(ProviderCopy)), '<span>codex / Codex / codex resume</span>')
  for (const [provider, expected] of [
    ['claude', 'claude / Claude Code / codex resume'],
    ['codex', 'codex / Codex / codex resume'],
    ['antigravity', 'antigravity / Antigravity / agy --conversation'],
  ])
    assert.equal(
      renderToStaticMarkup(createElement(ProviderApiContext.Provider, { value: createApi(provider) }, createElement(ProviderCopy))),
      '<span>' + expected + '</span>'
    )
})

test('unsupported provider creation fails synchronously before any request', () => {
  for (const provider of ['missing', 'toString', '__proto__', '']) assert.throws(() => createApi(provider), { message: 'unsupported provider: ' + provider })
})
