import { PROVIDERS } from '../registry.js'
import { makeDispatch } from '../shared/dispatch.js'
import { createFolderCatalog } from './catalog.js'
import { openHandoffStore } from './handoffStore.js'
import { createHandoffService } from './handoff.js'
import { listLiveTmux, listTerminals } from '../shared/terminal.js'
import { dashboards } from './dashboards.js'
import { createHomeService } from './home.js'

const catalog = createFolderCatalog(PROVIDERS)
const home = createHomeService(PROVIDERS)
const handoff = createHandoffService({ providers: PROVIDERS, getStore: openHandoffStore, terminals: () => [...listLiveTmux(), ...listTerminals()] })
export const invalidateDeck = () => { catalog.invalidate(); home.invalidate() }
export const dispatch = makeDispatch({
  'GET /api/home': (q) => { if (q.get('fresh') === '1' && !q.get('cursor')) catalog.invalidate(); return home.read(q) },
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
  'GET /api/folders': (q) => { if (q.get('fresh') === '1') catalog.invalidate(); return catalog.list() },
})
