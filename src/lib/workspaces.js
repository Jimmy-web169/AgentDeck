import { useSyncExternalStore } from 'react'
import { baseName, shortPath } from './paths.js'

// Workspaces — named groups of projects AND sessions from any provider /
// folder, kept in localStorage. The classic case: the same repo driven by
// Claude Code, by a second Claude account and by Codex shows up as three
// projects; a workspace puts them under one name and shows their sessions as
// one list.
//   workspace = { id, name, items: [item], at, color?, icon? }
//                color = any hex (lib/accent.js; legacy names still resolve) — tints the icon only
//                icon  = one of WORKSPACE_ICON_KEYS (glyphs in components/shared/workspaceIcons.jsx)
//   item      = { kind: 'project' | 'session', provider, root, rootLabel, slug, cwd, project, id?, title? }
//             | { kind: 'folder', folderId, cwd, name } (live canonical reference)
const KEY = 'agentdeck_workspaces'
import { normalizeColor } from './accent.js'
export const WORKSPACE_ICON_KEYS = ['layers', 'folder', 'star', 'bolt', 'rocket', 'flask', 'book', 'briefcase', 'globe', 'code', 'heart', 'tag']

export const projectKey = (p) => `${p?.provider || ''}|${p?.root || ''}|${p?.slug || ''}`
export const isFolderItem = (it) => it?.kind === 'folder'
export const folderItem = (folder) => ({ kind: 'folder', folderId: folder.id, cwd: folder.cwd, name: folder.name || baseName(folder.cwd) })
export const itemKey = (it) => isFolderItem(it) ? JSON.stringify(['folder', it.folderId]) : `${projectKey(it)}|${it?.kind === 'session' || it?.id ? it.id || '' : ''}`
export const sourceKey = (it) => `${it?.provider || ''}|${it?.root || ''}`

function normItem(it) {
  if (isFolderItem(it)) return typeof it.folderId === 'string' && it.folderId && typeof it.cwd === 'string' && it.cwd
    ? { kind: 'folder', folderId: it.folderId, cwd: it.cwd, name: it.name || baseName(it.cwd) } : null
  if (!it || !it.provider || !it.root || !it.slug) return null
  const kind = it.kind === 'session' || (it.kind == null && it.id) ? 'session' : 'project'
  return {
    kind,
    provider: it.provider,
    root: it.root,
    rootLabel: it.rootLabel || '',
    slug: it.slug,
    cwd: it.cwd || null,
    project: it.project || it.name || baseName(it.cwd || it.slug),
    id: kind === 'session' ? it.id : null,
    title: kind === 'session' ? it.title || null : null,
  }
}

function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(arr)) return []
    return arr
      .filter((w) => w && typeof w.id === 'string' && typeof w.name === 'string')
      .map((w) => ({
        id: w.id,
        name: w.name,
        at: w.at || 0,
        color: normalizeColor(w.color),
        icon: WORKSPACE_ICON_KEYS.includes(w.icon) ? w.icon : null,
        // v1 stored `projects`; fold them into `items`
        items: [...(Array.isArray(w.items) ? w.items : []), ...(Array.isArray(w.projects) ? w.projects.map((p) => ({ ...p, kind: 'project' })) : [])].map(normItem).filter(Boolean),
      }))
  } catch {
    return []
  }
}

let workspaces = load()
const subs = new Set()
const emit = () => subs.forEach((fn) => fn())
const subscribe = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    workspaces = load()
    emit()
  })
}
function save(next) {
  workspaces = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
  emit()
}

export const getWorkspaces = () => workspaces
export function useWorkspaces() {
  return useSyncExternalStore(subscribe, getWorkspaces, getWorkspaces)
}

export function createWorkspace(name, items = []) {
  const seen = new Set()
  const list = []
  for (const raw of items) {
    const it = normItem(raw)
    if (!it) continue
    const k = itemKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    list.push(it)
  }
  // the same member set already grouped (e.g. "Group" pressed twice) → reuse it
  if (list.length) {
    const sig = list.map(itemKey).sort().join('\n')
    const dup = workspaces.find((w) => w.items.length === list.length && w.items.map(itemKey).sort().join('\n') === sig)
    if (dup) return dup.id
  }
  const id = Math.random().toString(36).slice(2, 10)
  save([...workspaces, { id, name: String(name || '').trim() || 'Workspace', items: list, at: Date.now() }])
  return id
}

