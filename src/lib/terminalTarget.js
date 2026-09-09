// Frontend consumers carry the server's key verbatim. Folder-based keys are
// retained only as aliases for pre-migration panes; they never create identity.
export function mergeTerminalEntries(pool, live) {
  // Live receives start/link events immediately; an older pool poll must not
  // undo a newly learned conversation identity for the same terminal.
  return [...new Map([...pool, ...live].map((t) => [`${t.provider}|${t.root}|${t.key}`, t])).values()]
}

export function terminalFor(entries, provider, target) {
  return entries.find((t) => t.provider === provider && t.root === target.root && (
    target.terminalKey ? t.key === target.terminalKey :
      target.launchId ? t.launchId === target.launchId : target.id && t.id === target.id
  ))
}

export function terminalRequest({ root, slug, cwd, id, title, launchId, terminalKey }) {
  if (terminalKey) return { root, terminalKey }
  if (id) return { root, slug, id, title }
  return { root, slug, cwd, title, launchId, ...(!launchId ? { legacyDraft: true } : {}) }
}

export function announceTerminal(provider, terminal) {
  window.dispatchEvent(new CustomEvent('agentdeck:terminal-ready', { detail: { ...terminal, provider } }))
}

export function announceTerminalEnd(provider, key) {
  window.dispatchEvent(new CustomEvent('agentdeck:terminal-ended', { detail: { provider, key } }))
}
