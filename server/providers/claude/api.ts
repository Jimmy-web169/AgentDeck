import { makeDispatch } from '../../shared/dispatch.ts'
import { makeProviderRoutes } from '../../shared/providerRoutes.ts'
import { validated, type Handler } from '../../shared/validate.ts'
import { postFork, DATA, getSubagent, postMemory, deleteMemory, getResource } from './data.ts'

const EXTRA = {
  'POST /api/fork': postFork,
  'GET /api/subagent': validated(getSubagent, { query: ['slug', 'session', 'agent'] }),
  'POST /api/memory': validated(postMemory as Handler, { required: ['root', 'slug', 'name'], optional: { content: 'string' } }),
  'DELETE /api/memory': validated(deleteMemory, { query: ['slug', 'name'] }),
  'GET /api/resource': validated(getResource, { query: ['kind', 'name'] }),
}
export const dispatch = makeDispatch({ ...makeProviderRoutes(DATA), ...EXTRA })