export function renameWorkspace(id, name) {
  const n = String(name || '').trim()
  if (!n) return
  save(workspaces.map((w) => (w.id === id ? { ...w, name: n } : w)))
}

export function deleteWorkspace(id) {
  save(workspaces.filter((w) => w.id !== id))
}

// any hex; null clears the colour (back to the neutral workspace icon)
export function setWorkspaceColor(id, color) {
  const c = normalizeColor(color)
  save(workspaces.map((w) => (w.id === id ? { ...w, color: c } : w)))
}

export function setWorkspaceIcon(id, icon) {
  const i = WORKSPACE_ICON_KEYS.includes(icon) ? icon : null
  save(workspaces.map((w) => (w.id === id ? { ...w, icon: i } : w)))
}

// The workspace that holds this project or session, or null. Grouping moves a
// row into its workspace the way pinning moves it into Pinned: the sidebar
// hides a held project from Projects and a held session from its project's
// inline list, so nothing is listed twice (searching shows everything again).
export function workspaceHolding(raw, list = workspaces, folders = []) {
  const it = normItem(raw)
  if (!it) return null
  const k = itemKey(it)
  return list.find((w) => w.items.some((x) => itemKey(x) === k) ||
    (!isFolderItem(it) && folderProjects(w, folders).some((p) => projectKey(p) === projectKey(it)))) || null
}

export function addToWorkspace(id, raw) {
  const it = normItem(raw)
  if (!it) return
  const k = itemKey(it)
  save(workspaces.map((w) => (w.id === id && !w.items.some((x) => itemKey(x) === k) ? { ...w, items: [...w.items, it] } : w)))
}

export function removeFromWorkspace(id, raw) {
  const it = normItem(raw)
  if (!it) return
  const k = itemKey(it)
  save(workspaces.map((w) => (w.id === id ? { ...w, items: w.items.filter((x) => itemKey(x) !== k) } : w)))
}

export const inWorkspace = (w, raw) => {
  const it = normItem(raw)
  return !!it && w.items.some((x) => itemKey(x) === itemKey(it))
}

// Resolve against the current catalog only. Missing/moved folders are never
// rebound by path or name; persisted membership never stores source snapshots.
export function folderProjects(w, folders = []) {
  const ids = new Set(w.items.filter(isFolderItem).map((it) => it.folderId))
  return folders.filter((f) => f.resolved && ids.has(f.id)).flatMap((f) => f.sources
    .filter((s) => s.slug).map((s) => normItem({ ...s, kind: 'project', cwd: s.cwd || f.cwd, project: baseName(f.cwd) }))).filter(Boolean)
}

// The folder tree renders covered members once; explicit membership stays
// stored, so removing a folder restores separately added projects/sessions.
export function standaloneWorkspaceItems(w, folders = []) {
  const covered = new Set(folderProjects(w, folders).map(projectKey))
  return w.items.filter((it) => !isFolderItem(it) && !covered.has(projectKey(it)))
}

// Distinct provider/root sources, including current folder membership.
export const workspaceSources = (w, folders = []) => {
  const seen = new Map()
  for (const it of [...w.items.filter((it) => !isFolderItem(it)), ...folderProjects(w, folders)]) {
    const k = sourceKey(it)
    if (!seen.has(k)) seen.set(k, { key: k, provider: it.provider, root: it.root, rootLabel: it.rootLabel })
  }
  return [...seen.values()]
}

// Projects that share a working directory across providers or folders (the
// same repo opened with Claude Code, a second Claude account and Codex) and
// aren't grouped yet — offered as one-click workspaces.
export const normCwd = (c) =>
  String(c || '')
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()

