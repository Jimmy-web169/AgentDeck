import { mockNavSession } from '../../../helpers/query.ts'
import { renderWithQuery as renderDom, mockProviderApi } from '../../../helpers/query.ts'
// @vitest-environment jsdom
import { createElement } from 'react'
import { test, vi, afterEach, describe } from 'vitest'
import { cleanup } from '@testing-library/react'
import assert from 'node:assert/strict'
import Conversation from '../../../../src/components/claude/Conversation.tsx'
import { ProviderApiContext } from '../../../../src/api/index.ts'

describe('conversation-layout', () => {
  const render = (provider: string, data: import('../../../../src/api/models.ts').ConversationData, compact: boolean) =>
    renderDom(createElement(ProviderApiContext.Provider, { value: mockProviderApi(provider, {}) }, createElement(Conversation, { data, compact }))).container
      .innerHTML

  const token = 'OpaquePayload'.repeat(3000)
  for (const provider of ['claude']) {
    for (const compact of [false, true]) {
      test(`${provider} ${compact ? 'inline subagent' : 'main'} conversation applies width rules without truncating text`, () => {
        const data: import('../../../../src/api/models.ts').ConversationData = {
          summary: mockNavSession({ id: 'layout-test', title: 'Long history' }),
          timeline: [
            { kind: 'user', text: token },
            { kind: 'assistant', parts: [{ kind: provider === 'claude' ? 'advisor' : 'text', text: token }] },
          ],
        }
        const html = render(provider, data, compact)
        assert.match(html, /class="conversation-content /)
        assert.match(html, /class="conversation-message-meta /)
        assert.equal(html.split(token).length - 1, 2, 'both complete payloads remain readable/copyable')
        if (provider === 'claude') assert.match(html, />advisor<\/div>/)
      })
    }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})
