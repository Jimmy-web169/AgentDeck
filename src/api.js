// Provider-aware API client. A module-level provider id prefixes every request
// as /api/<provider>/...; App calls setProvider() before mounting a provider's
// subtree (which remounts on switch). Methods that differ in signature between
// providers branch on getProvider(): claude addresses sessions by (slug,id) and
// edits resources as free-text files; codex addresses by id and uses scoped
// structured resources. Components keep calling api.xxx(...) provider-naturally.

let PROVIDER = 'claude'
export function setProvider(p) {
  PROVIDER = p
}
export function getProvider() {
  return PROVIDER
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
const etags = new Map()
const ETAG_MAX = 100

async function req(method, path, { params = {}, body } = {}) {
  const qs = new URLSearchParams(params).toString()
  const url = `/api/${PROVIDER}/${path}${qs ? `?${qs}` : ''}`
  const cached = method === 'GET' ? etags.get(url) : null
  const res = await fetch(url, {
    method,
    cache: method === 'GET' ? 'no-store' : undefined,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : null),
      ...(cached ? { 'If-None-Match': cached.etag } : null),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 304 && cached) {
    etags.delete(url) // LRU bump: a 304 is a use, keep hot pollers resident
    etags.set(url, cached)
    return cached.data
  }
  // tolerate non-JSON error bodies (e.g. a plain-text 403) instead of throwing
  // an opaque "Unexpected token" JSON parse error
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text }
  }
  if (!res.ok) throw new Error(data.error || text || `HTTP ${res.status}`)
  const etag = method === 'GET' ? res.headers.get('ETag') : null
  if (etag) {
    etags.delete(url)
    etags.set(url, { etag, data })
    if (etags.size > ETAG_MAX) etags.delete(etags.keys().next().value)
  }
  return data
}
const get = (path, params) => req('GET', path, { params })

export const api = {
  // ---- shared core ----
  roots: () => get('roots'),
  addRoot: (path, label) => req('POST', 'roots', { body: { path, label } }),
  removeRoot: (id) => req('DELETE', 'roots', { params: { id } }),
  projects: (root) => get('projects', { root }),
  sessions: (root, slug) => get('sessions', { root, slug }),
  stats: (root) => get('stats', { root }),
  history: (root) => get('history', { root }),
  usage: (root) => get('usage', { root }),
  plugins: (root) => get('plugins', { root }),
  skillRun: (body) => req('POST', 'skill-run', { body }),
  browse: (path) => get('browse', path ? { path } : {}),
  pickFolder: () => get('pick-folder'),
  terminal: (body) => req('POST', 'terminal', { body }),
  terminals: () => get('terminals'),
  terminalStop: (key) => req('DELETE', 'terminal', { params: { key } }),

  // ---- session-addressed (claude: root,slug,id · codex: root,id) ----
  session: (root, a, b) => get('session', b !== undefined ? { root, slug: a, id: b } : { root, id: a }),
  raw: (root, a, b) => get('raw', b !== undefined ? { root, slug: a, id: b } : { root, id: a }),
  subagents: (root, a, b) => get('subagents', b !== undefined ? { root, slug: a, id: b } : { root, id: a }),
  // claude-only: single sub-agent / workflow-run transcript
  subagent: (root, slug, session, run, agent) => get('subagent', run ? { root, slug, session, run, agent } : { root, slug, session, agent }),
  // claude: (root,slug) · codex: (root)
  memory: (root, slug) => get('memory', slug !== undefined ? { root, slug } : { root }),
  // claude-only: move a session (transcript + sub-agent sidecar) to the OS trash
  deleteSession: (root, slug, id) => req('DELETE', 'session', { params: { root, slug, id } }),
  // claude-only: write / trash a per-project memory file
  saveMemory: (root, slug, name, content) => req('POST', 'memory', { body: { root, slug, name, content } }),
  deleteMemory: (root, slug, name) => req('DELETE', 'memory', { params: { root, slug, name } }),

  // ---- resources (signatures differ by provider) ----
  resources: (root, a, b) => {
    if (PROVIDER === 'codex') return get('resources', a === 'project' && b ? { root, scope: a, slug: b } : { root, scope: 'user' })
    return get('resources', a ? { root, slug: a } : { root }) // claude: (root, slug?)
  },
  // claude-only: read single resource
  resource: (root, kind, name, slug) => get('resource', slug ? { root, kind, name, slug } : { root, kind, name }),
  // claude-only: write free-text resource
  saveResource: (root, kind, name, content, slug) =>
    req('POST', 'resource', { body: slug ? { root, kind, name, content, slug } : { root, kind, name, content } }),
  // codex-only: create structured resource
  createResource: (body) => req('POST', 'resource', { body }),
  // claude: (root,kind,name,stamp,slug?) · codex: (root,scope,slug,kind,name)
  deleteResource: (...args) => {
    if (PROVIDER === 'codex') {
      const [root, scope, slug, kind, name] = args
      return req('DELETE', 'resource', { params: scope === 'project' && slug ? { root, scope, slug, kind, name } : { root, scope: 'user', kind, name } })
    }
    const [root, kind, name, stamp, slug] = args
    return req('DELETE', 'resource', { params: slug ? { root, kind, name, stamp, slug } : { root, kind, name, stamp } })
  },

  // ---- open local app (claude: root,slug,id,what,cwd · codex: root,id,what,cwd,slug) ----
  open: (...args) => {
    if (PROVIDER === 'codex') {
      const [root, id, what, cwd, slug] = args
      return req('POST', 'open', { body: { root, id, what, cwd, slug } })
    }
    const [root, slug, id, what, cwd] = args
    return req('POST', 'open', { body: { root, slug, id, what, cwd } })
  },
}
