import { validated, type Handler, type InputPolicy } from './validate.ts'
import type { BriefContext } from './handoff.ts'

// Normalized request fields shared by the route policies and provider handlers.
// The untrusted body enters through validated(); provider-specific operations
// still check their own required fields and cut semantics.
export interface ProviderRequest extends Record<string, unknown> {
  root?: string
  slug?: string
  id?: string
  path?: string
  label?: string
  cwd?: string
  title?: string
  launchId?: string
  terminalKey?: string
  bindSessionId?: string
  kind?: string
  name?: string
  content?: string
  scope?: string
  ref?: string
  what?: string
  brief?: Omit<BriefContext, 'providerLabel'>
  legacyDraft?: boolean
  args?: unknown[]
  nickname_candidates?: unknown[]
  event?: string
}

const strings = (...fields: string[]) => Object.fromEntries(fields.map((field) => [field, 'string' as const]))
const optional = strings('root', 'slug', 'id', 'cwd', 'title', 'launchId', 'terminalKey')
interface RequestFields {
  session?: string[]
  resource?: string[]
}
export function providerPolicy(route: string, fields: RequestFields = {}): InputPolicy {
  switch (route) {
    case 'POST /api/roots':
      return { required: ['path'], optional: strings('label') }
    case 'POST /api/roots/label':
      return { required: ['id'], optional: strings('label') }
    case 'DELETE /api/roots':
      return { query: ['id'] }
    case 'POST /api/probe/run':
    case 'POST /api/probe/accept':
      return { optional: strings('root') }
    case 'GET /api/sessions':
      return { query: ['slug'] }
    case 'GET /api/session':
    case 'GET /api/raw':
    case 'GET /api/subagents':
    case 'DELETE /api/session':
      return { query: fields.session || ['id'] }
    case 'POST /api/resource':
      return {
        required: fields.resource || ['root', 'kind'],
        optional: strings('slug', 'scope', 'name', 'content', 'description', 'body', 'command', 'event', 'transport', 'url', 'id'),
      }
    case 'DELETE /api/resource':
      return { query: ['kind', 'name'] }
    case 'POST /api/skill-run':
      return { required: ['root', 'ref'], optional: strings('slug') }
    case 'POST /api/open':
      return { required: ['root', 'what'], optional }
    case 'POST /api/terminal':
      return { required: ['root'], optional: { ...optional, brief: 'object' } }
    case 'DELETE /api/terminal':
      return { query: ['key'] }
    default:
      return {}
  }
}

// Provider route factory. Provider adapters own data layout and capabilities;
// the common request inventory is declared exactly once here.
export const PROVIDER_METHODS = {
  'GET /api/roots': 'getRoots',
  'POST /api/roots': 'postRoots',
  'POST /api/roots/label': 'postRootLabel',
  'DELETE /api/roots': 'deleteRoots',
  'POST /api/probe/run': 'postProbeRun',
  'POST /api/probe/accept': 'postProbeAccept',
  'GET /api/activity': 'getActivity',
  'GET /api/projects': 'getProjects',
  'GET /api/sessions': 'getSessions',
  'GET /api/session': 'getSession',
  'DELETE /api/session': 'deleteSession',
  'GET /api/raw': 'getRaw',
  'GET /api/subagents': 'getSubagents',
  'GET /api/stats': 'getStats',
  'GET /api/history': 'getHistory',
  'GET /api/usage': 'getUsage',
  'GET /api/version': 'getVersion',
  'GET /api/memory': 'getMemory',
  'GET /api/plugins': 'getPlugins',
  'GET /api/resources': 'getResources',
  'POST /api/resource': 'postResource',
  'DELETE /api/resource': 'deleteResource',
  'POST /api/skill-run': 'skills',
  'POST /api/open': 'postOpen',
  'GET /api/browse': 'getBrowse',
  'GET /api/pick-folder': 'getPickFolder',
  'POST /api/terminal': 'postTerminal',
  'GET /api/terminals': 'getTerminals',
  'GET /api/live-terminals': 'getLiveTerminals',
  'GET /api/active-sessions': 'getActiveSessions',
  'DELETE /api/terminal': 'deleteTerminal',
}
const READ_ONLY_METHODS = new Set(['postResource', 'deleteResource', 'skills'])

export function makeProviderRoutes(data: Record<string, unknown> & { requestFields?: RequestFields }) {
  return Object.fromEntries(
    Object.entries(PROVIDER_METHODS).map(([route, method]) => {
      // Null explicitly declares an unsupported write capability. Missing methods
      // are adapter mistakes and must not silently become successful empty routes.
      const handler = data[method] === null && READ_ONLY_METHODS.has(method) ? data.notWritable : data[method]
      if (typeof handler !== 'function') throw new TypeError(`${data.id || 'provider'}: missing handler for ${route}`)
      return [route, validated(handler as Handler, providerPolicy(route, data.requestFields))]
    })
  )
}
