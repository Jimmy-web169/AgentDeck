// @vitest-environment jsdom
import { createElement } from 'react'
import { test, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react'
import Conversation from '../../../../src/components/shared/Conversation.tsx'
import { mockNavSession } from '../../../helpers/query.ts'
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// The pane is 800×500 at (100,100); the message column is `contentWidth` wide
// from x=100, so the gutter beside it is 900 − 30 − (100 + contentWidth) − 6.
function geometry({ contentWidth = 600 } = {}) {
  let height = 500
  const rect = (top: number, width = 800, h = height): DOMRect => ({
    x: 100,
    y: top,
    top,
    left: 100,
    right: 100 + width,
    bottom: top + h,
    width,
    height: h,
    toJSON: () => ({}),
  })
  const isPane = (element: Element) => element.getAttribute('data-testid') === 'pane'
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return isPane(this) ? height : 0
  })
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return isPane(this) ? 800 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isPane(this) ? 800 : 0
  })
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    return isPane(this) ? 4060 : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (isPane(this)) return rect(100)
    if (this.classList.contains('conversation-content')) return rect(100, contentWidth, 4000)
    if (this.hasAttribute('data-conversation-index')) {
      const pane = this.closest('[data-testid="pane"]')
      return rect(140 + Number(this.getAttribute('data-conversation-index')) * 40 - (pane?.scrollTop || 0), 700, 40)
    }
    return rect(0, 0, 0)
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  return (next: number) => {
    height = next
    fireEvent(window, new Event('resize'))
  }
}

function transcript(id: string, first = 'Prompt 0', length = 100) {
  return {
    summary: mockNavSession({ id }),
    timeline: Array.from({ length }, (_, index) => ({ kind: 'user' as const, text: index ? `Prompt ${index}` : first })),
  }
}

const paneWith = (data: ReturnType<typeof transcript>, extra = {}) =>
  createElement(
    'div',
    { style: { overflowY: 'auto' }, 'data-testid': 'pane' },
    createElement(Conversation, { data, renderEvent: (event: { text?: string }) => createElement('p', null, event.text), ...extra })
  )

function expectCurrentPrompt(nav: HTMLElement, ordinal: number) {
  expect(nav.isConnected).toBe(true)
  const dot = within(nav).getByRole('button', { name: `Question ${ordinal}: Prompt ${ordinal - 1}` })
  // toEqual compares DOM nodes with isEqualNode, which an identical sibling
  // would also satisfy; identity is what this assertion is for.
  const current = Array.from(nav.querySelectorAll('[aria-current]'))
  expect(current).toHaveLength(1)
  expect(current[0]).toBe(dot)
  expect(dot.getAttribute('aria-current')).toBe('step')
}

const reachableQuestions = (nav: HTMLElement) => within(nav).getAllByRole('button', { name: /^Question / })
const previousButton = (nav: HTMLElement) => within(nav).getByRole('button', { name: 'Previous user prompt' })
const nextButton = (nav: HTMLElement) => within(nav).getByRole('button', { name: 'Next user prompt' })
const toLatest = (nav: HTMLElement) => fireEvent.click(nextButton(nav), { shiftKey: true })
const toFirst = (nav: HTMLElement) => fireEvent.click(previousButton(nav), { shiftKey: true })

test('dialog transcripts keep their navigation inside the fixed overlay and outside the scrolling content', async () => {
  geometry()
  const view = render(
    createElement(
      'div',
      { 'data-testid': 'overlay', style: { position: 'fixed', zIndex: 50 } },
      createElement(
        'div',
        { 'data-testid': 'pane', style: { overflowY: 'auto' } },
        createElement(Conversation, { data: transcript('dialog'), renderEvent: (event) => createElement('p', null, event.text) })
      )
    )
  )
  const nav = view.getByRole('navigation')
  await waitFor(() => expect(nav.parentElement).toBe(view.getByTestId('overlay')))
  expect(view.getByTestId('pane').contains(nav)).toBe(false)
  toLatest(nav)
  await waitFor(() => expectCurrentPrompt(nav, 100))
  fireEvent.click(previousButton(nav))
  await waitFor(() => expectCurrentPrompt(nav, 99))
  expect(view.getByTestId('overlay').contains(document.activeElement)).toBe(true)
})

