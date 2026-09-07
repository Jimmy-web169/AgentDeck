// Path display helpers that accept both POSIX and Windows paths. The CLIs write
// native paths into their transcripts, so on Windows a project cwd looks like
// C:\Users\me\repo — splitting on '/' alone would leave that path whole and
// the UI would render the entire thing wherever it meant to show "me/repo".
const SEP = /[\\/]+/

export function splitPath(p) {
  return String(p || '').split(SEP).filter(Boolean)
}

// last `n` segments joined with '/': "…/project/maintain/AgentDeck" → "maintain/AgentDeck"
export function shortPath(p, n = 2) {
  const parts = splitPath(p)
  return parts.slice(-n).join('/') || String(p || '') || '(unknown)'
}

// final segment only: "C:\Users\me\repo" → "repo"
export function baseName(p) {
  const parts = splitPath(p)
  return parts[parts.length - 1] || String(p || '')
}

// project display name: prefer the real cwd, fall back to the provider slug
export function projectName(cwd, slug) {
  return baseName(cwd) || String(slug || '') || '(unknown)'
}
