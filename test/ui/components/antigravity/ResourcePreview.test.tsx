import type { ResourceContext } from '../../../../src/components/antigravity/ResourcePreview.tsx'
import type { AntigravityResources } from '../../../../src/api/models.ts'
const resourceData = (overrides: Partial<AntigravityResources> = {}): AntigravityResources => ({
  scope: 'user',
  base: '',
  configDir: '',
  skills: [],
  plugins: [],
  hooks: [],
  rules: [],
  mcpServers: [],
  ...overrides,
})
const resourceContext = (overrides: Omit<Partial<ResourceContext>, 'data'> & { data?: Partial<AntigravityResources> }): ResourceContext => ({
  sel: null,
  isProject: false,
  trustedList: [],
  skills: [],
  plugins: [],
  hooks: [],
  rules: [],
  mcp: [],
  ...overrides,
  data: resourceData(overrides.data),
})
// @vitest-environment jsdom
import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ResourcePreview } from '../../../../src/components/antigravity/ResourcePreview.tsx'

afterEach(cleanup)

test('Antigravity settings distinguish shared and workspace scope without offering cross-source editing', () => {
  const ctx = resourceContext({
    sel: { kind: 'settings' },
    data: { base: '/fixture/agy', settings: { theme: 'local' }, sharedSettings: { theme: 'shared' } },
    isProject: false,
  })
  const view = render(<ResourcePreview ctx={ctx} />)
  expect(screen.getByText('~/.gemini/config/settings.json')).toBeTruthy()
  expect(view.container.textContent).toContain('shared')
  expect(screen.queryByRole('button', { name: /save|edit/i })).toBeNull()
  view.rerender(<ResourcePreview ctx={{ ...ctx, isProject: true }} />)
  expect(screen.getByText('.agents/settings.json')).toBeTruthy()
  expect(screen.queryByText('~/.gemini/config/settings.json')).toBeNull()
  expect(view.container.textContent).toContain('local')
})

test('Antigravity skill preview keeps provenance and handles a disappeared selected skill', () => {
  const ctx = resourceContext({
    sel: { kind: 'skill', id: '/fixture/skills/review' },
    data: {},
    skills: [
      {
        path: '/fixture/skills/review',
        scope: 'project',
        dir: '/fixture/skills/review',
        name: 'Review changes',
        source: 'workspace',
        content: 'Read the diff first.',
      },
    ],
  })
  const view = render(<ResourcePreview ctx={ctx} />)
  expect(screen.getByText('Read the diff first.')).toBeTruthy()
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(screen.getByText('/fixture/skills/review/SKILL.md')).toBeTruthy()
  view.rerender(<ResourcePreview ctx={{ ...ctx, skills: [] }} />)
  expect(view.container.textContent).toBe('')
})
