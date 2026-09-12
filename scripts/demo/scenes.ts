import type { Cdp, Fixture } from './lib.ts'
import type { Preferences } from '../../src/lib/prefs.ts'
interface SceneDraft {
  name: string
  hash: string | ((fixture: Fixture) => string)
  seed: string
  h: number
  scenario?: string
  prefs?: Partial<Preferences>
  act?: (cdp: Cdp, fixture: Fixture) => Promise<void>
  ready?: (fixture: Fixture) => string
  about?: string
}
export interface Scene extends SceneDraft {
  demo: boolean
  check: boolean
  ready: (fixture: Fixture) => string
}
// Shared release and verification scenes; checks may exercise intermediate states.
import { sessionHash, sleep } from './lib.ts'

async function checkPickerGeometry(cdp: Cdp) {
  const problem = await cdp.eval<string | null>(`(() => {
    const panel = document.querySelector('[aria-label="Quick switcher"]');
    if (!panel) return 'dialog missing';
    if (!panel.lastElementChild) return 'keyboard footer missing';
    const rect = panel.getBoundingClientRect();
    const footer = panel.lastElementChild.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
      footer.bottom <= innerHeight && panel.scrollWidth <= panel.clientWidth + 1 ? null : 'dialog or keyboard footer overflows the viewport';
  })()`)
  if (problem !== null) throw new Error(`Quick switcher: ${problem}`)
}