test('prompt navigation reveals unloaded history and controls only the nearest transcript pane', async () => {
  geometry()
  const view = render(
    createElement(
      'div',
      { style: { overflowY: 'auto' }, 'data-testid': 'outer' },
      createElement(
        'div',
        { style: { overflowY: 'auto' }, 'data-testid': 'pane' },
        createElement(Conversation, {
          data: transcript('jump-history'),
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
  const pane = view.getByTestId('pane'),
    outer = view.getByTestId('outer')
  const nav = view.getByRole('navigation', { name: 'Conversation navigation' })
  outer.scrollTop = 73
  expect(within(pane).queryByText('Prompt 0')).toBeNull()
  expect(view.container.contains(nav)).toBe(false)
  expect(nav.style.height).toBe('492px')
  toLatest(nav)
  await waitFor(() => expectCurrentPrompt(nav, 100))
  const dot = view.getByRole('button', { name: 'Question 99: Prompt 98' })
  const dots = view.getByRole('group', { name: 'User prompts' })
  fireEvent.mouseEnter(dot)
  expect(dot.classList.contains('is-hover')).toBe(true)
  expect(within(dot).getByText('Prompt 98')).toBeTruthy()
  fireEvent.pointerDown(outer)
  expect(dot.classList.contains('is-hover')).toBe(false)
  act(() => dot.focus())
  expect(dot.classList.contains('is-hover')).toBe(true)
  fireEvent.keyDown(dot, { key: 'Escape' })
  expect(document.activeElement).toBe(dot)
  expect(dot.classList.contains('is-hover')).toBe(false)
  expect(dots.classList.contains('is-focus')).toBe(false)
  const first = previousButton(nav)
  act(() => first.focus())
  const escaped = vi.fn()
  window.addEventListener('keydown', escaped)
  try {
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(document.activeElement).toBe(first)
    expect(escaped).toHaveBeenCalledTimes(1)
  } finally {
    window.removeEventListener('keydown', escaped)
  }
  fireEvent.click(dot)
  expect(document.activeElement).toBe(within(pane).getByText('Prompt 98').parentElement)
  toFirst(nav)
  await waitFor(() => {
    expect(view.getByRole('navigation', { name: 'Conversation navigation' })).toBe(nav)
    expect(reachableQuestions(nav).length).toBeGreaterThan(0)
    expect(nav.querySelectorAll('[aria-current]').length).toBe(0)
  })
  fireEvent.click(view.getByRole('button', { name: 'Question 1: Prompt 0' }))
  expect(within(pane).getByText('Prompt 0')).toBeTruthy()
  expect(document.activeElement?.getAttribute('data-conversation-index')).toBe('0')
  toLatest(nav)
  expect(pane.scrollTop).toBe(pane.scrollHeight)
  toFirst(nav)
  expect(pane.scrollTop).toBe(0)
  expect(outer.scrollTop).toBe(73)
})

test('prompt ticks follow reading position and available height, with previous and next questions', async () => {
  const resize = geometry()
  const view = render(paneWith(transcript('moving-window')))
  const pane = view.getByTestId('pane'),
    nav = view.getByRole('navigation')
  // Only the tail is rendered at first, so the reader sits above every loaded
  // question; the previous arrow must still lead to the first message.
  expect(within(pane).queryByText('Prompt 0')).toBeNull()
  expect(previousButton(nav).hasAttribute('disabled')).toBe(false)
  toFirst(nav)
  expect(within(pane).getByText('Prompt 0')).toBeTruthy()
  const initial = reachableQuestions(nav).length
  expect(initial).toBeGreaterThan(1)
  expect(initial).toBeLessThan(100)
  // Every question owns a tick; those beyond the rail are hidden from the
  // accessibility tree and the tab order rather than being torn down.
  expect(nav.querySelectorAll('.conversation-navigation-dot').length).toBe(100)
  pane.scrollTop = 2024
  fireEvent.scroll(pane)
  await waitFor(() => expectCurrentPrompt(nav, 51))
  expect(view.queryByRole('button', { name: 'Question 1: Prompt 0' })).toBeNull()
  expect(view.getByRole('button', { name: 'Question 51: Prompt 50' }).getAttribute('aria-current')).toBe('step')
  fireEvent.click(previousButton(nav))
  expect(document.activeElement?.getAttribute('data-conversation-index')).toBe('49')
  await waitFor(() => expectCurrentPrompt(nav, 50))
  fireEvent.click(nextButton(nav))
  expect(document.activeElement?.getAttribute('data-conversation-index')).toBe('50')
  resize(260)
  await waitFor(() => expect(reachableQuestions(nav).length).toBeLessThan(initial))
  expect(nav.style.height).toBe('252px')
  toLatest(nav)
  await waitFor(() => expect(nextButton(nav).hasAttribute('disabled')).toBe(true))
})

test('previous and next prompts keep their selected ordinal when native scrolling clamps at the bottom', async () => {
  geometry()
  const view = render(paneWith(transcript('clamped-bottom')))
  const pane = view.getByTestId('pane'),
    nav = view.getByRole('navigation')
  let scrollTop = 0
  Object.defineProperty(pane, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(value, pane.scrollHeight - pane.clientHeight))
    },
  })
  toLatest(nav)
  await waitFor(() => expectCurrentPrompt(nav, 100))
  for (const ordinal of [99, 98]) {
    fireEvent.click(previousButton(nav))
    await waitFor(() => expectCurrentPrompt(nav, ordinal))
    expect(document.activeElement?.getAttribute('data-conversation-index')).toBe(String(ordinal - 1))
    expect(pane.scrollTop).toBe(3560)
  }
  fireEvent.click(nextButton(nav))
  await waitFor(() => expectCurrentPrompt(nav, 99))
  pane.scrollTop = 3000
  fireEvent.scroll(pane)
  await waitFor(() => expectCurrentPrompt(nav, 75))
})

test('dwelling on a tick unfolds the complete question in place, clears the other ticks, and inactive or compact transcripts hide their rail', async () => {
  geometry()
  const question = `${'Full question '.repeat(100)}final words`
  const data = transcript('unfold', question)
  const view = render(paneWith(data))
  const nav = view.getByRole('navigation')
  toFirst(nav)
  const dot = view.getByRole('button', { name: `Question 1: ${question}` })
  const text = dot.querySelector('.conversation-navigation-text') as HTMLElement
  const dots = view.getByRole('group', { name: 'User prompts' })
  // The full question is present from the start; nothing is truncated or swapped.
  expect(text.textContent).toBe(question)
  expect(text.textContent).not.toContain('…')
  fireEvent.mouseEnter(dot)
  expect(dot.classList.contains('is-hover')).toBe(true)
  expect(dot.classList.contains('is-dwell')).toBe(false)
  expect(dots.classList.contains('is-focus')).toBe(false)
  await waitFor(() => expect(dot.classList.contains('is-dwell')).toBe(true), { timeout: 1500 })
  expect(dots.classList.contains('is-focus')).toBe(true)
  expect(text.textContent).toBe(question)
  expect(text.style.maxHeight).toBe('300px')
  // Moving to another tick restarts the two stages there.
  const second = view.getByRole('button', { name: 'Question 2: Prompt 1' })
  fireEvent.mouseEnter(second)
  expect(second.classList.contains('is-hover')).toBe(true)
  expect(dot.classList.contains('is-dwell')).toBe(false)
  expect(dots.classList.contains('is-focus')).toBe(false)
  fireEvent.mouseLeave(dots)
  expect(second.classList.contains('is-hover')).toBe(false)
  // Clicking the unfolded question is what jumps.
  fireEvent.mouseEnter(dot)
  await waitFor(() => expect(dot.classList.contains('is-dwell')).toBe(true), { timeout: 1500 })
  fireEvent.click(text)
  expect(document.activeElement?.getAttribute('data-conversation-index')).toBe('0')
  expect(dot.classList.contains('is-dwell')).toBe(false)
  view.rerender(paneWith(data, { active: false }))
  expect(view.queryByRole('navigation')).toBeNull()
  view.rerender(paneWith(data, { compact: true }))
  expect(view.queryByRole('navigation')).toBeNull()
})

test('holding an arrow runs to the edge while a quick click only steps and a cancelled hold does nothing', async () => {
  geometry()
  const view = render(paneWith(transcript('hold')))
  const pane = view.getByTestId('pane'),
    nav = view.getByRole('navigation')
  toFirst(nav)
  await waitFor(() => expect(pane.scrollTop).toBe(0))
  const next = nextButton(nav),
    previous = previousButton(nav)
  fireEvent.mouseDown(next)
  expect(next.classList.contains('is-holding')).toBe(true)
  await waitFor(() => expect(pane.scrollTop).toBe(pane.scrollHeight), { timeout: 1500 })
  expect(next.classList.contains('is-holding')).toBe(false)
  await waitFor(() => expectCurrentPrompt(nav, 100))
  // The click that ends a completed hold must not also step.
  fireEvent.mouseUp(next)
  fireEvent.click(next)
  await waitFor(() => expectCurrentPrompt(nav, 100))
  // A quick press is one ordinary step, never a jump to the edge.
  fireEvent.mouseDown(previous)
  fireEvent.mouseUp(previous)
  fireEvent.click(previous)
  await waitFor(() => expectCurrentPrompt(nav, 99))
  expect(pane.scrollTop).not.toBe(0)
  // Leaving the button mid-hold cancels without stepping or jumping.
  fireEvent.mouseDown(previous)
  expect(previous.classList.contains('is-holding')).toBe(true)
  fireEvent.mouseLeave(previous)
  expect(previous.classList.contains('is-holding')).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 520))
  expectCurrentPrompt(nav, 99)
  expect(pane.scrollTop).not.toBe(0)
  // Keyboard users reach the edge with Shift instead of a press-and-hold.
  fireEvent.keyDown(previous, { key: 'Enter', shiftKey: true })
  await waitFor(() => expect(pane.scrollTop).toBe(0))
  fireEvent.keyDown(next, { key: ' ' })
  await waitFor(() => expectCurrentPrompt(nav, 1))
})

