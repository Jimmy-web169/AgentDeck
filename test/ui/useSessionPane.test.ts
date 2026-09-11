// @vitest-environment jsdom
import React from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { test, expect, afterEach, vi } from 'vitest'
import { useSessionPane } from '../../src/lib/useSessionPane.ts'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
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
test('opening another account or returning shows latest; live appends preserve an active reader above the bottom', () => {
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
  expect(el.scrollTop).toBe(1000)
  view.rerender(React.createElement(Pane, { ...options, root: 'b', height: 1600 }))
  expect(el.scrollTop).toBe(1600)
})

test('hidden panes ignore zero-height scroll events and return to latest with unchanged cached data', () => {
  const options = { provider: 'codex', root: 'a', id: 'one', view: 'conversation', height: 1000, data: { timeline: [] } }
  const view = render(React.createElement(Pane, options))
  const el = view.getByTestId('pane')
  el.scrollTop = 100
  fireEvent.scroll(el)
  view.rerender(React.createElement(Pane, { ...options, active: false, height: 0 }))
  el.scrollTop = 0
  fireEvent.scroll(el)
  view.rerender(React.createElement(Pane, { ...options, active: true }))
  expect(el.scrollTop).toBe(1000)
  view.rerender(React.createElement(Pane, { ...options, view: 'stats' }))
  el.scrollTop = 0
  view.rerender(React.createElement(Pane, options))
  expect(el.scrollTop).toBe(1000)
})

test('upward reader input wins when a layout resize arrives before the next scroll event', () => {
  let resize = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  const options = { provider: 'codex', root: 'a', id: 'one', view: 'conversation', height: 1000, data: {} }
  const view = render(React.createElement(Pane, options))
  const el = view.getByTestId('pane')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1500 })
  resize()
  expect(el.scrollTop).toBe(1500)
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 })
  fireEvent.wheel(el, { deltaY: -100 })
  el.scrollTop = 1200
  resize()
  expect(el.scrollTop).toBe(1200)
  fireEvent.scroll(el)
  view.rerender(React.createElement(Pane, { ...options, height: 2400, data: { updated: true } }))
  expect(el.scrollTop).toBe(1200)
})

test('a margin click on a short pane keeps following content when it later becomes scrollable', () => {
  const options = { provider: 'codex', root: 'a', id: 'short', view: 'conversation', height: 100, data: {} }
  const view = render(React.createElement(Pane, options))
  const el = view.getByTestId('pane')
  fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientX: 0 }))
  view.rerender(React.createElement(Pane, { ...options, height: 800, data: { updated: true } }))
  expect(el.scrollTop).toBe(800)
})
