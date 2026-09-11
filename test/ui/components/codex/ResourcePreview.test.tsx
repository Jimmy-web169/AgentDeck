import { mockProviderApi } from '../../../helpers/query.ts'
import type { ResourceContext } from '../../../../src/components/codex/ResourcePreview.tsx'
import type { CodexResources } from '../../../../src/api/models.ts'
const resourceData = (overrides: Partial<CodexResources> = {}): CodexResources => ({
  scope: 'user',
  codexDir: '',
  summary: {},
  features: {},
  agentLimits: {},
  agents: [],
  skills: [],
  rules: [],
  hooks: [],
  mcpServers: [],
  ...overrides,
})
const resourceContext = (overrides: Omit<Partial<ResourceContext>, 'data'> & { data?: Partial<CodexResources> }): ResourceContext => ({
  sel: null,
  pendingDel: null,
  setPendingDel() {},
  openForm() {},
  isProject: false,
  del() {},
  ...overrides,
  data: resourceData(overrides.data),
})
// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { screen, cleanup, waitFor } from '@testing-library/react'
import { renderWithQuery as render } from '../../../helpers/query.ts'
import { userEvent } from '@testing-library/user-event'
import { ResourcePreview } from '../../../../src/components/codex/ResourcePreview.tsx'
import ResourcesView from '../../../../src/components/codex/ResourcesView.tsx'
import { ProviderApiContext } from '../../../../src/api/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Codex instructions preview opens the correct editor with its current contents', async () => {
  const openForm = vi.fn()
  const ctx = resourceContext({
    sel: { kind: 'agentsMd' },
    data: { agentsMd: { name: 'AGENTS.md', content: 'Follow project conventions' } },
    openForm,
    isProject: true,
  })
  const view = render(<ResourcePreview ctx={ctx} />)
  expect(screen.getByText('Follow project conventions')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(openForm).toHaveBeenCalledWith('agentsMd', 'Follow project conventions')
  view.rerender(<ResourcePreview ctx={{ ...ctx, data: resourceData() }} />)
  await userEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(openForm).toHaveBeenLastCalledWith('agentsMd', '')
})

test('Codex hook preview requires confirmation and cancel preserves the hook', async () => {
  const setPendingDel = vi.fn(),
    del = vi.fn()
  const ctx = resourceContext({ sel: { kind: 'hooks' }, data: { hooks: ['SessionStart'] }, openForm: vi.fn(), setPendingDel, del, pendingDel: null })
  const view = render(<ResourcePreview ctx={ctx} />)
  await userEvent.click(screen.getByTitle('remove all SessionStart hooks'))
  expect(setPendingDel).toHaveBeenCalledWith('hook:SessionStart')
  expect(del).not.toHaveBeenCalled()
  view.rerender(<ResourcePreview ctx={{ ...ctx, pendingDel: 'hook:SessionStart' }} />)
  await userEvent.click(screen.getByRole('button', { name: 'no' }))
  expect(setPendingDel).toHaveBeenLastCalledWith(null)
  expect(del).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'delete? yes' }))
  expect(del).toHaveBeenCalledWith('hook', 'SessionStart')
})

test('Codex resource actions retain keyboard focus across parent data updates', async () => {
  const data = {
    codexDir: '/synthetic/.codex',
    agentsMd: { name: 'AGENTS.md', content: 'Follow project conventions' },
    agents: [],
    skills: [],
    rules: [],
    hooks: [],
    mcpServers: [],
    summary: {},
    features: {},
    agentLimits: {},
  }
  const api = mockProviderApi('codex', {
    resources: vi.fn(async (_ref: Parameters<import('../../../../src/api/providerApi.ts').ProviderClient['resources']>[0]) => ({ ...resourceData(data) })),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://fixture.invalid')
      expect(url.pathname).toBe('/api/codex/resources')
      return new Response(JSON.stringify(await api.resources({ root: url.searchParams.get('root') || '' })))
    })
  )
  const view = render(
    <ProviderApiContext.Provider value={api}>
      <ResourcesView root="fixture" />
    </ProviderApiContext.Provider>
  )
  const button = await screen.findByRole('button', { name: 'edit' })
  button.focus()
  view.rerender(
    <ProviderApiContext.Provider value={api}>
      <ResourcesView root="fixture" slug="/synthetic/project" />
    </ProviderApiContext.Provider>
  )
  await waitFor(() => expect(api.resources).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'edit' })).toBe(button)
  expect(document.activeElement).toBe(button)
  await userEvent.keyboard('{Enter}')
  expect(screen.getByText('Edit AGENTS.md')).toBeTruthy()
  expect(screen.getByDisplayValue('Follow project conventions')).toBeTruthy()
})
