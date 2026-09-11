// @vitest-environment jsdom
import React from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { test, expect, afterEach } from 'vitest'
import { useSessionPane } from '../../src/lib/useSessionPane.ts'
afterEach(cleanup)
function Pane(props: Parameters<typeof useSessionPane>[0] & { height: number }) {
  const { mainRef, onScroll } = useSessionPane<HTMLElement>(props)
  return React.createElement(
    'main',
    {
      ref: (node) => {
        if (node) {
          Object.defineProperty(node, 'clientHeight', { configurable: true, value: 200 })
          Object.defineProperty(node, 'scrollHeight', { configurable: true, value: props.height })
        }
        mainRef.current = node
      },
      onScroll,
      'data-testid': 'pane',
    },
    props.id
  )
}
test('pane positions remain account-scoped, restore on return, and follow appends only at the bottom', () => {
  const options = { provider: 'codex', root: 'a', id: 'one', view: 'conversation', height: 1000, data: { timeline: [] } }
  const view = render(React.createElement(Pane, options)),
    el = view.getByTestId('pane')
  expect(el.scrollTop).toBe(1000)
  el.scrollTop = 120
  fireEvent.scroll(el)
  view.rerender(React.createElement(Pane, { ...options, height: 1500, data: { timeline: [{}] } }))
  expect(el.scrollTop).toBe(120)
  view.rerender(React.createElement(Pane, { ...options, root: 'b' }))
  expect(el.scrollTop).toBe(1000)
  el.scrollTop = 850
  fireEvent.scroll(el)
  view.rerender(React.createElement(Pane, { ...options, root: 'b', height: 1600, data: { timeline: [{}] } }))
  expect(el.scrollTop).toBe(1600)
  view.rerender(React.createElement(Pane, options))
  expect(el.scrollTop).toBe(120)
  view.rerender(React.createElement(Pane, { ...options, root: 'b', height: 1600 }))
  expect(el.scrollTop).toBe(1600)
})
