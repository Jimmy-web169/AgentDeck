// Hash deep links for the active tab:
//   #/<provider>/<root>/<slug>/<id>     a session
//   #/<provider>/<root>/<slug>          a project
//   #/<provider>/<root>                 a tracked folder
//   #/<provider>                        a provider's app as-is
//   #/home/<view>                       a Home page (stats, history, …)
//   #/                                  Home overview
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
    return target?.view && target.view !== 'overview' ? `#/home/${enc(target.view)}` : '#/'
  }
  const parts = [target.provider]
  if (target.root) {
    parts.push(target.root)
    if (target.slug) {
      parts.push(target.slug)
      if (target.id && !target.draft) parts.push(target.id)
    }
  }
  return `#/${parts.map(enc).join('/')}`
}

// hash → partial target (no title/project — the app fills those in) or null
export function fromHash(hash, knownProviders = []) {
  const h = String(hash || '')
  if (!h.startsWith('#/')) return null
  const segs = h
    .slice(2)
    .split('/')
    .filter(Boolean)
    .map(dec)
  if (!segs.length) return { provider: null } // Home overview
  if (segs[0] === 'home') return { provider: null, view: segs[1] || 'overview' }
  const [provider, root, slug, id] = segs
  if (knownProviders.length && !knownProviders.includes(provider)) return null
  const t = { provider }
  if (root) t.root = root
  if (slug) t.slug = slug
  if (id) t.id = id
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
