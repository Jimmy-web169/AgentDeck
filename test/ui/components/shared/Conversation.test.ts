// @vitest-environment jsdom
import { createElement } from 'react'
import { test, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import Conversation from '../../../../src/components/shared/Conversation.tsx'
import { mockNavSession } from '../../../helpers/query.ts'
afterEach(cleanup)

test('prompt navigation reveals unloaded history and controls only the nearest transcript pane', () => {
  const data = {
    summary: mockNavSession({ id: 'jump-history' }),
    timeline: Array.from({ length: 100 }, (_, index) => ({ kind: 'user' as const, text: `Prompt ${index}` })),
  }
  const view = render(
    createElement(
      'div',
      { style: { overflowY: 'auto' }, 'data-testid': 'outer' },
      createElement(
        'div',
        { style: { overflowY: 'auto' }, 'data-testid': 'pane' },
        createElement(Conversation, {
          data,
          renderEvent: (event, index) =>
            index === 60
              ? createElement(
                  'div',
                  null,
                  createElement('p', null, event.text),
                  createElement(
                    'div',
                    { className: 'conversation-content' },
                    createElement('div', { 'data-conversation-index': 98, tabIndex: -1 }, 'Nested prompt 98')
                  )
                )
              : createElement('p', null, event.text),
        })
      )
    )
  )
  const pane = view.getByTestId('pane')
  const outer = view.getByTestId('outer')
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 2000 })
  outer.scrollTop = 73
  expect(view.queryByText('Prompt 0')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Jump to a user prompt' }))
  const trigger = view.getByRole('button', { name: 'Jump to a user prompt' })
  expect(document.activeElement).toBe(view.getByRole('button', { name: '1 Prompt 0' }))
  expect(document.getElementById(trigger.getAttribute('aria-controls') || '')?.contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  fireEvent.pointerDown(outer)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  const firstButton = view.getByRole('button', { name: 'Jump to first message' })
  firstButton.focus()
  let escaped = false
  const sharedEscape = () => {
    escaped = true
  }
  window.addEventListener('keydown', sharedEscape)
  try {
    fireEvent.keyDown(firstButton, { key: 'Escape' })
    expect(document.activeElement).toBe(firstButton)
    expect(escaped).toBe(true)
  } finally {
    window.removeEventListener('keydown', sharedEscape)
  }
  fireEvent.click(trigger)
  fireEvent.click(view.getByRole('button', { name: '99 Prompt 98' }))
  expect(document.activeElement).toBe(view.getByText('Prompt 98').parentElement)
  fireEvent.click(view.getByRole('button', { name: 'Jump to a user prompt' }))
  fireEvent.click(view.getByRole('button', { name: '1 Prompt 0' }))
  expect(view.getByText('Prompt 0')).toBeTruthy()
  expect(document.activeElement?.getAttribute('data-conversation-index')).toBe('0')
  fireEvent.click(view.getByRole('button', { name: 'Jump to latest message' }))
  expect(pane.scrollTop).toBe(2000)
  fireEvent.click(view.getByRole('button', { name: 'Jump to first message' }))
  expect(pane.scrollTop).toBe(0)
  expect(outer.scrollTop).toBe(73)
})

test('omitted provider events do not leave empty spacing wrappers', () => {
  const data = { summary: mockNavSession({ id: 'omitted-event' }), timeline: [{ kind: 'system' as const, text: 'hidden' }] }
  const view = render(createElement(Conversation, { data, renderEvent: () => null }))
  expect(view.container.querySelector('[data-conversation-index]')).toBeNull()
})