test('a short conversation groups its ticks at a capped pitch instead of stretching across the rail', async () => {
  geometry()
  const view = render(paneWith(transcript('few', 'Prompt 0', 7)))
  const nav = view.getByRole('navigation')
  await waitFor(() => expect(nav.style.height).toBe('492px'))
  const ticks = [...nav.querySelectorAll<HTMLElement>('.conversation-navigation-dot')]
  const strip = nav.querySelector<HTMLElement>('.conversation-navigation-strip') as HTMLElement
  // 492px of rail minus two 34px buttons leaves 424; inside 8px insets that is
  // 408, so seven ticks at the 32px cap take 224 and the group centres at 100.
  expect(ticks.map((tick) => tick.style.top)).toEqual(['0px', '32px', '64px', '96px', '128px', '160px', '192px'])
  expect(strip.style.transform).toBe('translateY(100px)')
  expect(reachableQuestions(nav).length).toBe(7)
  expect(nav.querySelectorAll('[aria-hidden="true"].conversation-navigation-dot').length).toBe(0)
  // A long conversation keeps the comfortable pitch and scrolls instead.
  view.rerender(paneWith(transcript('few', 'Prompt 0', 100)))
  await waitFor(() => expect(nav.querySelectorAll('.conversation-navigation-dot').length).toBe(100))
  expect((nav.querySelectorAll<HTMLElement>('.conversation-navigation-dot')[1] as HTMLElement).style.top).toBe('24px')
  expect(reachableQuestions(nav).length).toBeLessThan(100)
})