async function pickerEscape(cdp: Cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

async function checkFolderPicker(cdp: Cdp, fx: Fixture) {
  const sharedName = fx.shared?.name
  if (!sharedName) throw new Error('Folder fixture is missing its shared project name')
  if (
    !(await cdp.eval<boolean>(`(() => {
    const button = document.querySelector('button[title^="New tab"]');
    if (!button) return false; button.click(); return true;
  })()`))
  )
    throw new Error('Folder scene cannot find the new-tab button')
  if (
    !(await cdp.waitFor(
      `!!document.querySelector('button[title^="Browse this folder"]') && document.querySelector('[aria-label="Quick switcher"]').innerText.includes('Home')`
    ))
  )
    throw new Error('Folder picker did not expose Home and folder navigation')
  await checkPickerGeometry(cdp)
  const opened = await cdp.eval<boolean>(`(() => {
    const button = [...document.querySelectorAll('button[title^="Browse this folder"]')]
      .find(button => button.parentElement.innerText.includes(${JSON.stringify(sharedName)}));
    if (!button) return false; button.click(); return true;
  })()`)
  if (
    !opened ||
    !(await cdp.waitFor(
      `document.querySelector('[aria-label="Quick switcher"]')?.innerText.includes('New conversation ·') && !document.querySelector('[aria-label="Quick switcher"]')?.innerText.includes('Loading sessions…')`
    ))
  )
    throw new Error('Folder picker did not load its source conversations')
  await checkPickerGeometry(cdp)
  // Restore the original Home capture after checking both new dialog states.
  await pickerEscape(cdp)
  if (!(await cdp.waitFor(`!!document.querySelector('button[title^="Browse this folder"]')`)))
    throw new Error('Folder picker did not return to its folder list')
  await pickerEscape(cdp)
  if (!(await cdp.waitFor(`!document.querySelector('[aria-label="Quick switcher"]')`))) throw new Error('Folder picker did not close')
}

export function getCheckOnlyScenes(H = 900): Scene[] {
  return (
    [
      { name: 'narrow-home', hash: '#/', seed: 'full', h: H, scenario: 'v2-highlights' },
      { name: 'empty-home', hash: '#/', seed: 'base', h: H, scenario: 'empty' },
      { name: 'error-root', hash: '#/', seed: 'base', h: H, scenario: 'error' },
      { name: 'long-content', hash: '#/', seed: 'full', h: H, scenario: 'stress' },
      // The pane exists only where a session spawned agents; no Antigravity
      // fixture session has any, so its transcript is covered by session-antigravity.
      ...(['claude', 'codex'] as const).map((provider) => ({
        name: `multi-view-${provider}`,
        hash: (fx: Fixture) => sessionHash(fx.target(provider === 'claude' ? fx.claudeStar : fx.codexStar)),
        seed: 'full',
        h: H,
        scenario: 'folders',
        act: async (cdp: Cdp) => {
          const pane = `[...document.querySelectorAll('[aria-label="Main transcript"]')].find(element => element.clientHeight > 0)`
          if (!(await cdp.waitFor(`${pane}?.querySelector('.conversation-content') != null`))) throw Error('Main transcript did not load')
          // Only a session that spawned agents offers the pane; a fixture that
          // lost its agents would record the conversation alone rather than fail.
          const button = `${pane}.closest('main').querySelector('button[title^="See every sub-agent"]')`
          const shown = `!!document.querySelector('[aria-label="Sub-agent pane"]')`
          if (await cdp.eval(`!!(${button})`)) {
            await cdp.eval(`(${button}).click()`)
            if (!(await cdp.waitFor(`${shown} && !document.querySelector('[aria-label="Sub-agent pane"]').innerText.includes('Loading')`)))
              throw Error('Subagent pane did not load')
            // The navigator re-measures its rail on the next animation frame after
            // the split narrows the transcript; probe after that frame so the
            // rail's position is the settled one rather than whichever came first.
            await cdp.eval('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          } else if (await cdp.eval(shown)) throw Error('Sub-agent pane shown without its button')
        },
      })),
      {
        name: 'long-conversation',
        hash: (fx) => sessionHash(fx.target(fx.claudeStar)),
        seed: 'base',
        h: H,
        scenario: 'stress',
        act: async (cdp) => {
          // The fixture includes an inline agent. Wait for its throttled index
          // fetch as well as the parent transcript before measuring the page.
          if (!(await cdp.waitFor("[...document.querySelectorAll('button')].some(b => /show thread/.test(b.textContent))", { timeout: 5000 })))
            throw new Error('Stress conversation inline-agent index did not load')
        },
      },
      ...['activity', 'stats', 'insights', 'history', 'plugins', 'resources'].map((view) => ({
        name: `folder-${view}`,
        hash: `#/home/${view}`,
        seed: 'full',
        h: H,
        scenario: 'folders',
        prefs: { sidebarMode: 'folder' },
        act: view === 'activity' ? checkFolderPicker : undefined,
      })),
    ] satisfies SceneDraft[]
  ).map((scene) => ({
    ...scene,
    demo: false,
    check: true,
    ready: () => 'document.readyState === "complete" && !!document.querySelector("aside") && !/Loading(…|\\.\\.\\.)/.test(document.body.innerText)',
  }))
}

// ---- the shot list ----------------------------------------------------------------
// hash: where to navigate (src/lib/route.ts) · seed: 'base' | 'full' · h: viewport
// height · ready: page-side predicate that says the data is on screen · act: extra
// steps before capture (CDP client + fixture)

// page-side predicates (strings evaluated in the page). `booted` = the sidebar
// has listed the current folder's projects and nothing is still loading — the
// seeded workspace/pins/tabs render from localStorage before any fetch returns,
// so a marker that only they contain is NOT proof the index is in.
const T = 'document.body.innerText'
const hasText = (s: string) => `${T}.includes(${JSON.stringify(s)})`
const noText = (s: string) => `!${T}.includes(${JSON.stringify(s)})`
const booted = `/PROJECTS\\s*·\\s*[1-9]/.test(${T}) && !/Loading(…|\\.\\.\\.)/.test(${T}) && ${noText('no tracked folder')}`
const sessionOpen = (title: string) => `${booted} && /\\d+ prompts?/.test(${T}) && ${noText('Pick a project')} && ${hasText(title)}`
const all = (...ps: string[]) => ps.map((p) => `(${p})`).join(' && ')

export function getScenes(H = 900): Scene[] {
  return (
    [
      {
        name: 'home-activity',
        hash: '#/',
        seed: 'full',
        h: H,
        ready: () => all(booted, hasText('LATEST SESSIONS'), noText('No sessions yet')),
        about: 'Home · Activity with the shared sidebar (workspace, pins, projects)',
      },
      {
        name: 'quick-switcher-open',
        hash: '#/',
        seed: 'full',
        h: H,
        ready: () => all(booted, hasText('LATEST SESSIONS'), noText('No sessions yet')),
        act: async (cdp, fx) => {
          await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); true`)
          await cdp.waitFor(`!!document.querySelector('input[placeholder*="Jump to"]')`, { timeout: 4000 })
          if (!(await cdp.eval<boolean>(`document.querySelector('[aria-label="Quick switcher"]').innerText.includes('Home')`)))
            throw new Error('Empty Source picker did not expose Home')
          await checkPickerGeometry(cdp)
          // type a query so fuzzy matching is visible; the switcher input has autofocus
          const focused = await cdp.eval(`document.activeElement && document.activeElement.tagName === 'INPUT'`)
          if (focused) await cdp.send('Input.insertText', { text: (fx.shared?.name || 'orbit').slice(0, 3) })
          await sleep(600)
        },
        about: 'Ctrl+K quick switcher with a query',
      },
      {
        name: 'sidebar-workspaces-pinned',
        hash: '#/',
        seed: 'full',
        h: H,
        ready: () => all(booted, hasText('LATEST SESSIONS'), noText('No sessions yet')),
        act: async (cdp, fx) => {
          // expand the workspace row (its name span sits inside the toggle button) and the pinned project
          await cdp.eval(`(() => {
        const ws = document.querySelector('span[title=${JSON.stringify(fx.shared?.name || '')}]');
        const b = ws && ws.closest('button'); if (b) b.click();
        const p = [...document.querySelectorAll('button[title="Show sessions"]')][0]; if (p) p.click();
        return true })()`)
          // the expanded rows list the pinned project's sessions — wait for one of their titles
          const pinnedTitle = fx.manifest.sessions.find((s) => s.project === fx.otherProject?.name)?.title
          if (pinnedTitle) await cdp.waitFor(hasText(pinnedTitle.slice(0, 20)), { timeout: 4000 })
          await sleep(500)
        },
        about: 'Sidebar with a cross-provider workspace (grouped by project) and pinned rows',
      },
      {
        name: 'insights',
        hash: '#/home/insights',
        seed: 'base',
        h: Math.max(H, 1500),
        ready: () => all(booted, hasText('Your last 30 days'), hasText('ACTIVITY')),
        about: 'Insights (rhythm, streak, session shape)',
      },
      {
        name: 'session-conversation',
        hash: (fx) => (fx.claudeStar ? sessionHash(fx.target(fx.claudeStar)) : '#/'),
        seed: 'full',
        h: Math.max(H, 1300),
        ready: (fx) => sessionOpen((fx.claudeStar?.title || '').slice(0, 24)),
        act: async (cdp) => {
          // The view renders only the tail of a conversation at first; the Task call
          // that spawned the sub-agent is usually earlier. Load the whole transcript,
          // open the first inline thread ("▸ show thread") and scroll it into view.
          const findThread = `[...document.querySelectorAll('button')].find((x) => /show thread/.test(x.textContent || ''))`
          await cdp.eval(`(() => { const more = document.querySelector('[data-earlier-all]'); if (more) more.click(); return !!more })()`)
          await cdp.waitFor(`!!(${findThread})`, { timeout: 4000 })
          await cdp.eval(`(() => { const b = ${findThread}; if (!b) return false; b.click(); return true })()`)
          await cdp.waitFor(`/hide thread/.test(${T})`, { timeout: 4000 })
          await sleep(500)
          // put the parent's Task call at the top of the pane, thread expanded below it
          await cdp.eval(
            `(() => { const b = [...document.querySelectorAll('button')].find((x) => /hide thread/.test(x.textContent || '')); const block = b && b.closest('div.my-2'); const call = block && block.previousElementSibling; (call || block || b)?.scrollIntoView({ block: 'start' }); return true })()`
          )
          await sleep(400)
        },
        about: 'A Claude session with tool calls and inline sub-agents',
      },
      {
        name: 'session-codex',
        hash: (fx) => (fx.codexStar ? sessionHash(fx.target(fx.codexStar)) : '#/'),
        seed: 'full',
        h: Math.max(H, 1300),
        ready: (fx) => sessionOpen((fx.codexStar?.title || '').slice(0, 24)),
        about: 'A Codex session (shell / apply_patch) with a child rollout',
      },
      {
        name: 'session-antigravity',
        hash: (fx) => (fx.agyStar ? sessionHash(fx.target(fx.agyStar)) : '#/'),
        seed: 'full',
        h: H,
        ready: (fx) => sessionOpen((fx.agyStar?.title || '').slice(0, 24)),
        about: 'An Antigravity (agy) session — thinking, tool calls paired with their results, tokens from its SQLite',
      },
      {
        name: 'stats',
        hash: '#/home/stats',
        seed: 'base',
        h: Math.max(H, 1500),
        ready: (fx) => all(booted, hasText(fx.shared?.name || 'orbit'), hasText('tokens')),
        about: 'Stats (tokens, tools, models)',
      },
      {
        name: 'preferences-open',
        hash: '#/',
        seed: 'full',
        h: H,
        ready: () => all(booted, hasText('LATEST SESSIONS')),
        act: async (cdp) => {
          await cdp.eval(`(() => { const b = document.querySelector('button[title="Preferences"]'); if (b) b.click(); return !!b })()`)
          await cdp.waitFor(`/colours/i.test(${T})`, { timeout: 3000 }) // innerText carries the CSS uppercase
          // unfold the first provider's colour tray so the picker is in the shot
          await cdp.eval(`(() => { const c = document.querySelector('[data-accent-chip]'); if (c) c.click(); return !!c })()`)
          await cdp.waitFor(`!!document.querySelector('[data-swatch]')`, { timeout: 3000 })
          await sleep(400)
        },
        about: 'Preferences popover with a provider colour tray open',
      },
      {
        name: 'config-handoff',
        hash: (fx) => (fx.claudeStar ? sessionHash(fx.target(fx.claudeStar)) : '#/'),
        seed: 'full',
        h: Math.max(H, 1000),
        ready: (fx) => sessionOpen((fx.claudeStar?.title || '').slice(0, 24)),
        act: async (cdp) => {
          // Config tab → "✦ Ask Claude Code" → the dialog with a request typed, the brief previewed
          await cdp.eval(
            `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Config'); if (b) b.click(); return !!b })()`
          )
          await cdp.waitFor(`/scope/i.test(${T})`, { timeout: 5000 })
          await cdp.eval(
            `(() => { const b = [...document.querySelectorAll('button')].find((x) => /^✦?\\s*Ask /.test((x.textContent || '').trim())); if (b) b.click(); return !!b })()`
          )
          await cdp.waitFor(`!!document.querySelector('textarea')`, { timeout: 4000 })
          await cdp.send('Input.insertText', { text: 'Set this project up for me: format after every edit, and let the agent read our GitHub issues.' })
          await sleep(300)
          await cdp.eval(
            `(() => { const b = [...document.querySelectorAll('button')].find((x) => /preview the brief/.test(x.textContent || '')); if (b) b.click(); return !!b })()`
          )
          await cdp.waitFor(`/building blocks/i.test(${T})`, { timeout: 3000 })
          await sleep(400)
        },
        about: "Config › Ask the agent — the hand-off brief interviews first and lists the CLI's building blocks with their docs",
      },
      {
        name: 'folders-dialog',
        hash: '#/',
        seed: 'full',
        h: H,
        ready: () => all(booted, hasText('LATEST SESSIONS')),
        act: async (cdp) => {
          await cdp.eval(`(() => { const b = document.querySelector('button[title="Track another folder / edit labels"]'); if (b) b.click(); return !!b })()`)
          await cdp.waitFor(`/format (ok|changed|drift)/i.test(${T})`, { timeout: 5000 })
          // the dialog prints each folder's absolute path — the fixture lives under this
          // checkout, so show the fictional home instead of the maintainer's path
          await cdp.eval(
            `(() => { const re = /.*[\\/]demo-root[\\/]/; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && re.test(c.nodeValue)) c.nodeValue = c.nodeValue.replace(re, '/home/demo/'); else walk(c) } }; walk(document.body); return true })()`
          )
          await sleep(300)
        },
        about: 'Tracked folders — provider cards and the format probe per folder (a CLI that changes its files gets a badge)',
      },
      {
        name: 'workspace-menu',
        hash: '#/',
        seed: 'full',
        h: H,
        ready: () => all(booted, hasText('LATEST SESSIONS')),
        act: async (cdp, fx) => {
          // the workspace row's ⋯ menu, with its colour tray unfolded
          await cdp.eval(`(() => {
        const s = document.querySelector('span[title=${JSON.stringify(fx.shared?.name || '')}]');
        const row = s && s.closest('.group');
        const more = row && row.querySelector('button[title="More"]'); if (more) more.click();
        return !!more })()`)
          await cdp.waitFor(`!!document.querySelector('[data-accent-chip]')`, { timeout: 3000 })
          // unfold the icon grid (the colour tray stays folded — one thing at a time)
          await cdp.eval(`(() => { const c = document.querySelector('[data-icon-chip]'); if (c) c.click(); return !!c })()`)
          await cdp.waitFor(`!!document.querySelector('[data-icon-choice]')`, { timeout: 3000 })
          await sleep(400)
        },
        about: 'A workspace ⋯ menu (rename, delete, icon, colour)',
      },
    ] satisfies SceneDraft[]
  ).map((scene) => ({ ...scene, demo: true, check: true }))
}
