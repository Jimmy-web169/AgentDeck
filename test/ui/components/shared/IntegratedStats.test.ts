import { mockProvider, mockHomeData } from '../../../helpers/query.ts'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HomeView from '../../../../src/components/shared/HomeView.tsx'
import Stats from '../../../../src/components/shared/Stats.tsx'
import InsightsPage from '../../../../src/components/shared/InsightsPage.tsx'
import { IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedInsights } from '../../../../src/components/shared/IntegratedHomePage.tsx'
// Original test group: home-ui. Assertions retained during module-path migration.
import { test } from 'vitest'
import assert from 'node:assert/strict'

import { IntegratedStats } from '../../../../src/components/shared/IntegratedStats.tsx'
const views = { HomeView, Stats, InsightsPage, IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedStats, IntegratedInsights }
function render<K extends keyof typeof views>(name: K, props: React.Attributes & React.ComponentProps<(typeof views)[K]>) {
  const View = views[name] as React.ComponentType<React.ComponentProps<(typeof views)[K]>>
  return renderToStaticMarkup(React.createElement(View, props))
}
const nativePage = ({ root, initialProject }: import('../../../../src/providers/views.ts').HomePageProps) =>
  React.createElement('div', null, 'Native root: ' + root + (initialProject ? ' / Project: ' + initialProject : ' / All projects'))

const providers = [{ ...mockProvider('future', 'Future AI'), homePages: {} }]
const source = { provider: 'future', root: 'work', rootLabel: 'Work' }

test('Stats puts overall totals before folders and hiding unavailable groups never hides the overall metrics', () => {
  const stats = {
    sessions: 7,
    subagentSessions: 0,
    userTurns: 10,
    toolCalls: 20,
    tokens: { total: 30 },
    fields: { common: ['total'], specific: [] },
    slug: 'project',
  }
  const data = {
    totals: stats,
    coverage: { total: { available: 1, sources: 1 } },
    errors: [],
    notices: [],
    sources: [{ ...source, stats }],
    folders: [{ id: 'f', cwd: '/past/project', resolved: false, sessions: 7, sources: [{ ...source, stats }] }],
  }
  const hidden = render('IntegratedStats', { onSelect() {}, onOpen() {}, data: mockHomeData(data), providers })
  assert.match(hidden, /Main sessions/)
  assert.ok(hidden.indexOf('Main sessions') < hidden.indexOf('By folder'))
  assert.doesNotMatch(hidden, /past\/project|Open project stats/)
  const shown = render('IntegratedStats', { onSelect() {}, onOpen() {}, data: mockHomeData(data), providers, showUnavailable: true })
  assert.match(shown, /past\/project/)
  assert.match(shown, /7 sessions/)
  assert.doesNotMatch(shown, /All folders|All selected sources/)
  const brief = render('IntegratedStats', {
    onSelect() {},
    onOpen() {},
    data: mockHomeData(data),
    providers,
    showUnavailable: true,
    selection: { folder: 'f' },
  })
  assert.match(brief, /Future AI/)
  assert.match(brief, /This provider has no detailed Stats page/, 'a single folder member skips the redundant brief')
  const detailed = render('IntegratedStats', {
    onSelect() {},
    onOpen() {},
    data: mockHomeData(data),
    providers: [{ ...providers[0], homePages: { stats: nativePage } }],
    showUnavailable: true,
    selection: { folder: 'f', source: JSON.stringify(['future', 'work', 'project']) },
  })
  assert.match(detailed, /Native root: work/)
  const unsupported = render('IntegratedStats', {
    onSelect() {},
    onOpen() {},
    data: mockHomeData(data),
    providers,
    showUnavailable: true,
    selection: { folder: 'f', source: JSON.stringify(['future', 'work', 'project']) },
  })
  assert.match(unsupported, /This provider has no detailed Stats page/)
})

test('Stats uses the registered native page only for one selected root, and skips singleton folder briefs', () => {
  const stats = { sessions: 7, subagentSessions: 0, userTurns: 10, toolCalls: 20, tokens: { total: 30 }, slug: 'project' }
  const configured = [{ ...providers[0], homePages: { stats: nativePage } }]
  const member = { ...source, stats }
  const data = {
    scope: { sources: [source] },
    sources: [member],
    totals: stats,
    coverage: { total: { available: 1, sources: 1 } },
    errors: [],
    notices: [],
    folders: [{ id: 'f', cwd: '/work/project', resolved: true, sessions: 7, sources: [member] }],
  }
  const native = render('IntegratedStats', { onSelect() {}, onOpen() {}, data: mockHomeData(data), providers: configured })
  assert.match(native, /Native root: work \/ All projects/)
  assert.doesNotMatch(native, /By folder|source briefs/)
  const multi = { ...data, scope: { sources: [source, { ...source, root: 'personal' }] } }
  const partial = render('IntegratedStats', {
    onSelect() {},
    onOpen() {},
    data: mockHomeData({ ...multi, errors: [{ error: 'unavailable' }] }),
    providers: configured,
  })
  assert.match(partial, /By folder/)
  assert.doesNotMatch(partial, /Native root/)
  const direct = render('IntegratedStats', { onSelect() {}, onOpen() {}, data: mockHomeData(multi), providers: configured, selection: { folder: 'f' } })
  assert.match(direct, /Native root: work \/ Project: project/)
  const two = { ...multi, folders: [{ ...data.folders[0], sources: [member, { ...member, root: 'personal' }] }] }
  const brief = render('IntegratedStats', { onSelect() {}, onOpen() {}, data: mockHomeData(two), providers: configured, selection: { folder: 'f' } })
  assert.match(brief, /By source — click for full project stats/)
  assert.doesNotMatch(brief, /Native root/)
})
