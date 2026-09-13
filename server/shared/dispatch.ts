// Shared HTTP dispatcher. Maps a "METHOD /api/path" key to its handler and
// normalizes the result/errors into { status, body }. Each provider builds its
// own route table and wraps it: `export const dispatch = makeDispatch(ROUTES)`.
// A handler's own status is its answer; anything else is a 500 whose cause
// rides along so the host can log the stack (the body never carries it).
import type { Handler } from './validate.ts'
export interface DispatchResult {
  status: number
  body: unknown
  cause?: unknown
}
export function makeDispatch(routes: Record<string, Handler>) {
  return async function dispatch(method: string, pathname: string, query: URLSearchParams, body?: unknown): Promise<DispatchResult> {
    const handler = routes[`${method} ${pathname}`]
    if (!handler) return { status: 404, body: { error: `no route: ${method} ${pathname}` } }
    try {
      return { status: 200, body: await handler(query, body) }
    } catch (e) {
      const chosen = e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : null
      const message = e && typeof e === 'object' && 'message' in e ? e.message : undefined
      const result: DispatchResult = { status: chosen || 500, body: { error: message } }
      if (chosen === null) result.cause = e // a status the handler chose is its answer, not a failure to trace
      return result
    }
  }
}
