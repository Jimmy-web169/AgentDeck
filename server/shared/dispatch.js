// Shared HTTP dispatcher. Maps a "METHOD /api/path" key to its handler and
// normalizes the result/errors into { status, body }. Each provider builds its
// own route table and wraps it: `export const dispatch = makeDispatch(ROUTES)`.
export function makeDispatch(routes) {
  return async function dispatch(method, pathname, query, body) {
    const handler = routes[`${method} ${pathname}`]
    if (!handler) return { status: 404, body: { error: `no route: ${method} ${pathname}` } }
    try {
      return { status: 200, body: await handler(query, body) }
    } catch (e) {
      return { status: e.status || 500, body: { error: e.message } }
    }
  }
}