// "New conversation here with…" opens a project's folder in another provider /
// account that has no project for it yet. The project only exists once the CLI
// writes its first record, so the workspaces holding the source project note
// the (provider, folder, cwd) they are waiting for and adopt the newcomer when
// the index shows it — the user should not have to tick it by hand a second
// time. Pending adoptions live in localStorage (the terminal outlives a reload)
// and expire after a day. The suggestions box would not offer it: a folder
// group counts as dealt with once any of its projects is grouped.
const ADOPT_KEY = 'agentdeck_workspace_adopt'
const ADOPT_TTL = 24 * 60 * 60 * 1000
function loadAdoptions() {
  try {
    const arr = JSON.parse(localStorage.getItem(ADOPT_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((a) => a && a.ws && a.provider && a.root && a.cwd && Date.now() - (a.at || 0) < ADOPT_TTL) : []
  } catch {
    return []
  }
}
function saveAdoptions(list) {
  try {
    if (list.length) localStorage.setItem(ADOPT_KEY, JSON.stringify(list))
    else localStorage.removeItem(ADOPT_KEY)
  } catch {}
}

// `source` is the project the conversation was started from, `target` the
// { provider, root } it was started in, `cwd` the folder. No-op unless a
// workspace holds the source project.
export function rememberAdoption(source, target, cwd) {
  const src = normItem({ ...source, kind: 'project' })
  if (!src || !target?.provider || !target?.root || !cwd) return
  const holders = workspaces.filter((w) => inWorkspace(w, src))
  if (!holders.length) return
  const key = normCwd(cwd)
  const list = loadAdoptions().filter((a) => !holders.some((w) => w.id === a.ws && a.provider === target.provider && a.root === target.root && a.cwd === key))
  for (const w of holders) list.push({ ws: w.id, provider: target.provider, root: target.root, cwd: key, at: Date.now() })
  saveAdoptions(list)
}

// called with the live project index; adopts what has appeared, keeps waiting for the rest
export function adoptPendingProjects(indexProjects = []) {
  const list = loadAdoptions()
  if (!list.length) return
  const keep = []
  for (const a of list) {
    const p = indexProjects.find((x) => x.provider === a.provider && x.root === a.root && x.cwd && normCwd(x.cwd) === a.cwd)
    if (!p) {
      keep.push(a)
      continue
    }
    if (workspaces.some((w) => w.id === a.ws)) addToWorkspace(a.ws, { kind: 'project', provider: p.provider, root: p.root, rootLabel: p.rootLabel, slug: p.slug, cwd: p.cwd, project: p.name || p.project })
  }
  if (keep.length !== list.length) saveAdoptions(keep)
}

export function suggestWorkspaces(indexProjects = [], current = workspaces, folders = []) {
  // a folder group counts as "dealt with" as soon as ANY of its projects is in
  // some workspace — the user made a call about it
  const grouped = new Set(current.flatMap((w) => [...w.items.filter((it) => !isFolderItem(it)), ...folderProjects(w, folders)].map(projectKey)))
  const byCwd = new Map()
  for (const p of indexProjects) {
    if (!p.cwd) continue
    const k = normCwd(p.cwd)
    if (!byCwd.has(k)) byCwd.set(k, [])
    byCwd.get(k).push(p)
  }
  const out = []
  for (const [, list] of byCwd) {
    const sources = new Set(list.map(sourceKey))
    if (sources.size < 2) continue
    if (list.some((p) => grouped.has(projectKey(p)))) continue
    out.push({ name: baseName(list[0].cwd), cwd: list[0].cwd, items: list.map((p) => normItem({ ...p, kind: 'project' })), sources: list.map((p) => ({ provider: p.provider, root: p.root, rootLabel: p.rootLabel })) })
  }
  // two different folders called "AgentDeck" (…/project/AgentDeck and …/maintain/AgentDeck)
  // get their parent folder in the name so they can be told apart
  const byName = new Map()
  for (const s of out) byName.set(s.name, (byName.get(s.name) || 0) + 1)
  for (const s of out) if (byName.get(s.name) > 1) s.name = shortPath(s.cwd, 2)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
