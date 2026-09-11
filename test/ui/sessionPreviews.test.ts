import { mockNavSession } from '../helpers/query.ts'
// @vitest-environment jsdom
import { createElement } from 'react'
import { render as renderDom, screen, cleanup } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionRow } from '../../src/components/shared/HomeView.tsx'
// Original test group: latest-prompt-ui. Assertions retained during module-path migration.
import { test, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'

const render = (s: { provider?: string; root?: string; id?: string; title: string; firstPrompt?: string; lastUserPrompt?: string }, prefs = {}) =>
  renderToStaticMarkup(
    createElement(SessionRow, { s: mockNavSession(s), providers: [], live: { ids: new Set<string>() }, termKeys: new Set<string>(), onOpen() {}, ...prefs })
  )
afterEach(cleanup)

test('session row shows only latest question, with no First/Latest label, escaping user text', async () => {
  const s = {
    provider: 'codex',
    root: 'r',
    id: 's',
    title: 'Session name',
    firstPrompt: 'First question',
    lastUserPrompt: 'Latest <script>question</script>',
  }
  const onOpen = vi.fn()
  const { container } = renderDom(
    createElement(SessionRow, { s: mockNavSession(s), providers: [], live: { ids: new Set<string>() }, termKeys: new Set<string>(), onOpen })
  )
  const html = container.innerHTML
  assert.match(html, /Session name/)
  assert.match(html, /data-question-preview="latest"/)
  assert.match(html, /data-question-preview="latest" class="[^"]*text-zinc-500/)
  assert.match(html, /<span class="[^"]*text-zinc-200[^"]*">Session name<\/span>/)
  assert.match(html, /Latest &lt;script&gt;question&lt;\/script&gt;/)
  assert.doesNotMatch(html, /data-question-preview="first"|First question|>Latest<|>First</)
  assert.equal(container.querySelector('script'), null, 'user text never creates an executable element')
  assert.equal(screen.getByText('Latest <script>question</script>').textContent, s.lastUserPrompt)
  const user = userEvent.setup()
  const row = screen.getByRole('button', { name: /Session name/ })
  await user.click(row)
  assert.equal(onOpen.mock.calls[0][0], 'codex')
  assert.equal(onOpen.mock.calls[0][1].id, 's')
  assert.equal(onOpen.mock.calls[0][1].root, 'r')
  assert.deepEqual(onOpen.mock.calls[0][2], { newTab: false })
  await user.keyboard('{Control>}')
  await user.click(row)
  await user.keyboard('{/Control}')
  assert.deepEqual(onOpen.mock.calls[1][2], { newTab: true })
})

test('first question is not shown as a redundant extra line when equal to latest', () => {
  const html = render({ provider: 'codex', root: 'r', id: 's', title: 'Session name', firstPrompt: 'Same question', lastUserPrompt: 'Same question' })
  assert.match(html, /data-question-preview="latest"/)
  assert.doesNotMatch(html, /data-question-preview="first"/)
})

for (const showLatestPrompt of [true, false]) {
  test(`only latest question is controlled by visibility=${showLatestPrompt}`, () => {
    const html = render({ title: 'Session name', firstPrompt: 'Opening question', lastUserPrompt: 'Most recent question' }, { showLatestPrompt })
    assert.equal(html.includes('data-question-preview="latest"'), showLatestPrompt)
    assert.equal(html.includes('data-question-preview="first"'), false)
    assert.equal(html.includes('Most recent question'), showLatestPrompt)
    assert.equal(html.includes('Opening question'), false)
    assert.match(html, /Session name/)
  })
}

test('hiding latest or missing latest never falls back to first question', () => {
  const html = render({ title: 'Session name', firstPrompt: 'Same question', lastUserPrompt: 'Same question' }, { showLatestPrompt: false })
  assert.doesNotMatch(html, /data-question-preview="first"/)
  assert.doesNotMatch(html, /data-question-preview="latest"/)
  assert.doesNotMatch(render({ title: 'Same question', firstPrompt: 'Same question' }), /data-question-preview/)
  assert.doesNotMatch(render({ title: 'Empty session' }), /data-question-preview/)
  assert.doesNotMatch(render({ title: 'Session title', firstPrompt: 'Opening question' }), /Opening question|data-question-preview/)
  assert.doesNotMatch(render({ title: 'Same question', lastUserPrompt: 'Same question' }), /data-question-preview/, 'title already shows the latest question')
})
