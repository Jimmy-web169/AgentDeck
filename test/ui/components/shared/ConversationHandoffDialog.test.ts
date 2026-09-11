import { required } from '../../../helpers/assert.ts'
import { mockProvider } from '../../../helpers/query.ts'
// @vitest-environment jsdom
import { createElement } from 'react'
import { renderStaticWithQuery as renderToStaticMarkup } from '../../../helpers/query.ts'
import Dialog from '../../../../src/components/shared/ConversationHandoffDialog.tsx'
// Original group: conversation-export-ui. Case names and assertions are retained.
import { test, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import TabStrip from '../../../../src/components/shared/TabStrip.tsx'
import { describe } from 'vitest'
import assert from 'node:assert/strict'
import { HOME_VIEWS, loadTabs, TABS_KEY } from '../../../../src/lib/tabs.ts'
import { fromHash, toHash } from '../../../../src/lib/route.ts'

describe('ConversationHandoffDialog', () => {
  const dialog = (mode: string) =>
    renderToStaticMarkup(
      createElement(Dialog, {
        mode,
        source: { provider: 'future', root: 'r', id: 's', cwd: '/current/project', title: 'Work' },
        providers: [],
        onOpen() {},
        onClose() {},
      })
    )

  test('export-only and send dialogs explain full history and have no draft/approval workflow', () => {
    const exported = dialog('export'),
      sending = dialog('send')
    assert.match(exported, /Save JSONL only/)
    assert.doesNotMatch(exported, /Receiving AI \/ root/)
    assert.match(exported, /Exporting does not start or send anything/)
    assert.match(sending, /Receiving AI \/ root/)
    assert.match(sending, /Save JSONL &amp; open new tab/)
    assert.match(sending, /The new AI uses the same folder/)
    for (const html of [exported, sending]) {
      assert.doesNotMatch(html, /Approve snapshot|Create staging draft|Last visible messages/)
      assert.match(html, /including subagent conversations/)
      assert.match(html, /\.agentdeck\/handoffs/)
      assert.doesNotMatch(html, /<input[^>]*value="\/current\/project"/, 'folder is not an editable launch field')
    }
  })

  test('global context navigation is retired; old links and persisted context tabs land safely on Activity', () => {
    assert.equal(
      HOME_VIEWS.some((v) => v.k === 'context'),
      false
    )
    assert.equal(toHash({ kind: 'context', contextId: 'old' }), '#/')
    assert.deepEqual(fromHash('#/context/old', ['claude']), { provider: null, view: 'activity' })
    const oldStorage = globalThis.localStorage
    try {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) =>
          key === TABS_KEY ? JSON.stringify({ tabs: [{ key: 'old', target: { kind: 'context', contextId: 'old' } }], activeKey: 'old' }) : null,
      })
      assert.deepEqual(required(loadTabs()).tabs[0].target, { provider: null, view: 'activity', focus: null })
    } finally {
      if (oldStorage === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
      else globalThis.localStorage = oldStorage
    }
    const strip = renderToStaticMarkup(
      createElement(TabStrip, {
        onSelect() {},
        onClose() {},
        onReorder() {},
        onSearch() {},
        onHome() {},
        onCopyLink() {},
        onCloseOthers() {},
        onCloseRight() {},
        onNew() {},
        tabs: [{ key: 'saved', target: { provider: 'codex', root: 'r', slug: '/fixture', id: 's', title: 'Saved conversation' } }],
        providers: [mockProvider('codex', 'Codex')],
        activeKey: 'saved',
        liveCount: 2,
        onLive() {},
      })
    )
    assert.match(strip, /Saved conversation/)
    assert.match(strip, /Live <span[^>]*>2<\/span>/)
    assert.doesNotMatch(strip, /Continue with another AI|Export JSONL|Context/)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})
