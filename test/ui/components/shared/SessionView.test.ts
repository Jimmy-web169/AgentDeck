import { mockNavSession, renderWithQuery } from '../../../helpers/query.ts'
// @vitest-environment jsdom
import React, { useEffect } from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { test, expect, vi, afterEach } from 'vitest'
import SessionView from '../../../../src/components/shared/SessionView.tsx'
import { codexApi } from '../../../../src/api/index.ts'
import { DEFAULT_PANE_SHARES, getPrefs, setPref } from '../../../../src/lib/prefs.ts'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setPref('subagentPane', DEFAULT_PANE_SHARES)
})
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
    hasSubagents: false,
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

test('Show sub-agents is offered only once a session has spawned subagents, opens on the agent list, and its divider resizes the pane', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json({ children: [] }))
  )
  const ctx = { ...defaults(), subagentCtx: { root: 'a', id: 'one' }, hasSubagents: false }
  const view = renderWithQuery(React.createElement(SessionView, ctx))
  expect(view.queryByRole('button', { name: /sub-agents/ })).toBeNull()
  view.rerender(React.createElement(SessionView, { ...ctx, hasSubagents: true }))
  fireEvent.click(view.getByRole('button', { name: 'Show sub-agents' }))
  expect(view.getByRole('button', { name: 'Hide sub-agents' }).getAttribute('aria-pressed')).toBe('true')
  expect(view.getByLabelText('Sub-agent pane')).toBeTruthy()
  expect(view.getByLabelText('Subagent list')).toBeTruthy()
  await view.findByText(/No subagents in this session yet/)
  // Without matchMedia the panes stack, so the divider is a horizontal line the
  // reader drags up and down; its position is the pane's share of the row.
  const panes = view.container.querySelector('.conversation-panes') as HTMLElement
  const divider = view.getByRole('separator', { name: 'Resize sub-agent pane' })
  expect(divider.getAttribute('aria-orientation')).toBe('horizontal')
  expect(panes.style.getPropertyValue('--subagent-pane')).toBe('50%')
  vi.spyOn(panes, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 1000,
    width: 1000,
    height: 1000,
    toJSON: () => ({}),
  })
  fireEvent.mouseDown(divider, { clientX: 500, clientY: 500, button: 0 })
  fireEvent.mouseMove(window, { clientX: 500, clientY: 300 })
  fireEvent.mouseUp(window)
  expect(panes.style.getPropertyValue('--subagent-pane')).toBe('70%')
  expect(divider.getAttribute('aria-valuenow')).toBe('70')
  // One preference write per gesture, through the preference store.
  expect(getPrefs().subagentPane).toEqual({ stacked: 0.7, beside: 0.42 })
  expect(JSON.parse(localStorage.getItem('agentdeck_prefs') || '{}').subagentPane).toEqual({ stacked: 0.7, beside: 0.42 })
  fireEvent.keyDown(divider, { key: 'ArrowDown' })
  expect(panes.style.getPropertyValue('--subagent-pane')).toBe('68%')
  expect(getPrefs().subagentPane.stacked).toBeCloseTo(0.68)
  // The pane never collapses either side of the row.
  fireEvent.mouseDown(divider, { clientX: 500, clientY: 500, button: 0 })
  fireEvent.mouseMove(window, { clientX: 500, clientY: 990 })
  fireEvent.mouseUp(window)
  expect(panes.style.getPropertyValue('--subagent-pane')).toBe('20%')
  fireEvent.doubleClick(divider)
  expect(panes.style.getPropertyValue('--subagent-pane')).toBe('50%')
  // A session without agents never shows the pane, even while the toggle is on.
  view.rerender(React.createElement(SessionView, { ...ctx, hasSubagents: false }))
  expect(view.queryByLabelText('Sub-agent pane')).toBeNull()
  expect(view.queryByRole('separator')).toBeNull()
  expect(view.queryByRole('button', { name: /sub-agents/ })).toBeNull()
})
