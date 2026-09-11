import React from 'react'
import { renderStaticWithQuery as renderToStaticMarkup } from '../../../helpers/query.ts'
import HomeView from '../../../../src/components/shared/HomeView.tsx'
import Stats from '../../../../src/components/shared/Stats.tsx'
import InsightsPage from '../../../../src/components/shared/InsightsPage.tsx'
import { IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedInsights } from '../../../../src/components/shared/IntegratedHomePage.tsx'
// Original test group: home-ui. Assertions retained during module-path migration.
import { test } from 'vitest'
import assert from 'node:assert/strict'

import { IntegratedStats } from '../../../../src/components/shared/IntegratedStats.tsx'
const _views = { HomeView, Stats, InsightsPage, IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedStats, IntegratedInsights }
const render = (
  _name: 'Stats',
  props: {
    stats:
      | {
          sessions: number
          projects: { slug: string; cwd: string; sessions: number; toolCounts: { Read: number }; models: string[]; tokens: { total: number } }[]
          fields: { common: string[]; specific: never[] }
        }
      | { sessions: number; userTurns: number; toolCalls: number; tokens: { total: number }; projects: never[] }
    root: string
    initialProject?: string
  }
) => renderToStaticMarkup(React.createElement(Stats, props))

test('native Stats hides the redundant root heading and accepts an exact initial project without losing detail', () => {
  const project = { slug: 'native-project', cwd: '/work/project', sessions: 1, toolCounts: { Read: 3 }, models: ['test-model'], tokens: { total: 25 } }
  const stats = { sessions: 1, projects: [project], fields: { common: ['total'], specific: [] } }
  const overview = render('Stats', { stats, root: 'work' })
  assert.doesNotMatch(overview, />Folder<|>Stats<|All folders/)
  const detail = render('Stats', { stats, root: 'work', initialProject: 'native-project' })
  assert.match(detail, /Tool usage/)
  assert.match(detail, /test-model/)
  assert.match(detail, /By session/)
  assert.doesNotMatch(detail, /By project|>Folder</)
})

test('Stats metric values stay readable without ellipsis and cards wrap by available width', () => {
  const html = render('Stats', {
    stats: { sessions: 1234567, userTurns: 2345678, toolCalls: 3456789, tokens: { total: 1234567890 }, projects: [] },
    root: 'work',
  })
  assert.match(html, /repeat\(auto-fit,minmax\(min\(100%,11rem\),1fr\)\)/)
  assert.doesNotMatch(html, /xl:grid-cols-8/)
  for (const value of ['1234567', '2345678', '3456789']) {
    assert.match(html, new RegExp(`class="[^"]*whitespace-nowrap[^"]*" title="${value}">${value}<`))
  }
  assert.doesNotMatch(html, /class="[^"]*truncate[^"]*" title="(?:1234567|2345678|3456789)"/)
})
