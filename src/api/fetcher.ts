export type QueryValue = string | number | boolean | null | undefined
export type RequestOptions = {
  method?: string
  params?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
  cache?: RequestCache
  revalidate?: boolean
}
// Conditional-GET store: url -> { etag, data }. When the server replies 304
// we return the exact same object reference as last time, so a poller's
// setState bails out and nothing re-renders. cache:'no-store' keeps the
// browser's own HTTP cache from answering the revalidation for us (it would
// hand back a fresh-looking 200 with a *new* object every time).
// Because 304s re-serve the SAME object, callers must treat returned data as
// immutable — mutating it would corrupt what the next poll hands back.
// LRU by Map insertion order (delete+set on every hit, including 304s).
// Entries hold whole payloads (timelines can be sizeable), so keep the count
// modest; polled views only touch a handful of URLs at a time anyway.
// revalidate:false preserves Deck's unconditional reads without retaining tags.

export function createFetcher({ fetch: fetchImpl, capacity = 100 }: { fetch?: typeof globalThis.fetch; capacity?: number } = {}) {
  const etags: Map<string, { etag: string; data: unknown }> = new Map()

  async function request<T>(
    pathname: string,
    { method = 'GET', params = {}, body, signal, cache = method === 'GET' ? 'no-store' : undefined, revalidate = true }: RequestOptions = {}
  ): Promise<T> {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()
    const url = `${pathname}${query ? `?${query}` : ''}`
    const cached = method === 'GET' && revalidate ? etags.get(url) : undefined
    const response = await (fetchImpl || globalThis.fetch)(url, {
      method,
      cache,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cached ? { 'If-None-Match': cached.etag } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    if (response.status === 304 && cached) {
      etags.delete(url)
      etags.set(url, cached)
      return cached.data as T
    }
    const text = await response.text()

    let data: unknown
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { error: text }
    }
    if (!response.ok) {
      const error = data && typeof data === 'object' && 'error' in data ? data.error : null
      throw Object.assign(new Error(String(error || text || `HTTP ${response.status}`)), { status: response.status })
    }
    const etag = method === 'GET' && revalidate ? response.headers.get('ETag') : null
    if (etag) {
      etags.delete(url)
      etags.set(url, { etag, data })
      if (etags.size > capacity) {
        const oldest = etags.keys().next().value
        if (oldest !== undefined) etags.delete(oldest)
      }
    }
    return data as T
  }
  return request
}

export const request = createFetcher()
