import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { bucketActivity } from '../server/shared/activity.js'

const compiled = await build({ stdin: { contents: `
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HomeView from './src/components/shared/HomeView.jsx'
import Stats from './src/components/shared/Stats.jsx'
import InsightsPage from './src/components/shared/InsightsPage.jsx'
import { setPref } from './src/lib/prefs.js'
import { IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedStats, IntegratedInsights } from './src/components/shared/IntegratedHomePage.jsx'
const views = { HomeView, Stats, InsightsPage, IntegratedPlugins, IntegratedResources, IntegratedHistory, IntegratedStats, IntegratedInsights }
export const render = (name, props) => renderToStaticMarkup(React.createElement(views[name], props))
export const pref = setPref
export const nativePage = ({root, initialProject}) => React.createElement('div', null, 'Native root: ' + root + (initialProject ? ' / Project: ' + initialProject : ' / All projects'))
`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.css': 'empty' } })
const bundled = { exports: {} }
Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports)
const render = bundled.exports.render
const providers = [{ id: 'future', label: 'Future AI' }]
const source = { provider: 'future', root: 'work', rootLabel: 'Work' }

test('Provider-mode Home renders native registry pages for the selected root without a second filter row', () => {
  const configured = [{ ...providers[0], homePages: { stats: bundled.exports.nativePage, history: bundled.exports.nativePage, plugins: bundled.exports.nativePage, resources: bundled.exports.nativePage } }]
  for (const view of ['stats', 'history', 'plugins', 'resources']) {
    const html = render('HomeView', { providers: configured, scope: source, index: { scopes: [source] }, target: { view, homeScope: { excluded: ['future'] } } })
    assert.match(html, /Native root: work/)
    assert.doesNotMatch(html, /Home provider filters|All selected sources|Source:|Scope saved in this tab|Reading selected sources/)
    const changed = render('HomeView', { providers: configured, scope: { ...source, root: 'personal' }, index: { scopes: [source] }, target: { view } })
    assert.match(changed, /Native root: personal/)
  }
  const insights = render('HomeView', { providers: configured, scope: source, index: { scopes: [source] }, target: { view: 'insights' } })
  assert.match(insights, /Reading sessions/)
  assert.doesNotMatch(insights, /has no Insights/)
  bundled.exports.pref('sidebarMode', 'folder')
  try {
    const folder = render('HomeView', { providers: configured, scope: source, index: { scopes: [source] }, target: { view: 'stats' } })
    assert.doesNotMatch(folder, /Native root|Home provider filters/)
    assert.match(folder, /Reading sources/)
  } finally { bundled.exports.pref('sidebarMode', 'source') }
})

test('plugins distinguish unknown enabled state; resource scopes preserve exact provenance and safe native entry points', () => {
  const plugins = render('IntegratedPlugins', { providers, data: { sources: [{ ...source, data: { installed: [{ name: 'review' }] } }] } })
  assert.match(plugins, /Enabled state not reported/)
  assert.match(plugins, /not confirm that a running session loaded/)
  const resources = render('IntegratedResources', { providers, data: { sources: [{ ...source, entries: [{ scope: 'user', items: [{ label: 'Skills', names: ['review'] }] }, { scope: 'project', project: { slug: 'p', cwd: '/work/repo', folderName: 'repo' }, items: [], readOnly: true }] }] } })
  assert.match(resources, /User resources · May affect other folders/)
  assert.match(resources, /Open user resources/)
  assert.doesNotMatch(resources, /project resources/)
  assert.match(resources, /Future AI/)
  assert.match(resources, /Work/)
  assert.doesNotMatch(resources, /Delete|Save all/)
})

test('History has no navigation actions, including records with session IDs', () => {
  const html = render('IntegratedHistory', { providers, data: { history: [{ ...source, key: '1', display: 'Question', ts: null }, { ...source, key: '2', display: 'Another', sessionId: 's' }] } })
  assert.doesNotMatch(html, /conversation link|<button/)
  assert.match(html, /Folder not recorded/)
  assert.match(html, /Time not recorded/)
  assert.equal((html.match(/Open conversation/g) || []).length, 0)
})

test('Stats puts overall totals before folders and hiding unavailable groups never hides the overall metrics', () => {
  const stats = { sessions: 7, subagentSessions: 0, userTurns: 10, toolCalls: 20, tokens: { total: 30 }, fields: { common: ['total'], specific: [] }, slug: 'project' }
  const data = { totals: stats, coverage: { total: { available: 1, sources: 1 } }, errors: [], notices: [], sources: [{ ...source, stats }], folders: [{ id: 'f', cwd: '/past/project', resolved: false, sessions: 7, sources: [{ ...source, stats }] }] }
  const hidden = render('IntegratedStats', { data, providers })
  assert.match(hidden, /Main sessions/)
  assert.ok(hidden.indexOf('Main sessions') < hidden.indexOf('By folder'))
  assert.doesNotMatch(hidden, /past\/project|Open project stats/)
  const shown = render('IntegratedStats', { data, providers, showUnavailable: true })
  assert.match(shown, /past\/project/)
  assert.match(shown, /7 sessions/)
  assert.doesNotMatch(shown, /All folders|All selected sources/)
  const brief = render('IntegratedStats', { data, providers, showUnavailable: true, selection: { folder: 'f' } })
  assert.match(brief, /Future AI/)
  assert.match(brief, /This provider has no detailed Stats page/, 'a single folder member skips the redundant brief')
  const detailed = render('IntegratedStats', { data, providers: [{ ...providers[0], homePages: { stats: bundled.exports.nativePage } }], showUnavailable: true, selection: { folder: 'f', source: JSON.stringify(['future', 'work', 'project']) } })
  assert.match(detailed, /Native root: work/)
  const unsupported = render('IntegratedStats', { data, providers, showUnavailable: true, selection: { folder: 'f', source: JSON.stringify(['future', 'work', 'project']) } })
  assert.match(unsupported, /This provider has no detailed Stats page/)
})

test('Home integration never changes Activity scope or reintroduces a Folders page; new UI copy is English', () => {
  const home = fs.readFileSync('src/components/shared/HomeView.jsx', 'utf8')
  assert.doesNotMatch(home, /HomeScopeBar/)
  assert.match(home, /scoped && integrated && <div[^\n]*<IntegratedHomePage/)
  assert.match(home, /resolveHomePresentation\(prefs, target, sidebarScope\)/)
  assert.match(home, /sidebarMode: by/)
  assert.doesNotMatch(home, /recentProjectsBy|openFolder|folder\/resolve/)
  assert.match(home, /IntegratedHomePage key=\{tabKey\}/, 'transient searches and pagination cannot leak into another Home tab')
  assert.match(home, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/)
  assert.match(home, /grid-cols-1 md:grid-cols-2/)
  assert.doesNotMatch(home, /@container|homeLayout\.css/)
  assert.doesNotMatch(fs.readFileSync('src/components/shared/IntegratedHomePage.jsx', 'utf8'), /\p{Script=Han}/u)
})

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
  const html = render('Stats', { stats: { sessions: 1234567, userTurns: 2345678, toolCalls: 3456789, tokens: { total: 1234567890 }, projects: [] }, root: 'work' })
  assert.match(html, /repeat\(auto-fit,minmax\(min\(100%,11rem\),1fr\)\)/)
  assert.doesNotMatch(html, /xl:grid-cols-8/)
  for (const value of ['1234567', '2345678', '3456789']) {
    assert.match(html, new RegExp(`class="[^"]*whitespace-nowrap[^"]*" title="${value}">${value}<`))
  }
  assert.doesNotMatch(html, /class="[^"]*truncate[^"]*" title="(?:1234567|2345678|3456789)"/)
})

