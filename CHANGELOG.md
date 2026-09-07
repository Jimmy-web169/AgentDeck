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
- **Home** (the logo): Overview (running terminals, pinned items, recent
  projects across providers), Stats, History, Memory, Plugins, Resources per
  tracked folder, and Folders to manage tracked folders for every provider.
- **Pins** for projects and sessions — from the sidebar, the quick switcher or
  Home; pinned items sit at the top of the sidebar and the switcher.
- `#/provider/root/slug/id` and `#/home/<view>` deep links.
- Keyboard-shortcut hints: a "?" popover in the tab strip and chips in empty
  states; theme toggle in the tab strip.
- One scope menu (provider · folder) replaces the two native selects in the
  sidebar; batch-select and pin are proper icon buttons.

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
