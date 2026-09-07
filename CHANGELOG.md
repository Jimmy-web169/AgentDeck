# Changelog

All notable changes to AgentDeck are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [2.0.0] - 2026-09-07

A navigation-first rewrite: browse like a browser, drive every agent through
its real terminal.

### Added
- **Chrome-style tabs** across providers and tracked folders. Tabs persist
  across reloads, remember their in-app view (Conversation / Sub-agents / Raw /
  Config), drag to reorder, close with Alt+W, jump with Alt+1…9, cycle with
  Alt+[ / Alt+], right-click for close-others / close-right / copy link.
  Ctrl/middle-click in the sidebar opens a session in a new tab.
- **Ctrl+K quick switcher**: fuzzy search over every project and session in
  every provider and folder. → enters a project (sessions with their first
  prompt), ← comes back to the row you left; Enter opens a project's live or
  newest session; Ctrl+Enter opens in a new tab. Pinned and recent sessions on
  the empty query.
- **Home** (the AgentDeck wordmark in the tab strip): Activity — running
  terminals, the latest sessions across every provider, pinned items, recent
  projects and the keyboard map — plus Stats, History, Plugins and Resources
  per tracked folder. Folders (one list of every provider's tracked folders,
  one add form) opens from the "+" next to the folder chips.
- **One sidebar for everything.** The shell owns it: every tracked folder of
  every provider as colour-coded chips (one click = scope), then Workspaces,
  Pinned and the folder's projects/sessions from the cross-provider index —
  identical whether the tab shows Home or a session. Every row has the same
  two hover controls, pin and ⋯; select, trash, rename and workspace
  membership live in the ⋯ menu. The Home page switch (Activity / Stats /
  History / Plugins / Resources) and the same folder chips sit in Home's own
  header, so Stats for another folder is one click.
- **Workspaces**: name a group of projects *and sessions* from any provider or
  folder (the same repo under Claude Code, a second Claude account and Codex,
  say). A workspace shows ONE flat session list; a coloured source tag
  (provider dot + folder label) tells members apart and the source chips
  filter the list. Pinning *moves* a row into Pinned: a pinned project leaves
  the Projects list and a pinned session leaves its project's inline list (a
  muted "2 more pinned · see Pinned" line marks the gap), so nothing is listed
  twice; searching shows everything again. The sidebar suggests groups for
  folders it sees in several places; two different folders with the same name (…/project/AgentDeck and
  …/maintain/AgentDeck) are suggested with their parent folder in the name,
  pressing Group twice reuses the existing workspace instead of duplicating
  it, and same-named workspaces show their parent folder in the list. Pinned
  projects expand in place too.
- Tracked folders can be relabelled from Folders (click the label), so a
  second account's home reads as "work" rather than `~\.claude-info`; pins
  and workspaces pick the new label up immediately.
- Every destructive action — trash a session, trash several, delete a
  workspace, untrack a folder — confirms in one centered dialog (Enter / Esc).
- **Memory is project-level** for both providers: a Memory tab next to Config
  (Claude: `projects/<slug>/memory/*.md`; Codex: the memories of that
  project's threads, filtered by cwd).
- A tab whose session has a terminal running shows a red dot; green still
  means "being written to right now".
- **Pins** for projects and sessions — from the sidebar, the quick switcher or
  Home; pinned items sit at the top of the sidebar and the switcher.
- `#/provider/root/slug/id` and `#/home/<view>` deep links.
- Keyboard-shortcut hints: a "?" popover in the tab strip and chips in empty
  states; theme toggle in the tab strip.
- Batch-select and pin are proper icon buttons; Stats uses the full width
  with the tool list folded to its top 10.

- **Insights** (Home): a personal read of the last 30 days per tracked folder —
  plain-English sentences (active days, when you work, busiest weekday, typical
  session length and prompt count, the longest session) with a persona chip,
  active-days / streak / this-week-vs-last tiles, a 12-week heatmap, weekly
  rhythm (table view too), hour-of-day and weekday profiles, session shape
  (duration and prompts-per-session buckets) and a "needs attention" list of
  projects idle for two weeks or more. Deliberately no tokens, tool bars or
  model mix — Stats has those. Data comes from the new
  `GET /api/<provider>/activity` endpoint (`server/shared/activity.js`, pure and
  unit-tested). "Copy digest as Markdown" hands the numbers to any Claude /
  Codex session for an AI read.
- **Themes and Preferences**: Midnight (new default, cool slate), Graphite (the
  1.x dark) and Paper; a density switch (compact hides the per-row meta line);
  toggles for the Workspaces / Pinned sections and for first prompts under
  session titles — all behind the gear in the tab strip.
- Backend tests: `test/activity.test.js`, `test/roots.test.js`,
  `test/dispatch.test.js` cover the activity profile, tracked-folder
  add/rename/remove and the shared dispatcher (incl. both providers' route tables).

- `make all` now runs `make update` first: every tracked provider CLI updates
  itself (`claude update`, `codex update`) before the servers start; failures
  only warn, `AGENTDECK_SKIP_UPDATE=1` skips it offline.
- **Release gate**: `npm run release:check` = tests + build + `check:providers`
  (every CLI flag AgentDeck drives still exists: `claude --resume`, `codex resume`,
  tmux/ttyd/node-pty) + `check:privacy` (no home paths, e-mails or keys in what git
  ships; LICENSE present). CI (`.github/workflows/ci.yml`) runs tests and the build
  on Ubuntu, Windows and macOS. `RELEASE-CHECKLIST.md` lists the manual steps.
- `PROVIDER-SPEC.md` — a draft contract for providers: the normalized core
  components, the shared route table, known claude/codex misalignments, a
  format-drift probe design and MCP-config normalization. For discussion.

### Changed
- The "+" next to the folder chips opens a centered **Tracked folders** dialog
  (list with editable labels, untrack, one add form) instead of a Home page;
  `#/home/folders` links fall back to Home › Activity.
- Sidebar hierarchy: projects carry a folder glyph and medium weight, sessions
  are lighter and smaller, so the two never read alike; "Show earlier
  messages" is a full-width bar instead of a small pill.
- **Terminal only.** Continuing a conversation always runs the real CLI in
  the embedded terminal (tmux + ttyd / node-pty). The SDK chat engine, its
  permission prompts and the `/chat/<provider>` WebSockets are gone, along with
  the `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk` dependencies.
- Closing a tab ends the terminal(s) it was driving (unless another tab shows
  the same session), so tmux sessions no longer pile up.
- Folder-wide views (Stats, History, Memory, Plugins, Resources) moved from
  the provider sidebar to Home.
- Windows: paths are shortened correctly (backslashes) and tracked-folder
  labels are home-relative (`~\.claude`).

### Fixed
- The usage-limits ⓘ tooltip in the session header rendered as one endless line
  off-screen: the header is `whitespace-nowrap` and the bubble inherited it. It
  now wraps and never exceeds the viewport.

### Removed
- Multi-session split view (tabs replace it).
- SDK chat mode (see Changed).

## [0.1.0]

Initial provider-pluggable dashboard: Claude Code + OpenAI Codex, live
monitoring, sub-agents, raw records, stats, history, resources, SDK chat and
terminal continue modes.
