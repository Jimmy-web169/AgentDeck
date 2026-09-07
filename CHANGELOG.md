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
- **One sidebar for everything.** A provider rail (one square per provider,
  so more providers just add rows) plus one sidebar the shell owns: the
  provider's folders as chips, then Workspaces, Pinned and the folder's
  projects/sessions from the cross-provider index — identical whether the tab
  shows Home or a session. Clicking there navigates the current tab;
  Ctrl/middle-click opens a new one. The Home page switch (Activity / Stats /
  History / Plugins / Resources) sits in Home's own header.
- **Workspaces**: name a group of projects from any provider or folder (the
  same repo under Claude Code and Codex, say) and browse their sessions in
  place; the sidebar suggests groups for folders it sees under several
  providers. Pinned projects expand in place too, and Pinned / Workspaces
  show every provider at once — no rail switch needed.
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

### Changed
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

### Removed
- Multi-session split view (tabs replace it).
- SDK chat mode (see Changed).

## [0.1.0]

Initial provider-pluggable dashboard: Claude Code + OpenAI Codex, live
monitoring, sub-agents, raw records, stats, history, resources, SDK chat and
terminal continue modes.
