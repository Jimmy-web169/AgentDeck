import { required } from '../../../helpers/assert.ts'
// @vitest-environment jsdom
import { createElement } from 'react'
import { test, vi, afterEach, describe } from 'vitest'
import { render as renderDom, cleanup } from '@testing-library/react'
import assert from 'node:assert/strict'
import conversationCss from '../../../../src/components/shared/conversationLayout.css?inline'

describe('conversation-layout', () => {
  function conversationFixture() {
    const { container } = renderDom(
      createElement(
        'div',
        null,
        createElement('style', null, conversationCss),
        createElement(
          'div',
          { className: 'conversation-content' },
          createElement(
            'div',
            { className: 'md' },
            'Long prose ',
            createElement('pre', null, 'const payload = "complete"'),
            createElement('table', null, createElement('tbody', null, createElement('tr', null, createElement('td', null, 'A wide cell'))))
          ),
          createElement('div', { className: 'whitespace-pre-wrap' }, 'advisor payload'),
          createElement('div', { className: 'conversation-message-meta' }, 'model / timestamp')
        ),
        createElement('div', { className: 'outside' }, 'Unrelated chrome')
      )
    )
    return (selector: string) => getComputedStyle(required(container.querySelector(selector)))
  }

  test('long prose and advisor payloads wrap within the transcript, without globally hiding overflow', () => {
    const style = conversationFixture()
    assert.equal(style('.conversation-content').width, '100%')
    assert.equal(style('.conversation-content').minWidth, '0')
    for (const selector of ['.conversation-content', '.md', '.whitespace-pre-wrap']) {
      assert.equal(style(selector).overflowWrap, 'anywhere')
      assert.ok(!['hidden', 'clip'].includes(style(selector).overflow))
    }
    assert.notEqual(style('.outside').overflowWrap, 'anywhere', 'transcript rules stay scoped')
    assert.equal(style('.conversation-content').fontSize, style('.outside').fontSize)
    assert.equal(style('.conversation-content').color, style('.outside').color)
  })

  test('code and tables scroll only within their bounded blocks; metadata wraps', () => {
    const style = conversationFixture()
    for (const selector of ['pre', 'table']) {
      assert.equal(style(selector).maxWidth, '100%')
      assert.equal(style(selector).overflowX, 'auto')
    }
    assert.equal(style('table').display, 'block')
    assert.equal(style('.conversation-message-meta').flexWrap, 'wrap')
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})
