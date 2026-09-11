import { makeDispatch } from '../../shared/dispatch.ts'
import { makeProviderRoutes } from '../../shared/providerRoutes.ts'
import { DATA } from './data.ts'

const EXTRA = {}
export const dispatch = makeDispatch({ ...makeProviderRoutes(DATA), ...EXTRA })
