#!/usr/bin/env sh
# One-shot setup for AgentDeck (used by `make init`):
#   1. installs Node dependencies (npm install)
#   2. installs the optional `ttyd` (Terminal mode) via your OS package manager
#   3. checks for the `claude` and `codex` CLIs (needed to continue a conversation)
# Safe to re-run; skips anything already present. POSIX sh, no bashisms.

say()  { printf '\n\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- detect platform ---------------------------------------------------------
# Only WSL and macOS are tested/supported. WSL reports `uname -s` as Linux, so we
# disambiguate it from plain Linux via $WSL_DISTRO_NAME or the kernel string.
detect_os() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) echo macos ;;
    Linux)
      if [ -n "$WSL_DISTRO_NAME" ] || grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
        echo wsl
      else
        echo linux
      fi
      ;;
    *) echo unknown ;;
  esac
}

OS_KIND="$(detect_os)"
case "$OS_KIND" in
  macos) say "Detected macOS." ;;
  wsl)   say "Detected WSL (Linux on Windows)." ;;
  linux) warn "Detected plain Linux — only WSL and macOS are tested; setup may work but is unsupported." ;;
  *)     warn "Could not detect a supported OS — only WSL and macOS are tested/supported. Continuing anyway." ;;
esac

# Use sudo only when not root and sudo exists (Linux package installs).
SUDO=""
if [ "$(id -u 2>/dev/null)" != "0" ] && have sudo; then SUDO="sudo"; fi

# --- 1. Node dependencies ----------------------------------------------------
say "Installing Node dependencies (npm install)"
npm install || warn "npm install failed — fix the error above before running the app."

# --- 2. ttyd (only needed for Terminal mode) ---------------------------------
if have ttyd; then
  say "ttyd already installed ($(command -v ttyd))"
else
  say "Installing ttyd (for Terminal mode)"
  case "$OS_KIND" in
    macos)
      if have brew; then brew install ttyd || warn "brew install ttyd failed — install manually: https://github.com/tsl0922/ttyd"
      else warn "Homebrew not found. Install it from https://brew.sh, then: brew install ttyd"; fi
      ;;
    wsl|linux)
      if   have apt-get; then $SUDO apt-get install -y ttyd || warn "Try: sudo apt-get update && sudo apt-get install -y ttyd"
      elif have dnf;     then $SUDO dnf install -y ttyd     || warn "dnf install ttyd failed."
      elif have pacman;  then $SUDO pacman -S --noconfirm ttyd || warn "pacman install ttyd failed."
      elif have zypper;  then $SUDO zypper install -y ttyd  || warn "zypper install ttyd failed."
      elif have apk;     then $SUDO apk add ttyd            || warn "apk add ttyd failed."
      else warn "No known package manager found. Install ttyd manually: https://github.com/tsl0922/ttyd"; fi
      ;;
    *)
      warn "Automatic ttyd install isn't supported on this OS."
      warn "See https://github.com/tsl0922/ttyd for manual install instructions."
      ;;
  esac
fi

# --- 3. provider CLIs (needed to continue a conversation) --------------------
# AgentDeck monitors read-only WITHOUT any CLI; the CLIs are only needed to
# "continue a conversation" (SDK chat / terminal) for that provider.
if have claude; then
  say "claude CLI found ($(command -v claude))"
else
  warn "claude CLI not found — needed only to continue Claude Code conversations (read-only monitoring works without it)."
  warn "Install it from https://docs.claude.com/en/docs/claude-code"
fi

if have codex; then
  say "codex CLI found ($(command -v codex))"
else
  warn "codex CLI not found — needed only to continue OpenAI Codex conversations (read-only monitoring works without it)."
  warn "Install it with: npm i -g @openai/codex"
fi

# Note: the skill installer uses the official `skills` CLI, fetched on first use —
# nothing to install here.

say "Setup complete. Start the app with:  make all   ->  http://localhost:47842"
