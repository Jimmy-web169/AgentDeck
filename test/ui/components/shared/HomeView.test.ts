import { required } from '../../../helpers/assert.ts'
import { mockNavIndex, mockProvider, renderWithQuery as renderDom } from '../../../helpers/query.ts'
// @vitest-environment jsdom
import React from 'react'
import { renderStaticWithQuery as renderToStaticMarkup } from '../../../helpers/query.ts'
import HomeView from '../../../../src/components/shared/HomeView.tsx'
import Stats from '../../../../src/components/shared/Stats.tsx'
import InsightsPage from '../../../../src/components/shared/InsightsPage.tsx'
import { setPref, getPrefs } from '../../../../src/lib/prefs.ts'
import { IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedInsights } from '../../../../src/components/shared/IntegratedHomePage.tsx'
// Original test group: home-ui. Assertions retained during module-path migration.
import { test, vi } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import assert from 'node:assert/strict'

import { IntegratedStats } from '../../../../src/components/shared/IntegratedStats.tsx'
const _views = { HomeView, Stats, InsightsPage, IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedStats, IntegratedInsights }
type Props = React.ComponentProps<typeof HomeView>
const render = (_name: 'HomeView', props: Omit<Partial<Props>, 'index'> & { index?: Partial<Props['index']> }) =>
  renderToStaticMarkup(
    React.createElement(HomeView, { providers: [], tabKey: null, target: null, scope: null, onOpen() {}, ...props, index: mockNavIndex(props.index) })
  )
const pref = setPref
const nativePage = ({ root, initialProject }: import('../../../../src/providers/views.ts').HomePageProps) =>
  React.createElement('div', null, 'Native root: ' + root + (initialProject ? ' / Project: ' + initialProject : ' / All projects'))

const providers = [mockProvider('future', 'Future AI')]
const source = { provider: 'future', root: 'work', rootLabel: 'Work', providerLabel: 'Future AI', exists: true, probe: null }

test('Provider-mode Home renders native registry pages for the selected root without a second filter row', () => {
  const configured = [
    {
      ...providers[0],
      homePages: {
        stats: nativePage,
        history: nativePage,
        plugins: nativePage,
        resources: nativePage,
      },
    },
  ]
  for (const view of ['stats', 'history', 'plugins', 'resources']) {
    const html = render('HomeView', {
      providers: configured,
      scope: source,
      index: { scopes: [source] },
      target: { view, homeScope: { excluded: ['future'] } },
    })
    assert.match(html, /Native root: work/)
    assert.doesNotMatch(html, /Home provider filters|All selected sources|Source:|Scope saved in this tab|Reading selected sources/)
    const changed = render('HomeView', { providers: configured, scope: { ...source, root: 'personal' }, index: { scopes: [source] }, target: { view } })
    assert.match(changed, /Native root: personal/)
  }
  const insights = render('HomeView', { providers: configured, scope: source, index: { scopes: [source] }, target: { view: 'insights' } })
  assert.match(insights, /Reading sessions/)
  assert.doesNotMatch(insights, /has no Insights/)
  pref('sidebarMode', 'folder')
  try {
    const folder = render('HomeView', { providers: configured, scope: source, index: { scopes: [source] }, target: { view: 'stats' } })
    assert.doesNotMatch(folder, /Native root|Home provider filters/)
    assert.match(folder, /Reading sources/)
  } finally {
    pref('sidebarMode', 'source')
  }
})

test('Home integration never changes Activity scope or reintroduces a Folders page; new UI copy is English', async () => {
  const previous = getPrefs()
  const projects = [
    { provider: 'future', root: 'work', slug: 'a', name: 'Project A', cwd: '/work/a', sessionCount: 1 },
    { provider: 'future', root: 'personal', slug: 'b', name: 'Project B', cwd: '/personal/b', sessionCount: 1 },
  ]
  const index = mockNavIndex({
    roots: {},
    scopes: [source],
    projects: projects.map((p) => ({ ...source, path: p.cwd, lastActivity: 0, ...p })),
    sessionsFor: () => [],
    loading: false,
  })
  const props = { providers, index, live: { ids: new Set<string>(), slugs: new Set() }, termKeys: new Set<string>(), onOpen() {} }
  try {
    pref('sidebarMode', 'source')
    const first = render('HomeView', { ...props, visible: false, scope: source, target: { view: 'activity' } })
    const other = render('HomeView', { ...props, visible: false, scope: { ...source, root: 'personal' }, target: { view: 'activity' } })
    assert.equal(first, other, 'Activity stays global when the sidebar root changes')
    assert.match(first, /Project A/)
    assert.match(first, /Project B/)
    assert.match(first, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/)
    assert.doesNotMatch(first, /Home provider filters|HomeScopeBar|>Folders</)
    pref('sidebarMode', 'folder')
    pref('folderExcludedProviders', ['hidden'])
    pref('folderExcludedRoots', [])
    const requests: URLSearchParams[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const parsed = new URL(url, 'http://fixture.invalid')
        assert.equal(parsed.pathname, '/api/deck/home')
        requests.push(parsed.searchParams)
        const search = parsed.searchParams.get('search') || ''
        const more = parsed.searchParams.has('cursor')
        const display = more ? 'Second prompt' : search ? 'Needle prompt' : 'First prompt'
        return new Response(
          JSON.stringify({
            scope: { sources: [source] },
            sources: [source],
            capturedAt: new Date().toISOString(),
            errors: [],
            notices: [],
            history: [{ ...source, key: display, display }],
            total: 2,
            nextCursor: more ? null : 'next',
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      })
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    const page = renderDom(React.createElement(HomeView, { ...props, scope: source, target: { view: 'history' }, tabKey: 'first-tab' }))
    await screen.findByText('First prompt')
    assert.deepEqual(JSON.parse(required(requests[0].get('excluded'))), ['hidden'], 'the single sidebar scope drives Home')
    assert.equal(screen.queryByRole('button', { name: 'Folders' }), null)
    assert.equal(screen.queryByRole('group', { name: 'Folder providers' }), null)
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Search scoped prompt history' }), 'needle')
    await screen.findByText('Needle prompt')
    assert.equal(required(requests.at(-1)).get('search'), 'needle')
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Second prompt')
    assert.ok(screen.getByText('Needle prompt'), 'pagination appends rather than replacing the first page')
    page.rerender(React.createElement(HomeView, { ...props, scope: source, target: { view: 'history' }, tabKey: 'second-tab' }))
    assert.equal((screen.getByRole('textbox', { name: 'Search scoped prompt history' }) as HTMLInputElement).value, '')
    await screen.findByText('First prompt')
    assert.equal(screen.queryByText('Second prompt'), null, 'pagination cannot leak between Home tabs')
    assert.doesNotMatch(page.container.textContent || '', /\p{Script=Han}/u)
    assert.doesNotMatch(page.container.textContent || '', /Home provider filters|All selected sources/)
  } finally {
    cleanup()
    for (const key of ['sidebarMode', 'folderExcludedProviders', 'folderExcludedRoots'] as const) pref(key, previous[key])
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  }
})
