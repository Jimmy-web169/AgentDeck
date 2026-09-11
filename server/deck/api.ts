import { makeDispatch } from '../shared/dispatch.ts'
import { validated, type Handler, type InputPolicy } from '../shared/validate.ts'
import type { ServerProvider } from '../registry.ts'
import { createFolderCatalog } from './catalog.ts'
import { openHandoffStore } from './handoffStore.ts'
import { createHandoffService } from './handoff.ts'
import { listLiveTmux, listTerminals } from '../shared/terminal.ts'
import { dashboards } from './dashboards.ts'
import { createHomeService } from './home.ts'

interface DeckRequest {
  id: string
  key: string
  keys?: string[]
  title?: string
  source?: unknown
  task?: string
  target?: unknown
}
export function createDeckApi(providers: Record<string, ServerProvider>) {
  const catalog = createFolderCatalog(providers)
  const home = createHomeService(providers)
  const handoff = createHandoffService({ providers, getStore: openHandoffStore, terminals: () => [...listLiveTmux(), ...listTerminals()] })
  const invalidate = () => {
    catalog.invalidate()
    home.invalidate()
  }
  const routes: Record<string, (q: URLSearchParams, body: DeckRequest) => unknown> = {
    'GET /api/home': (q) => {
      if (q.get('fresh') === '1' && !q.get('cursor')) catalog.invalidate()
      return home.read(q)
    },
    'GET /api/dashboards': () => dashboards.list(),
    'GET /api/dashboard': (q) => dashboards.get(q.get('id')),
    'POST /api/dashboard/create': (_q, b) => dashboards.create(b.keys, b.title),
    'POST /api/dashboard/attach': (_q, b) => dashboards.attach(b.id),
    'POST /api/dashboard/control': (_q, b) => dashboards.control(b.id, b.key),
    'POST /api/dashboard/end': (_q, b) => dashboards.stop(b.id),
    'POST /api/dashboard/remove': (_q, b) => dashboards.remove(b.id, b.key),
    'GET /api/handoff/destinations': () => ({ destinations: handoff.destinations() }),
    'POST /api/handoff/export': (_q, b) => handoff.exportHistory(b),
    'POST /api/handoff/send': (_q, b) => handoff.dispatch(b),
    'GET /api/handoff/status': (q) => handoff.status({ id: q.get('id') }),
    'GET /api/folders': (q) => {
      if (q.get('fresh') === '1') catalog.invalidate()
      return catalog.list()
    },
  }
  const inputs: Record<string, InputPolicy> = {
    'GET /api/dashboard': { query: ['id'] },
    'POST /api/dashboard/create': { required: [], optional: { keys: 'strings', title: 'string' } },
    'POST /api/dashboard/attach': { required: ['id'] },
    'POST /api/dashboard/control': { required: ['id', 'key'] },
    'POST /api/dashboard/end': { required: ['id'] },
    'POST /api/dashboard/remove': { required: ['id', 'key'] },
    'POST /api/handoff/export': { required: [], optional: { source: 'object', task: 'string' } },
    'POST /api/handoff/send': { required: ['id'], optional: { target: 'object' } },
    'GET /api/handoff/status': { query: ['id'] },
  }
  // Each narrower handler is invoked only after its matching transport policy.
  const dispatch = makeDispatch(
    Object.fromEntries(Object.entries(routes).map(([route, handler]) => [route, validated(handler as Handler, inputs[route] || {})]))
  )

  return { dispatch, invalidate }
}
