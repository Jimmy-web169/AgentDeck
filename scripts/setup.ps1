# One-shot setup for AgentDeck on native Windows (`npm run init:win`):
#   1. installs Node dependencies (npm install)
#   2. links the committed find-skills skill into .claude/skills/
#   3. installs the optional psmux (Terminal mode's tmux stand-in) via winget
#   4. checks for the `claude` and `codex` CLIs (needed to continue a conversation)
# Safe to re-run; skips anything already present. Windows PowerShell 5.1 compatible.
# Note: ttyd is NOT used on native Windows (its 1.7.7 release crashes at spawn,
# tsl0922/ttyd#1292) — the browser terminal is served by server/shared/webterm.ts.

function Say($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Have($bin) { return [bool](Get-Command $bin -ErrorAction SilentlyContinue) }

Say "Detected native Windows."

# --- 1. Node dependencies ----------------------------------------------------
Say "Installing Node dependencies (npm install)"
npm install
if ($LASTEXITCODE -ne 0) { Warn "npm install failed - fix the error above before running the app." }

# --- 2. find-skills ----------------------------------------------------------
# Claude Code loads project skills only from .claude/skills/, and .claude/ is
# local (never committed), so point it at the committed canonical copy instead of
# keeping a second copy. A symlink needs Developer Mode or an elevated shell on
# Windows, so fall back to a copy and say so.
$skillLink = Join-Path $PSScriptRoot '..\.claude\skillsind-skills'
$skillSrc  = Join-Path $PSScriptRoot '..\skillsind-skills'
if (Test-Path $skillLink) {
  Say "find-skills already present"
} else {
  Say "Linking find-skills into .claude/skills/"
  New-Item -ItemType Directory -Force (Split-Path $skillLink) | Out-Null
  try {
    New-Item -ItemType SymbolicLink -Path $skillLink -Target $skillSrc -ErrorAction Stop | Out-Null
  } catch {
    Copy-Item $skillSrc $skillLink -Recurse
    Warn "no symlink permission (enable Developer Mode for one) - copied find-skills instead; re-run this script after updating skills/find-skills."
  }
}

# --- 3. psmux (tmux-compatible; only needed for Terminal mode persistence) ----
# psmux ships a tmux.exe alias, which terminal.ts discovers as `tmux`.
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

# --- 4. provider CLIs (needed to continue a conversation) ---------------------
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

# --- 4. reserve AgentDeck's ports from Hyper-V / Docker / WSL -----------------
# Docker Desktop, WSL2 and Hyper-V (via WinNAT/HNS) reserve large blocks of TCP
# ports at boot. If that block covers 47841/47842, every bind fails with
# EADDRINUSE even though no process holds the port and netstat shows nothing -
# so "killing the port" can never help. Excluding the ports keeps them off-limits
# to those auto-reservations while your own app can still bind them.
$apiPort = 47841
$reserveCount = 2  # 47841 (API) + 47842 (web)
function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}
$excluded = (netsh int ipv4 show excludedportrange protocol=tcp | Out-String) -match "\b$apiPort\b"
if ($excluded) {
  Say "Ports $apiPort-$($apiPort + $reserveCount - 1) already reserved for AgentDeck."
} elseif (Test-Admin) {
  Say "Reserving ports $apiPort-$($apiPort + $reserveCount - 1) for AgentDeck (excluding from Hyper-V/Docker)"
  # cycle WinNAT so it releases any active hold on the range, then persist the exclusion
  net stop winnat 2>$null | Out-Null
  netsh int ipv4 add excludedportrange protocol=tcp startport=$apiPort numberofports=$reserveCount store=persistent | Out-Null
  net start winnat 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Say "Reserved. These ports now survive reboots and Docker restarts." }
  else { Warn "Could not reserve the ports automatically - see the manual command below." }
} else {
  Warn "Ports $apiPort-$($apiPort + $reserveCount - 1) are not reserved and this shell is not elevated."
  Warn "If 'make all' hits EADDRINUSE, run this ONCE in an *Administrator* PowerShell:"
  Write-Host "    net stop winnat" -ForegroundColor Gray
  Write-Host "    netsh int ipv4 add excludedportrange protocol=tcp startport=$apiPort numberofports=$reserveCount store=persistent" -ForegroundColor Gray
  Write-Host "    net start winnat" -ForegroundColor Gray
}

Say "Setup complete. Start the app with:  npm run dev   ->  http://localhost:47842"