test('the question keeps to the gutter beside the messages, and a pane too narrow for a line shows no brushing text', async () => {
  geometry()
  const view = render(paneWith(transcript('gutter')))
  const nav = view.getByRole('navigation')
  await waitFor(() => expect(nav.style.getPropertyValue('--conversation-gutter')).toBe('164px'))
  toFirst(nav)
  const dot = view.getByRole('button', { name: 'Question 1: Prompt 0' })
  fireEvent.mouseEnter(dot)
  expect(dot.classList.contains('is-tight')).toBe(false)
  expect(dot.classList.contains('is-scrim')).toBe(false)
  cleanup()
  vi.restoreAllMocks()
  geometry({ contentWidth: 760 })
  const narrow = render(paneWith(transcript('gutter-narrow')))
  const rail = narrow.getByRole('navigation')
  await waitFor(() => expect(rail.style.getPropertyValue('--conversation-gutter')).toBe('4px'))
  toFirst(rail)
  const tick = narrow.getByRole('button', { name: 'Question 1: Prompt 0' })
  fireEvent.mouseEnter(tick)
  expect(tick.classList.contains('is-tight')).toBe(true)
  expect(tick.classList.contains('is-scrim')).toBe(false)
  await waitFor(() => expect(tick.classList.contains('is-dwell')).toBe(true), { timeout: 1500 })
  expect(tick.classList.contains('is-scrim')).toBe(true)
})

test('omitted provider events do not leave empty spacing wrappers', () => {
  const data = { summary: mockNavSession({ id: 'omitted-event' }), timeline: [{ kind: 'system' as const, text: 'hidden' }] }
  const view = render(createElement(Conversation, { data, renderEvent: () => null }))
  expect(view.container.querySelector('[data-conversation-index]')).toBeNull()
  expect(view.getByRole('button', { name: 'Previous user prompt' }).hasAttribute('disabled')).toBe(true)
  expect(view.getByRole('button', { name: 'Next user prompt' }).hasAttribute('disabled')).toBe(true)
})
