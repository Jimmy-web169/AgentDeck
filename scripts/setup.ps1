# One-shot setup for AgentDeck on native Windows (`npm run init:win`):
#   1. installs Node dependencies (npm install)
#   2. installs the optional psmux (Terminal mode's tmux stand-in) via winget
#   3. checks for the `claude` and `codex` CLIs (needed to continue a conversation)
# Safe to re-run; skips anything already present. Windows PowerShell 5.1 compatible.
# Note: ttyd is NOT used on native Windows (its 1.7.7 release crashes at spawn,
# tsl0922/ttyd#1292) — the browser terminal is served by server/shared/webterm.js.

function Say($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Have($bin) { return [bool](Get-Command $bin -ErrorAction SilentlyContinue) }

Say "Detected native Windows."

# --- 1. Node dependencies ----------------------------------------------------
Say "Installing Node dependencies (npm install)"
npm install
if ($LASTEXITCODE -ne 0) { Warn "npm install failed - fix the error above before running the app." }

# --- 2. psmux (tmux-compatible; only needed for Terminal mode persistence) ----
# psmux ships a tmux.exe alias, which terminal.js discovers as `tmux`.
$psmuxPkgTmux = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\marlocarlo.psmux_Microsoft.Winget.Source_8wekyb3d8bbwe\tmux.exe'
if ((Have 'tmux') -or (Test-Path $psmuxPkgTmux)) {
  Say "psmux/tmux already installed"
} elseif (Have 'winget') {
  Say "Installing psmux (tmux-compatible terminal multiplexer, for Terminal mode)"
  winget install psmux --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { Warn "winget install psmux failed - install manually: https://github.com/psmux/psmux" }
  else { Warn "psmux was added to your user PATH - restart your shell before starting AgentDeck." }
} else {
  Warn "winget not found. Install psmux manually: https://github.com/psmux/psmux (Terminal mode falls back to non-persistent sessions without it)."
}

# --- 3. provider CLIs (needed to continue a conversation) ---------------------
if (Have 'claude') {
  Say "claude CLI found ($((Get-Command claude).Source))"
} else {
  Warn "claude CLI not found - needed only to continue Claude Code conversations (read-only monitoring works without it)."
  Warn "Install it from https://docs.claude.com/en/docs/claude-code"
}

if (Have 'codex') {
  Say "codex CLI found ($((Get-Command codex).Source))"
} else {
  Warn "codex CLI not found - needed only to continue OpenAI Codex conversations (read-only monitoring works without it)."
  Warn "Install it with: npm i -g @openai/codex"
}

Say "Setup complete. Start the app with:  npm run dev   ->  http://localhost:47842"
