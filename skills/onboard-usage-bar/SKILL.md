---
name: onboard-usage-bar
description: Enable AgentDeck's usage bar (5-hour / weekly rate limits + context%) by bridging Claude Code's status line. Use when the user wants AgentDeck to show rate-limit or context-usage meters, or asks to "enable / set up / onboard the usage bar". It wraps the user's EXISTING status line without modifying it, and edits settings.json only after explicit confirmation. Works on macOS/Linux/WSL (bash wrapper) and native Windows (Node wrapper).
---

# Onboard the AgentDeck usage bar

Claude Code exposes `rate_limits` and `context_window` **only to a `statusLine`
command** — never to disk — so AgentDeck cannot read them on its own. This
skill wires a bridge that persists them to `<config_dir>/rate-limits.json` (what
AgentDeck reads) **without modifying the user's status line script**, by
*wrapping* it: `settings.json`'s `statusLine.command` is pointed at a small
wrapper that (1) writes the snapshot, then (2) runs the user's original command
unchanged.

## Rules

- **Confirm before editing `settings.json`** — it's the user's config. Show what
  you'll change and why, then proceed only on approval.
- **Default to `~/.claude` only.** If AgentDeck tracks additional roots (config
  dirs), list them and **ask the user which extra ones to onboard** — never
  onboard extra roots silently. Repeat the steps for each dir they pick.
- Pick the wrapper per OS: **macOS/Linux/WSL → bash wrapper** (requires `jq`;
  if missing, stop and tell the user to install it). **Native Windows → Node
  wrapper** (no jq/bash needed; `node` must be on PATH, which AgentDeck already
  requires).
- The bar only updates when a real `claude` TUI runs (the status line fires) —
  including AgentDeck's **Terminal** chat mode. **SDK chat mode won't update
  it.** Tell the user this so the behavior isn't surprising.

## Steps

### 1. Pick the config dir(s)

Default to `~/.claude` (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}` on POSIX,
`%USERPROFILE%\.claude` on Windows). Then check which roots AgentDeck tracks —
read `roots.claude.json` in the AgentDeck repo, or ask the user — and if there
are others (e.g. `~/.claude-work`), ask explicitly:

> AgentDeck 目前追蹤這些 roots:… 預設只在 `~/.claude` 啟用 usage bar,
> 還要幫哪些 root 一起啟用?

Let `CFG` be each chosen directory and `SETTINGS = CFG/settings.json`. Run the
matching OS section below once per chosen dir.

### 2. Read the current status line

Read `SETTINGS` (JSON) and note `statusLine.command` as `ORIG` (empty if the
file or key doesn't exist). If `ORIG` already contains
`cc-monitor-statusline-bridge`, the bridge is **already enabled** — stop and
tell the user.

On POSIX, verify jq first:

```bash
command -v jq >/dev/null || { echo "jq is required — install it first."; exit 1; }
ORIG=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null)
```

### 3A. macOS / Linux / WSL — install the bash wrapper

Create `"$CFG/cc-monitor-statusline-bridge.sh"` with EXACTLY this content, then
`chmod +x` it:

```bash
#!/usr/bin/env bash
# AgentDeck status line bridge (wrapper). Writes rate_limits/context to
# <config_dir>/rate-limits.json, then runs your ORIGINAL status line unchanged.
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
  if [ -n "$tp" ]; then
    cfg="${tp%%/projects/*}"
    [ -d "$cfg" ] && printf '%s' "$input" \
      | jq -c '{rate_limits, context_window, session_id, updated_at: (now | floor)}' \
      > "$cfg/rate-limits.json" 2>/dev/null
  fi
fi
if [ -n "${1:-}" ]; then
  orig=$(printf '%s' "$1" | base64 -d 2>/dev/null)
  [ -n "$orig" ] && printf '%s' "$input" | eval "$orig"
fi
```

Back up settings, then repoint `statusLine.command` (base64 keeps the original
command intact as one argument):

```bash
cp "$SETTINGS" "$SETTINGS.cc-monitor.bak"
B64=$(printf '%s' "$ORIG" | base64 | tr -d '\n')
NEWCMD="$CFG/cc-monitor-statusline-bridge.sh $B64"
tmp=$(mktemp)
jq --arg c "$NEWCMD" '.statusLine = {type:"command", command:$c}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
```

(If `settings.json` doesn't exist yet, create it as `{}` first — the user
simply had no status line, and the bar will still work.)

Verify:

```bash
echo '{"transcript_path":"'"$CFG"'/projects/x/y.jsonl","session_id":"test","context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":9999999999}}}' \
  | bash "$CFG/cc-monitor-statusline-bridge.sh" "$B64" >/dev/null
test -f "$CFG/rate-limits.json" && echo "✓ bridge works" || echo "✗ check jq / paths"
rm -f "$CFG/rate-limits.json"   # remove the test snapshot; real data appears on next TUI run
```

### 3B. Native Windows — install the Node wrapper

Copy the canonical wrapper from the AgentDeck repo
(`scripts/statusline-bridge.mjs`) to `CFG\cc-monitor-statusline-bridge.mjs`
(or create it with that exact content). No chmod / jq needed.

Back up `SETTINGS` to `SETTINGS.cc-monitor.bak`, then edit the JSON (create
`{}` first if missing), setting — with `<B64>` = base64 of `ORIG` (empty string
→ no argument) and the real `CFG` path inlined:

```json
{ "statusLine": { "type": "command", "command": "node \"C:\\Users\\me\\.claude\\cc-monitor-statusline-bridge.mjs\" <B64>" } }
```

Preserve every other key in the file. Compute the base64 with Node if needed:
`node -e "console.log(Buffer.from(process.argv[1]??'').toString('base64'))" "<ORIG>"`.

Verify (PowerShell):

```powershell
'{"transcript_path":"C:/Users/me/.claude/projects/x/y.jsonl","session_id":"test","context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":10}}}' |
  node "$env:USERPROFILE\.claude\cc-monitor-statusline-bridge.mjs"
Test-Path "$env:USERPROFILE\.claude\rate-limits.json"   # True = bridge works
Remove-Item "$env:USERPROFILE\.claude\rate-limits.json" # remove the test snapshot
```

(Adjust the paths if `CFG` isn't `~/.claude`.)

### 4. Tell the user it's done + how to revert

- Done. AgentDeck's top bar will show **5h / 7d** and the **Terminal** bar will
  show **context% used** — once they next run a real `claude` TUI (or the
  AgentDeck's Terminal mode), since that's when the status line fires.
- Their original status line is untouched and still runs (the wrapper calls it).
- **To revert:** restore the backup —
  `mv "$SETTINGS.cc-monitor.bak" "$SETTINGS"` (POSIX) /
  `Move-Item ... -Force` (Windows) — or set `statusLine.command` back to the
  original value noted in step 2.

## Notes

- This skill ships with AgentDeck; canonical copies of the wrappers live at
  `scripts/statusline-bridge.sh` (bash) and `scripts/statusline-bridge.mjs`
  (Node, used on native Windows) in that repo.
- `rate_limits` is only present for Claude.ai (Pro/Max) subscribers, and only
  after the first API response in a session.
