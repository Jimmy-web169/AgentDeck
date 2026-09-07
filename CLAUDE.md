# AgentDeck — working notes for Claude

Read this before touching the repo. It records how the maintainer wants work run
here; the codebase itself is described in `README.md` and `CONTRIBUTING.md`, the
provider protocol layer (contract, on-disk data model, schema, descriptors) lives
in `spec/`, and the running change log lives in `CHANGELOG.md`. This file is
git-ignored on purpose (like `.claude/`): it stays local to the maintainer.

## How the maintainer likes to work

- The maintainer writes in Traditional Chinese; reply in Traditional Chinese
  unless they switch. Code, commit messages and docs stay in English.
- Work iteratively on UI: give the result, then a short list of what to look at.
  Verify visually (Claude in Chrome or a headless screenshot) before saying a UI
  change is done.
- When context gets full, compact and keep going; do not drop the current task.
- Commit when asked; never push. Keep the CHANGELOG in the same commit.
- Do not ask permission for reversible steps that follow from what was asked.
  Ask only when different readings would produce materially different work.
- Report progress in short updates while working. Never block silently on a
  background task for minutes; poll briefly or do other work in between.

## How to split work (token thrift)

- **Default: the main agent does the work itself.** Subagents are used only
  when the maintainer asks for them; on 2026-09-07 they said fanning out did
  not help ("感覺沒有比較好"). If one is used anyway: write the spec to the
  scratchpad first, hand over the file list, forbid touching anything else, and
  **review everything it produces in the main session** before it is committed
  (build, backend tests, theme-token compliance, integration with the shell —
  `src/App.jsx`, `src/components/shared/AppSidebar.jsx`, `HomeView.jsx`).
- **Large or cross-cutting tasks always stay with the main agent** (shell/app
  sync, server routing, anything spanning more than a couple of files).
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

## Where local things go (never committed)

- **`tmp/`** (git-ignored) holds research notes, hand-off documents, diagnostics,
  generated reports — anything written for the maintainer or for the next session
  rather than for users of the repo. Write there by default; the maintainer moves
  a file out deliberately when it should ship.
- **Local skills** live in `.claude/skills/<name>/SKILL.md` (git-ignored). Scripts a
  skill drives may live in `scripts/` and ship; the skill itself stays local.
- `tmp.md` at the repo root is excluded via `.git/info/exclude` for the same reason.

## Tests and commits

- **Backend changes need tests** in `test/` (`node --test`, run with `npm test`).
  Frontend tests are deliberately skipped for now.
- Before a tag/release run `npm run release:check` (tests, build, provider-CLI
  flags, privacy scan); see `RELEASE-CHECKLIST.md`.
- Commit only when asked. On the v2 branch the maintainer wants tag `v2.0.0`
  moved to the branch tip after each round (`git tag -f v2.0.0`).
- Keep `CHANGELOG.md` current in the same commit as the feature.

## UI rules the maintainer has asked for (do not regress)

- One persistent left column shared by Home and session tabs. Every row shows
  only **pin + ⋯**; destructive actions go through the centered confirm dialog.
- No dropdown/checkmark scope pickers — visible colour-coded folder chips, and
  only **one** set of them: the sidebar's. Home pages (Stats, Insights, …)
  follow that scope; do not put a second chip row in Home's header (the
  maintainer found the duplicate "weird", 2026-09-07).
- Workspaces render as one flat session list with a source tag; suggestions have
  no dismiss button (the user treats them as system facts).
- Colours come from theme tokens (`ink-*`, `zinc-*`, accents) — never hex. The
  user-pickable accents are the `ACCENTS` list in `src/lib/providerColors.js`
  (provider accents via Preferences › Colours, a workspace's via its ⋯ menu);
  add a token in `index.css` for every theme before adding an accent.
- Insights is *personal* (rhythm, streaks, session shape, neglected projects) and
  must not repeat Stats (tokens, tool bars, model mix).
- Keyboard hints must be visible without scrolling.
- Pinning and grouping both **move** a row: a pinned row lives in Pinned, a
  workspace member lives under its workspace, and either leaves Projects / its
  project's inline list (a muted hint line stays). A row may be pinned *and*
  grouped. Nothing is listed twice except while searching or when that section
  is switched off in Preferences.

## Gotchas

- Bash heredocs containing `${` or backticks fail in this harness; write the
  script with the Write tool and run it.
- Never define React components inside another component here (rows remount on
  every live tick); lift them to module level and pass a `ctx` object.
- Browser-reserved shortcuts (Ctrl+T/W/Tab/1-9) cannot be intercepted; tab
  shortcuts use Alt.
