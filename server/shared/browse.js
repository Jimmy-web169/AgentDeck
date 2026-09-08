import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandHome } from './roots.js'
import { pickFolderNative } from './launch.js'

// Filesystem folder browser behind GET /api/browse and the native picker behind
// GET /api/pick-folder — the same for every provider (spec §4 item 6: the three
// api.js files used to carry byte-identical copies). localhost-only; lists
// directory NAMES only (no file contents). Hidden dot-dirs are skipped in the
// listing (type a path to reach them).
function httpErr(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

export function getBrowse(q) {
  const home = os.homedir()
  const dir = expandHome((q.get('path') || '').trim()) || home
  let resolved
  try {
    resolved = fs.realpathSync(dir)
  } catch {
    resolved = path.resolve(dir)
  }
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {}
  if (!stat || !stat.isDirectory()) throw httpErr(404, `Not a directory: ${dir}`)
  let dirs = []
  try {
    dirs = fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((e) => {
        try {
          return (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')
        } catch {
          return false
        }
      })
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    // permission denied etc. — return an empty listing rather than failing
  }
  const parent = path.dirname(resolved)
  return { path: resolved, parent: parent !== resolved ? parent : null, home, dirs }
}

export const getPickFolder = async () => pickFolderNative()
