import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import trash from 'trash'

const pExecFile = promisify(execFile)

// Windows PowerShell as seen from inside WSL (interop) at the default drive
// mount. If drives are mounted elsewhere or interop is off, the fallback just
// fails and the caller gets the original trash() error (file left untouched).
const WSL_POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'

// Resolve custom /etc/wsl.conf mount points via trash's own wsl-utils helper.
// It's a transitive dependency, so fall back to the default mount if it's gone.
async function wslPowerShellPath() {
  try {
    const { powerShellPathFromWsl } = await import('wsl-utils')
    return await powerShellPathFromWsl()
  } catch {
    return WSL_POWERSHELL
  }
}

let _isWsl = null
function isWsl() {
  if (_isWsl === null) {
    try {
      _isWsl = process.platform === 'linux' && fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
    } catch {
      _isWsl = false
    }
  }
  return _isWsl
}

// Send a Windows-drive path (/mnt/<drive>/…) to the Windows Recycle Bin via
// PowerShell. The path travels base64-encoded inside an -EncodedCommand script,
// so quoting/special characters can't break out; -LiteralPath avoids wildcard
// expansion (same approach the trash package itself uses on Windows).
async function recycleViaWindows(target) {
  const { stdout } = await pExecFile('wslpath', ['-aw', target])
  const winPath = stdout.trim()
  // UNC \\wsl$\… means the file lives on the Linux filesystem — not recyclable on
  // the Windows side (and trash() already handles that case itself).
  if (!winPath || winPath.startsWith('\\\\')) throw new Error(`not on a Windows drive: ${target}`)
  const pathB64 = Buffer.from(winPath, 'utf8').toString('base64')
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${pathB64}'))
if (Test-Path -LiteralPath $p -PathType Container) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
`.trim()
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await pExecFile(await wslPowerShellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded])
}

// trash() that also works under WSL for files on Windows drives. trash@10's WSL
// implementation spawns powershell.exe via a Windows-style path that Linux can't
// exec (its canAccessPowerShell check resolves the /mnt path, but the actual
// executePowerShell call doesn't get it passed), so any /mnt/<drive> target
// throws. Fall back to recycling through Windows PowerShell ourselves. Every
// failure path leaves the target untouched; success is verified on disk.
export async function safeTrash(target) {
  try {
    await trash(target, { glob: false })
  } catch (primaryError) {
    if (!isWsl()) throw primaryError
    try {
      await recycleViaWindows(target)
    } catch {
      throw primaryError
    }
  }
  if (fs.existsSync(target)) throw new Error(`Failed to move to trash: ${target}`)
}
