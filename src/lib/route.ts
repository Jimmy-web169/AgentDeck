import { toHash, toPopoutHash } from '../../shared/routeHash.ts'
import type { Target } from '../../shared/types.d.ts'
export { toHash, fromHash, toPopoutHash, fromPopoutHash, isPopoutHash } from '../../shared/routeHash.ts'

// The main AgentDeck window is named so a popped-out terminal can find it
// again, the same way the main window finds the pop-out by its own name.
export const MAIN_WINDOW_NAME = 'agentdeck-main'
export const popoutWindowName = (terminalKey: string) => `agentdeck-term-${terminalKey}`
const origin = () => (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '')
export const popoutHref = (target: Target) => `${origin()}${toPopoutHash(target)}`
export const mainHref = (target: Target) => `${origin()}${toHash(target)}`

// Take the user from a popped-out terminal back to its conversation in the
// main window. `window.open('', name)` returns the existing window of that
// name without navigating it, and a hash change there focuses the tab (the
// shell listens for it). Browsers do not raise another tab on `focus()`, but
// a script-opened tab may close itself, which returns to its opener; a tab the
// browser will not close (opened by hand, reloaded from a bookmark) becomes the
// main window itself, as does a pop-out whose main window is gone.
export interface PopoutEnvironment {
  open: (url: string, name: string) => Window | null
  self: Window | null
  close: () => void
  closed: () => boolean
  navigate: (href: string) => void
  later: (run: () => void) => void
}
const browserEnvironment = (): PopoutEnvironment => ({
  open: (url, name) => window.open(url, name),
  self: window,
  close: () => window.close(),
  closed: () => window.closed,
  navigate: (href) => {
    window.name = MAIN_WINDOW_NAME
    location.assign(href)
  },
  later: (run) => setTimeout(run, 200),
})
export function focusMainWindow(target: Target, env: PopoutEnvironment = browserEnvironment()): 'main' | 'self' {
  const main = env.open('', MAIN_WINDOW_NAME)
  let ready = false
  try {
    ready = !!main && main !== env.self && !main.closed && main.location.href !== 'about:blank'
  } catch {
    ready = false // the named window shows another origin: not ours to steer
  }
  if (main && ready) {
    main.location.hash = toHash(target)
    try {
      main.focus()
    } catch {}
    env.close()
    env.later(() => {
      if (!env.closed()) env.navigate(mainHref(target))
    })
    return 'main'
  }
  if (main && main !== env.self) {
    try {
      main.close() // the blank tab `open` just created
    } catch {}
  }
  env.navigate(mainHref(target))
  return 'self'
}

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
