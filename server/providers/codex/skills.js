import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Codex skill-install config for the shared skills runner (see ../../shared/skills.js).
// The skills CLI (>=1.5.x) classifies codex as a "universal" agent (skillsDir
// `.agents/skills`), so `skills add -a codex -g` installs into ~/.agents/skills and
// ignores CODEX_HOME. Codex (and this monitor's UI) load user-scope skills from
// <CODEX_HOME>/skills, so after a user-scope install we relocate the freshly-added
// skill dir(s) there via the runner's afterRun hook.
const UNIVERSAL_GLOBAL_DIR = path.join(os.homedir(), '.agents', 'skills')

function listSkillDirs(dir) {
  try {
    return new Set(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() || d.isSymbolicLink())
        .map((d) => d.name),
    )
  } catch {
    return new Set()
  }
}

// Move every skill dir that appeared in ~/.agents/skills since `before` into
// <destSkillsDir>. Prefers rename; falls back to copy+remove across filesystems.
function relocateCodexSkills(before, destSkillsDir) {
  const added = [...listSkillDirs(UNIVERSAL_GLOBAL_DIR)].filter((n) => !before.has(n))
  if (!added.length) return []
  fs.mkdirSync(destSkillsDir, { recursive: true })
  const moved = []
  for (const name of added) {
    const from = path.join(UNIVERSAL_GLOBAL_DIR, name)
    const to = path.join(destSkillsDir, name)
    try {
      fs.rmSync(to, { recursive: true, force: true })
      fs.renameSync(from, to)
      moved.push(name)
    } catch {
      try {
        fs.cpSync(from, to, { recursive: true })
        fs.rmSync(from, { recursive: true, force: true })
        moved.push(name)
      } catch {}
    }
  }
  return moved
}

export const SKILL_CONFIG = {
  agent: 'codex',
  envKey: 'CODEX_HOME',
  forceAgent: true,
  // user-scope (-g) installs land in ~/.agents/skills; snapshot before, relocate after
  beforeRun: ({ global, configDir }) => (global && configDir ? listSkillDirs(UNIVERSAL_GLOBAL_DIR) : null),
  afterRun: ({ global, configDir }, before) => {
    if (!(global && configDir && before)) return ''
    const dest = path.join(configDir, 'skills')
    const moved = relocateCodexSkills(before, dest)
    return moved.length ? `\n\n[moved into ${dest}: ${moved.join(', ')}]` : ''
  },
}
