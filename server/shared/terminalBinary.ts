import fs from 'node:fs'
import path from 'node:path'
const IS_WIN = process.platform === 'win32'

export function findOnPath(names: string[], extra: string[] = []) {
  // Windows executables carry an extension; `claude` on PATH is claude.exe/.cmd
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']
  const cands = []
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    // `npm run` prepends the project's node_modules/.bin — never run a bundled
    // CLI (e.g. the codex SDK ships an old `codex`) in the embedded terminal.
    if (!d || /node_modules[\\/]\.bin$/i.test(d)) continue
    for (const n of names) for (const e of exts) cands.push(path.join(d, n + e))
  }
  for (const x of extra) for (const e of exts) cands.push(x + e)
  return (
    cands.find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK)
        return true
      } catch {
        return false
      }
    }) || null
  )
}

// npm global installs on Windows expose only .cmd/.ps1 shims, and Node's spawn
// refuses .cmd/.bat without shell:true (CVE-2024-27980 hardening) — SDKs that
// spawn the resolved path directly throw EINVAL. Dig the real vendored .exe out
// of the npm package behind the shim. Breadth-first with a depth cap: the vendor
// layout moves between package versions, so a fixed path would rot.
export function resolveVendoredExe(bin: string | null, pkgName: string, exeName: string) {
  if (!IS_WIN || !bin || !/\.(cmd|bat|ps1)$/i.test(bin)) return bin
  const pkgDir = path.join(path.dirname(bin), 'node_modules', ...pkgName.split('/'))
  const queue: [string, number][] = [[pkgDir, 0]]
  while (queue.length) {
    const next = queue.shift()
    if (!next) break
    const [dir, depth] = next
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isFile() && e.name.toLowerCase() === exeName) return p
      if (e.isDirectory() && depth < 6) queue.push([p, depth + 1])
    }
  }
  return bin // nothing vendored — hand back the shim so the caller's error surfaces
}

let ttydBin: string | null | undefined
export const findTtyd = () => {
  if (ttydBin === undefined) ttydBin = findOnPath(['ttyd'], ['/opt/homebrew/bin/ttyd', '/usr/local/bin/ttyd'])
  return ttydBin
}

// On Windows "tmux" is psmux's tmux-compatible alias. winget's portable install
// adds its package dir to the *user* PATH, which a server started from an older
// shell won't have — so also try that deterministic install location directly.
const TMUX_EXTRA = IS_WIN
  ? [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'marlocarlo.psmux_Microsoft.Winget.Source_8wekyb3d8bbwe', 'tmux'),
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'tmux'),
    ]
  : ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux']
let tmuxBin: string | null | undefined
export const findTmux = () => {
  if (tmuxBin === undefined) tmuxBin = findOnPath(['tmux'], TMUX_EXTRA)
  return tmuxBin
}

// tmux resolves `-t =name` as an exact session name. psmux, the tmux stand-in
// on native Windows, does not: attach-session lands on the server's current
// session whatever `-t` names (with or without `=`), and kill-session with `=`
// silently does nothing. Names are fixed-length hashes, so a plain name is
// already exact there, and `new-session -A` is the one attach form psmux
// resolves by name. A session that ended between has-session and attach then
// runs an exiting command instead of hijacking another terminal or leaving a
// bare shell behind under the AgentDeck name.
export const tmuxTarget = (name: string, platform: NodeJS.Platform = process.platform) => (platform === 'win32' ? name : `=${name}`)
export function tmuxAttachArgs(name: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? ['new-session', '-A', '-s', name, '--', 'cmd.exe', '/c', 'exit'] : ['attach-session', '-t', `=${name}`]
}
// The command a person types in their own terminal to attach the same session.
// Live entries carry it because only the server knows which tmux runs there:
// `tmux attach -t` on psmux lands every copy of the hint on the same session.
export function tmuxAttachHint(name: string, platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' ? `tmux new-session -A -s ${name}` : `tmux attach -t ${name}`
}
