#!/usr/bin/env bash
# AgentDeck status line bridge (wrapper).
#
# Claude Code only exposes rate_limits / context_window to a statusLine command
# (never to disk), so the monitor can't read them on its own. This wrapper is set
# as your statusLine.command by the "onboard-usage-bar" skill:
#
#   <this script> <base64 of your ORIGINAL statusLine.command>
#
# It reads the status line JSON on stdin, persists rate_limits / context_window /
# session_id to <config_dir>/rate-limits.json (which the monitor reads to show the
# 5h / 7d / context meters), then runs your ORIGINAL status line command unchanged
# so your status line looks exactly the same. Your status line SCRIPT is never
# modified — it is only invoked, in full, by this wrapper.

input=$(cat)

# 1) bridge: write the usage snapshot (best-effort; must never break the status line)
if command -v jq >/dev/null 2>&1; then
  tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
  if [ -n "$tp" ]; then
    cfg="${tp%%/projects/*}"
    [ -d "$cfg" ] && printf '%s' "$input" \
      | jq -c '{rate_limits, context_window, session_id, updated_at: (now | floor)}' \
      > "$cfg/rate-limits.json" 2>/dev/null
  fi
fi

# 2) delegate to your original status line command (base64-encoded as $1), if any
if [ -n "${1:-}" ]; then
  orig=$(printf '%s' "$1" | base64 -d 2>/dev/null)
  [ -n "$orig" ] && printf '%s' "$input" | eval "$orig"
fi
