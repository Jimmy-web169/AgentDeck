// Path display helpers that accept both POSIX and Windows paths. The CLIs write
// native paths into their transcripts, so on Windows a project cwd looks like
// C:\Users\me\repo — splitting on '/' alone would leave that path whole and
// the UI would render the entire thing wherever it meant to show "me/repo".
import { getPrefs } from './prefs.ts'

const SEP = /[\\/]+/

export function splitPath(p: unknown) {
  return String(p || '')
    .split(SEP)
    .filter(Boolean)
}

// last `n` folders of a path: "…/project/maintain/AgentDeck" → "maintain/AgentDeck",
// "C:\\Users\\me\\repo" → "me\\repo" (the path's own separator is kept, so a Windows
// path still reads as one). `n` defaults to the user's Preferences › Paths choice;
// 0 = the whole path. Callers pass an explicit `n` only to disambiguate same-named
// folders, never for display depth.
export function shortPath(p: unknown, n = getPrefs().pathDepth) {
  const str = String(p || '')
  if (!str) return '(unknown)'
  if (!(n > 0)) return str
  const parts = splitPath(str)
  const sep = str.includes('\\') ? '\\' : '/'
  return parts.slice(-n).join(sep) || str
}

// final segment only: "C:\Users\me\repo" → "repo"
export function baseName(p: unknown) {
  const parts = splitPath(p)
  return parts[parts.length - 1] || String(p || '')
}

// project display name: prefer the real cwd, fall back to the provider slug —
// which is itself a path for Antigravity (cwd-keyed projects), so shorten that too
export function projectName(cwd: unknown, slug: unknown) {
  return baseName(cwd) || (SEP.test(String(slug || '')) ? baseName(slug) : String(slug || '')) || '(unknown)'
}
