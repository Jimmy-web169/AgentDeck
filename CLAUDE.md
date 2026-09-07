# AgentDeck — working notes for Claude

Read this before touching the repo. It records how the maintainer wants work run
here; the codebase itself is described in `README.md`, `CONTRIBUTING.md` and
`DATA-MODEL.md`, and the running change log lives in `CHANGELOG.md`.

## How to split work (token thrift)

- **Small, self-contained tasks go to a subagent** — a page rewrite against a
  written spec, a doc pass, a diagnostic script, a search. Write the spec to the
  scratchpad first, hand over the file list, and forbid touching anything else.
- **Everything a subagent produces is reviewed by the main session** before it is
  committed: build, backend tests, theme-token compliance, integration with the
  shell (`src/App.jsx`, `src/components/shared/AppSidebar.jsx`, `HomeView.jsx`).
- **Large or cross-cutting tasks stay with the main agent** (shell/app sync,
  server routing, anything spanning more than a couple of files). Do not fan a
  big task out into many agents; the coordination costs more than it saves.
- Keep the main context lean: run scripts from the scratchpad, read only what the
  review needs, and use `git diff --stat` before reading whole files.

## Verify without touching the maintainer's instance

- The maintainer runs AgentDeck on **47841 (API) / 47842 (Vite)**. Never run
  `npm run dev`, `npm run server` or `npm run stop` — their `free-ports` pre-hook
  kills those ports.
- Never run `make all`, `make be` or `make update` from a session either: `make all`
  frees the maintainer's port and `make update` upgrades the CLIs the maintainer is
  using right now.
- Verify on side ports instead: `AGENTDECK_PORT=47851 AGENTDECK_WEB_PORT=47852
  node server/index.js` after `npx vite build` (it serves `dist/`). Kill only the
  PID listening on 47851 when done.
- Visual checks: Claude in Chrome when connected; otherwise the headless
  DevTools screenshot script pattern (`scratchpad/shot.mjs`) works with
  `--theme light|graphite` to cover every theme.

## Tests and commits

- **Backend changes need tests** in `test/` (`node --test`, run with `npm test`).
  Frontend tests are deliberately skipped for now.
- Commit only when asked. On the v2 branch the maintainer wants tag `v2.0.0`
  moved to the branch tip after each round (`git tag -f v2.0.0`).
- `tmp.md` at the repo root is git-excluded (`.git/info/exclude`) on purpose.
  Never add it, never remove the exclusion.
- Keep `CHANGELOG.md` current in the same commit as the feature.

## UI rules the maintainer has asked for (do not regress)

- One persistent left column shared by Home and session tabs. Every row shows
  only **pin + ⋯**; destructive actions go through the centered confirm dialog.
- No dropdown/checkmark scope pickers — visible colour-coded folder chips.
- Workspaces render as one flat session list with a source tag; suggestions have
  no dismiss button (the user treats them as system facts).
- Colours come from theme tokens (`ink-*`, `zinc-*`, accents) — never hex.
- Insights is *personal* (rhythm, streaks, session shape, neglected projects) and
  must not repeat Stats (tokens, tool bars, model mix).
- Keyboard hints must be visible without scrolling.
- Pinning moves a row into the Pinned section (it leaves Projects / its
  project's inline list); nothing is listed twice except while searching.

## Gotchas

- Bash heredocs containing `${` or backticks fail in this harness; write the
  script with the Write tool and run it.
- Never define React components inside another component here (rows remount on
  every live tick); lift them to module level and pass a `ctx` object.
- Browser-reserved shortcuts (Ctrl+T/W/Tab/1-9) cannot be intercepted; tab
  shortcuts use Alt.
