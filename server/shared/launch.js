import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Launch a local app (editor / terminal) at a directory. The monitor server binds
// 127.0.0.1 only and runs on the user's own machine, so this is a local convenience.
// We spawn with an argv array (never a shell string) so a path can't inject a command.

function onPath(bin) {
  // Windows launchers carry an extension (code.cmd, wt.exe); the extensionless
  // sibling (e.g. VS Code's POSIX `bin/code` script) exists but can't be spawned.
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat'] : ['']
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue
    for (const e of exts) {
      const p = path.join(d, bin + e)
      try {
        fs.accessSync(p, fs.constants.X_OK)
        return p
      } catch {}
    }
  }
  return null
}

// detached: fire-and-forget GUI app. waitExit: short-lived launcher (`open`) whose
// exit code tells us whether the target app actually exists.
function run(cmd, args, { waitExit = false } = {}) {
  // Node refuses to spawn .cmd/.bat directly (CVE-2024-27980) — route through
  // cmd.exe. /s + outer quotes + verbatim args is the quoting that stays correct
  // when both the launcher path and an argument contain spaces (à la cross-spawn).
  const opts = { detached: !waitExit, stdio: 'ignore' }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    const line = [cmd, ...args].map((a) => `"${a}"`).join(' ')
    args = ['/d', '/s', '/c', `"${line}"`]
    cmd = 'cmd.exe'
    opts.windowsVerbatimArguments = true
  }
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, opts)
    } catch (e) {
      return reject(e)
    }
    child.on('error', reject)
    if (waitExit) {
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`launcher exited ${code}`))))
    } else {
      child.unref()
      setTimeout(resolve, 150) // no immediate spawn error → assume it launched
    }
  })
}

const EDITORS = ['code', 'cursor', 'code-insiders', 'codium'] // first match on PATH wins

// WSL reports platform 'linux' but has no native GUI terminal — launch a Windows one instead.
function isWSL() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true
  try {
    return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

export async function openTool(what, cwd) {
  if (!cwd || !path.isAbsolute(cwd)) throw Object.assign(new Error('invalid working directory'), { status: 400 })
  if (!fs.existsSync(cwd)) throw Object.assign(new Error(`directory no longer exists: ${cwd}`), { status: 404 })
  const plat = process.platform

  if (what === 'vscode') {
    const bin = EDITORS.map(onPath).find(Boolean)
    if (bin) return run(bin, [cwd]) // the editor's own CLI opens/adds the folder
    if (plat === 'darwin') return run('open', ['-a', 'Visual Studio Code', cwd], { waitExit: true })
    if (plat === 'win32') return run('cmd', ['/c', 'code', cwd])
    throw Object.assign(new Error("VS Code not found — install the 'code' command (or VS Code.app)"), { status: 404 })
  }

  if (what === 'terminal') {
    if (plat === 'darwin') return run('open', ['-a', 'Terminal', cwd], { waitExit: true })
    if (plat === 'win32') return run('cmd', ['/c', 'start', 'cmd', '/k', 'cd', '/d', cwd])
    if (isWSL()) {
      // Open a Windows terminal running a WSL shell in this directory. `wsl --cd`
      // takes the Linux path as-is. Prefer Windows Terminal; otherwise fall back to
      // a plain console window (which also works when wt isn't installed/on PATH).
      const wt = onPath('wt.exe')
      if (wt) return run(wt, ['wsl.exe', '--cd', cwd])
      const cmdExe = onPath('cmd.exe') || '/mnt/c/Windows/System32/cmd.exe'
      return run(cmdExe, ['/c', 'start', '', 'wsl.exe', '--cd', cwd])
    }
    const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].map(onPath).find(Boolean)
    if (term) return run(term, ['--working-directory', cwd])
    throw Object.assign(new Error('no terminal emulator found'), { status: 404 })
  }

  throw Object.assign(new Error(`unknown target: ${what}`), { status: 400 })
}

// Open the OS-native folder chooser (Finder on macOS, Explorer dialog on Windows,
// zenity on Linux) and return the picked absolute path. The server runs on the
// user's own machine, so the dialog appears on their screen. Resolves
// { ok, path } on pick, { cancelled } on cancel, { ok:false, error } if no native
// dialog is available (caller falls back to the in-browser picker).
export function pickFolderNative() {
  return new Promise((resolve) => {
    const plat = process.platform
    let cmd
    let args
    if (plat === 'darwin') {
      cmd = 'osascript'
      args = ['-e', 'POSIX path of (choose folder with prompt "Choose a project folder for AgentDeck")']
    } else if (plat === 'win32') {
      const ps =
        "Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Choose a project folder'; if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($f.SelectedPath)}"
      cmd = 'powershell'
      args = ['-NoProfile', '-STA', '-Command', ps]
    } else {
      cmd = 'zenity'
      args = ['--file-selection', '--directory', '--title=Choose a project folder']
    }
    let out = ''
    let child
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return resolve({ ok: false, error: 'native folder picker not available' })
    }
    child.on('error', () => resolve({ ok: false, error: 'native folder picker not available' }))
    child.stdout.on('data', (d) => (out += d))
    child.on('close', (code) => {
      const p = out.trim().replace(/[/\\]+$/, '')
      if (code === 0 && p) resolve({ ok: true, path: p })
      else resolve({ ok: false, cancelled: true }) // cancel or empty
    })
  })
}
