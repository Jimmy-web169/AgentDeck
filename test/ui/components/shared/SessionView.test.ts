import { mockNavSession } from '../../../helpers/query.ts'
// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { test, expect, vi, afterEach } from 'vitest'
import SessionView from '../../../../src/components/shared/SessionView.tsx'
import { codexApi } from '../../../../src/api/index.ts'
afterEach(cleanup)
const Text = () => React.createElement('p', null, 'Transcript body')
const Resource = (props: import('../../../../src/api/models.ts').ResourceScopeProps) => React.createElement('p', null, `Config ${props.root}/${props.slug}`)
const Memory = (props: { slug?: string | null; cwd?: string | null }) => React.createElement('p', null, `Memory ${props.slug || props.cwd}`)
const Quota = () => null
const noop = () => {}
function defaults(): React.ComponentProps<typeof SessionView> {
  return {
    api: codexApi,
    providerId: 'codex',
    root: 'a',
    openSlug: 'project-a',
    active: mockNavSession({ id: 'one' }),
    tab: 'conversation',
    SESSION_TABS: [
      { k: 'conversation', label: 'Conversation' },
      { k: 'raw', label: 'Raw' },
      { k: 'config', label: 'Config' },
    ],
    changeTab: vi.fn(),
    disabledTab: () => false,
    RateLimitsBar: Quota,
    usageInfo: 'Usage detail',
    docsUrl: 'https://fixture.invalid/docs',
    docsTitle: 'Docs',
    conn: 'live',
    sinceEvent: null,
    error: null,
    setError: noop,
    mainRef: { current: null },
    onMainScroll: noop,
    termDraft: null,
    navigationTarget: null,
    terminalTarget: { root: 'a', id: 'one' },
    refetchActive: noop,
    sessionData: { summary: mockNavSession({ id: 'one' }), timeline: [] },
    Conversation: Text,
    openSessionById: noop,
    subagentCtx: null,
    canFork: false,
    forkFromReply: noop,
    shownPanes: [],
    curTermKey: null,
    TerminalPanel: Quota,
    terminalOf: () => undefined,
    setTermDraft: noop,
    refreshTerminals: noop,
    runningTermKeys: new Set(),
    ResourcesView: Resource,
    SubagentsView: Quota,
    MemoryView: Memory,
    Stats: Quota,
    stats: null,
    statsFocus: undefined,
    subagents: undefined,
    termCtxUsed: null,
    onOpenStats: noop,
    appActive: true,
    raw: { records: [] },
    nestedSubagents: false,
    fillConfig: true,
  }
}

test('shared session view preserves navigation controls and keeps terminal panes mounted across views', () => {
  const mounted = vi.fn(),
    unmounted = vi.fn()
  function Terminal() {
    useEffect(() => {
      mounted()
      return unmounted
    }, [])
    return React.createElement('p', null, 'Terminal pane')
  }
  const ctx = { ...defaults(), TerminalPanel: Terminal, shownPanes: [{ key: 'term', target: { root: 'a', id: 'one' } }], curTermKey: 'term' }
  const view = render(React.createElement(SessionView, ctx))
  expect(view.getByText('Transcript body')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Raw' }))
  expect(ctx.changeTab).toHaveBeenCalledWith('raw')
  view.rerender(React.createElement(SessionView, { ...ctx, tab: 'raw' }))
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(unmounted).not.toHaveBeenCalled()
  expect(view.getByText('Terminal pane').closest('.hidden')).toBeTruthy()
})

test('shared session view retains distinct Config containers and provider Memory arguments', () => {
  const ctx = defaults()
  const view = render(React.createElement(SessionView, { ...ctx, tab: 'config' }))
  expect(view.getByText('Config a/project-a').closest('.min-h-0')).toBeTruthy()
  view.rerender(React.createElement(SessionView, { ...ctx, nestedSubagents: true, fillConfig: false, tab: 'config' }))
  expect(view.getByText('Config a/project-a').closest('.overflow-y-auto')).toBeTruthy()
  view.rerender(React.createElement(SessionView, { ...ctx, nestedSubagents: true, fillConfig: false, tab: 'memory' }))
  expect(view.getByText('Memory project-a')).toBeTruthy()
})
