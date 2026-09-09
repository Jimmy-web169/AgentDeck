// Hash deep links for the active tab:
//   #/<provider>/<root>/<slug>/<id>     a session
//   #/<provider>/<root>/<slug>          a project
//   #/<provider>/<root>                 a tracked folder
//   #/<provider>                        a provider's app as-is
//   #/home/<view>                       a Home page (stats, history, …)
//   #/                                  Home (Activity)
// Every segment is URI-encoded (codex slugs are absolute cwds, claude slugs
// contain nothing worse than '-', but encode uniformly).

const enc = (s) => encodeURIComponent(String(s))
const dec = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function toHash(target) {
  if (!target?.provider) {
    const v = target?.view
    return v && v !== 'activity' && v !== 'overview' ? `#/home/${enc(v)}` : '#/'
  }
  const parts = [target.provider]
  if (target.root) {
    parts.push(target.root)
    if (target.slug) {
      parts.push(target.slug)
      if (target.id && !target.draft) parts.push(target.id)
    }
  }
  const query = new URLSearchParams()
  if (target.launchId) query.set('launch', target.launchId)
  if (target.terminalKey) query.set('terminal', target.terminalKey)
  if (target.draft) query.set('draft', '1')
  if (target.cwd && (target.draft || !target.slug)) query.set('cwd', target.cwd)
  if (target.id && !target.slug) query.set('session', target.id)
  return `#/${parts.map(enc).join('/')}${query.size ? `?${query}` : ''}`
}

// hash → partial target (no title/project — the app fills those in) or null
export function fromHash(hash, knownProviders = []) {
  const h = String(hash || '')
  if (!h.startsWith('#/')) return null
  const [route, search = ''] = h.split('?')
  const segs = route
    .slice(2)
    .split('/')
    .filter(Boolean)
    .map(dec)
  if (!segs.length) return { provider: null } // Home (Activity)
  if (segs[0] === 'home') return { provider: null, view: segs[1] || 'activity' }
  const [provider, root, slug, id] = segs
  if (knownProviders.length && !knownProviders.includes(provider)) return null
  const t = { provider }
  if (root) t.root = root
  if (slug) t.slug = slug
  if (id) t.id = id
  const query = new URLSearchParams(search)
  if (query.get('launch')) t.launchId = query.get('launch')
  if (query.get('terminal')) t.terminalKey = query.get('terminal')
  if (query.get('cwd')) t.cwd = query.get('cwd')
  if (query.get('session')) t.id = query.get('session')
  if (query.get('draft') === '1') t.draft = true
  return t
}

export function currentHash() {
  return typeof location !== 'undefined' ? location.hash : ''
}

export function replaceHash(hash) {
  if (typeof history === 'undefined') return
  if (location.hash === hash) return
  try {
    history.replaceState(null, '', hash)
  } catch {}
}
