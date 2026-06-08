---
name: onboard-usage-bar
description: Enable AgentDeck's usage bar (5-hour / weekly rate limits + context%) by bridging Claude Code's status line. Use when the user wants AgentDeck to show rate-limit or context-usage meters, or asks to "enable / set up / onboard the usage bar". It wraps the user's EXISTING status line without modifying it, and edits settings.json only after explicit confirmation.
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
- Requires **`jq`** (used by the wrapper and for safe JSON edits). If missing,
  stop and tell the user to install it.
- If AgentDeck tracks **multiple roots** (config dirs), do this for each one
  the user wants the bar on. Ask which.
- The bar only updates when a real `claude` TUI runs (the status line fires) —
  including AgentDeck's **Terminal** chat mode. **SDK chat mode won't update
  it.** Tell the user this so the behavior isn't surprising.

## Steps

### 1. Pick the config dir

Default to `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. If the user runs Claude Code
with a custom `CLAUDE_CONFIG_DIR` (e.g. `~/.claude-work`), confirm which dir(s)
to set up. Let `CFG` be that directory and `SETTINGS="$CFG/settings.json"`.

### 2. Check jq and read the current status line

```bash
command -v jq >/dev/null || { echo "jq is required — install it first."; exit 1; }
ORIG=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null)
echo "current statusLine.command: ${ORIG:-(none)}"
```

If `ORIG` already contains `cc-monitor-statusline-bridge.sh`, the bridge is
**already enabled** — stop and tell the user.

### 3. Write the wrapper (does not touch their status line script)

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

### 4. Back up settings, then repoint statusLine.command

Encode the original command (base64, so any quotes/spaces survive as one arg),
back up `settings.json`, and set `statusLine` to call the wrapper with it:

```bash
cp "$SETTINGS" "$SETTINGS.cc-monitor.bak"
B64=$(printf '%s' "$ORIG" | base64 | tr -d '\n')
NEWCMD="$CFG/cc-monitor-statusline-bridge.sh $B64"
tmp=$(mktemp)
jq --arg c "$NEWCMD" '.statusLine = {type:"command", command:$c}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
```

(If `settings.json` doesn't exist yet, create it as `{}` first, then run the
`jq` step — the user simply had no status line, and the bar will still work.)

### 5. Verify

Feed the wrapper a sample status line payload and confirm it writes the file:

```bash
echo '{"transcript_path":"'"$CFG"'/projects/x/y.jsonl","session_id":"test","context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":10,"resets_at":9999999999}}}' \
  | bash "$CFG/cc-monitor-statusline-bridge.sh" "$B64" >/dev/null
test -f "$CFG/rate-limits.json" && echo "✓ bridge works" || echo "✗ check jq / paths"
rm -f "$CFG/rate-limits.json"   # remove the test snapshot; real data appears on next TUI run
```

### 6. Tell the user it's done + how to revert

- Done. AgentDeck's top bar will show **5h / 7d** and the **Terminal** bar will
  show **context% used** — once they next run a real `claude` TUI (or the
  AgentDeck's Terminal mode), since that's when the status line fires.
- Their original status line is untouched and still runs (the wrapper calls it).
- **To revert:** restore the backup —
  `mv "$SETTINGS.cc-monitor.bak" "$SETTINGS"` — or set `statusLine.command` back
  to the original value shown in step 2.

## Notes

- This skill ships with AgentDeck; a canonical copy of the wrapper also
  lives at `scripts/statusline-bridge.sh` in that repo.
- `rate_limits` is only present for Claude.ai (Pro/Max) subscribers, and only
  after the first API response in a session.
