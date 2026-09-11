// Shared HTTP dispatcher. Maps a "METHOD /api/path" key to its handler and
// normalizes the result/errors into { status, body }. Each provider builds its
// own route table and wraps it: `export const dispatch = makeDispatch(ROUTES)`.
import type { Handler } from './validate.ts'
export function makeDispatch(routes: Record<string, Handler>) {
  return async function dispatch(method: string, pathname: string, query: URLSearchParams, body?: unknown) {
    const handler = routes[`${method} ${pathname}`]
    if (!handler) return { status: 404, body: { error: `no route: ${method} ${pathname}` } }
    try {
      return { status: 200, body: await handler(query, body) }
    } catch (e) {
      const status = e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : 500
      const message = e && typeof e === 'object' && 'message' in e ? e.message : undefined
      return { status: status || 500, body: { error: message } }
    }
  }
}
