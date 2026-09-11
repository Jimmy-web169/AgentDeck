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
import { bucketActivity } from '../../../../server/shared/activity.ts'

import { IntegratedStats } from '../../../../src/components/shared/IntegratedStats.tsx'
const views = { HomeView, Stats, InsightsPage, IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedStats, IntegratedInsights }
function render<K extends keyof typeof views>(name: K, props: React.Attributes & React.ComponentProps<(typeof views)[K]>) {
  const View = views[name] as React.ComponentType<React.ComponentProps<(typeof views)[K]>>
  return renderToStaticMarkup(React.createElement(View, props))
}

const providers = [{ ...mockProvider('future', 'Future AI'), homePages: {} }]
const source = { provider: 'future', root: 'work', rootLabel: 'Work' }

test('plugins distinguish unknown enabled state; resource scopes preserve exact provenance and safe native entry points', () => {
  const plugins = render('IntegratedPlugins', {
    onSelect() {},
    providers,
    data: mockHomeData({ sources: [{ ...source, data: { marketplaces: [], installed: [{ name: 'review' }] } }] }),
  })
  assert.match(plugins, /Enabled state not reported/)
  assert.match(plugins, /not confirm that a running session loaded/)
  const resources = render('IntegratedResources', {
    onSelect() {},
    providers,
    data: mockHomeData({
      sources: [
        {
          ...source,
          entries: [
            { scope: 'user', items: [{ label: 'Skills', names: ['review'] }] },
            { scope: 'project', project: { slug: 'p', cwd: '/work/repo', folderName: 'repo' }, items: [], readOnly: true },
          ],
        },
      ],
    }),
  })
  assert.match(resources, /User resources · May affect other folders/)
  assert.match(resources, /Open user resources/)
  assert.doesNotMatch(resources, /project resources/)
  assert.match(resources, /Future AI/)
  assert.match(resources, /Work/)
  assert.doesNotMatch(resources, /Delete|Save all/)
})

test('History has no navigation actions, including records with session IDs', () => {
  const html = render('IntegratedHistory', {
    providers,
    data: mockHomeData({
      total: 2,
      history: [
        { ...source, key: '1', display: 'Question', ts: null },
        { ...source, key: '2', display: 'Another', sessionId: 's' },
      ],
    }),
  })
  assert.doesNotMatch(html, /conversation link|<button/)
  assert.match(html, /Folder not recorded/)
  assert.match(html, /Time not recorded/)
  assert.equal((html.match(/Open conversation/g) || []).length, 0)
})

test('Folder Insights retains every original section without additional folder or source dashboards', () => {
  const activity = bucketActivity(
    [{ slug: 'native-project', cwd: '/work/project', firstTs: '2026-09-08T09:00:00Z', lastTs: '2026-09-08T10:00:00Z', userTurns: 4 }],
    { days: 84, now: Date.parse('2026-09-09T10:00:00Z') }
  )
  const member = { ...source, slug: 'native-project', activity }
  const data = { activity, folders: [{ id: 'canonical', cwd: '/work/project', resolved: true, activity, sources: [member] }] }
  for (const selection of [{}, { folder: 'canonical' }, { folder: 'canonical', source: JSON.stringify(['future', 'work', 'native-project']) }]) {
    const html = render('IntegratedInsights', { data: mockHomeData(data), providers, ...{ selection } })
    for (const label of [
      'Your last 30 days',
      'current streak',
      'sessions this week',
      'Activity · last 12 weeks',
      'Hour of day',
      'Day of week',
      'Weekly rhythm · sessions',
      'Session length',
      'Prompts per session',
      'Needs attention',
      'Copy digest as Markdown',
      '>Table<',
    ])
      assert.ok(html.includes(label), label)
    assert.doesNotMatch(html, /All folders|All selected sources|By folder|By source|source briefs|Future AI/)
  }
})