test('Folder Insights retains every original section without additional folder or source dashboards', () => {
  const activity = bucketActivity([{ id: 'session', slug: 'native-project', cwd: '/work/project', firstTs: '2026-09-08T09:00:00Z', lastTs: '2026-09-08T10:00:00Z', userTurns: 4 }], { days: 84, now: Date.parse('2026-09-09T10:00:00Z') })
  const member = { ...source, slug: 'native-project', activity }
  const data = { activity, folders: [{ id: 'canonical', cwd: '/work/project', resolved: true, activity, sources: [member] }] }
  for (const selection of [{}, { folder: 'canonical' }, { folder: 'canonical', source: JSON.stringify(['future', 'work', 'native-project']) }]) {
    const html = render('IntegratedInsights', { data, providers, selection })
    for (const label of ['Your last 30 days', 'current streak', 'sessions this week', 'Activity · last 12 weeks', 'Hour of day', 'Day of week', 'Weekly rhythm · sessions', 'Session length', 'Prompts per session', 'Needs attention', 'Copy digest as Markdown', '>Table<']) assert.ok(html.includes(label), label)
    assert.doesNotMatch(html, /All folders|All selected sources|By folder|By source|source briefs|Future AI/)
  }
})

test('Stats uses the registered native page only for one selected root, and skips singleton folder briefs', () => {
  const stats = { sessions: 7, subagentSessions: 0, userTurns: 10, toolCalls: 20, tokens: { total: 30 }, slug: 'project' }
  const configured = [{ ...providers[0], homePages: { stats: bundled.exports.nativePage } }]
  const member = { ...source, stats }
  const data = { scope: { sources: [source] }, sources: [member], totals: stats, coverage: { total: { available: 1, sources: 1 } }, errors: [], notices: [], folders: [{ id: 'f', cwd: '/work/project', resolved: true, sessions: 7, sources: [member] }] }
  const native = render('IntegratedStats', { data, providers: configured })
  assert.match(native, /Native root: work \/ All projects/)
  assert.doesNotMatch(native, /By folder|source briefs/)
  const multi = { ...data, scope: { sources: [source, { ...source, root: 'personal' }] } }
  const partial = render('IntegratedStats', { data: { ...multi, errors: [{ error: 'unavailable' }] }, providers: configured })
  assert.match(partial, /By folder/)
  assert.doesNotMatch(partial, /Native root/)
  const direct = render('IntegratedStats', { data: multi, providers: configured, selection: { folder: 'f' } })
  assert.match(direct, /Native root: work \/ Project: project/)
  const two = { ...multi, folders: [{ ...data.folders[0], sources: [member, { ...member, root: 'personal' }] }] }
  const brief = render('IntegratedStats', { data: two, providers: configured, selection: { folder: 'f' } })
  assert.match(brief, /By source — click for full project stats/)
  assert.doesNotMatch(brief, /Native root/)
})
