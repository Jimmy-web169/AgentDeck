import { makeDispatch } from '../../shared/dispatch.ts'
import { makeProviderRoutes } from '../../shared/providerRoutes.ts'
import { postFork, DATA } from './data.ts'

const EXTRA = {
  'POST /api/fork': postFork,
}
export const dispatch = makeDispatch({ ...makeProviderRoutes(DATA), ...EXTRA })
