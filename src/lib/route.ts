export { toHash, fromHash } from '../../shared/routeHash.ts'

export function currentHash() {
  return typeof location !== 'undefined' ? location.hash : ''
}

export function replaceHash(hash: string) {
  if (typeof history === 'undefined') return
  if (location.hash === hash) return
  try {
    history.replaceState(null, '', hash)
  } catch {}
}
