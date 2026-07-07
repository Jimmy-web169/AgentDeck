// Per-terminal-key UI view state that must survive navigation / remount:
//   'popped' — running in its own browser tab (show focus-tab / re-embed bar)
//   'hidden' — panel collapsed but tmux + ttyd kept alive (show "show" bar)
// No entry = normal embedded view. End/stop clears the key.
const LS = 'cm_termView'
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(LS) || '{}')
  } catch {
    return {}
  }
}
export const getTermView = (key) => (key ? read()[key] || null : null)
export const setTermView = (key, state) => {
  if (!key) return
  const m = read()
  if (state) m[key] = state
  else delete m[key]
  try {
    localStorage.setItem(LS, JSON.stringify(m))
  } catch {}
}
