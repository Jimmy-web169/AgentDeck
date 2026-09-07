import { useSyncExternalStore } from 'react'
import { baseName } from './paths.js'

// Workspaces — named groups of projects from any provider / folder, kept in
// localStorage. The classic case: the same repo driven by Claude Code and by
// Codex shows up as two projects; a workspace puts them under one name.
// A workspace = { id, name, projects: [{ provider, root, rootLabel, slug, cwd, project }], at }
const KEY = 'agentdeck_workspaces'

export const projectKey = (p) => `${p?.provider || ''}|${p?.root || ''}|${p?.slug || ''}`

function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr)
      ? arr
          .filter((w) => w && typeof w.id === 'string' && typeof w.name === 'string')
          .map((w) => ({ ...w, projects: Array.isArray(w.projects) ? w.projects.filter((p) => p && p.provider && p.root && p.slug) : [] }))
      : []
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

const strip = (p) => ({ provider: p.provider, root: p.root, rootLabel: p.rootLabel || '', slug: p.slug, cwd: p.cwd || null, project: p.project || p.name || baseName(p.cwd || p.slug) })

export const getWorkspaces = () => workspaces
export function useWorkspaces() {
  return useSyncExternalStore(subscribe, getWorkspaces, getWorkspaces)
}

export function createWorkspace(name, projects = []) {
  const id = Math.random().toString(36).slice(2, 10)
  const seen = new Set()
  const list = []
  for (const p of projects) {
    const k = projectKey(p)
    if (seen.has(k)) continue
    seen.add(k)
    list.push(strip(p))
  }
  save([...workspaces, { id, name: String(name || '').trim() || 'Workspace', projects: list, at: Date.now() }])
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

export function addToWorkspace(id, project) {
  const k = projectKey(project)
  save(workspaces.map((w) => (w.id === id && !w.projects.some((p) => projectKey(p) === k) ? { ...w, projects: [...w.projects, strip(project)] } : w)))
}

export function removeFromWorkspace(id, project) {
  const k = projectKey(project)
  save(workspaces.map((w) => (w.id === id ? { ...w, projects: w.projects.filter((p) => projectKey(p) !== k) } : w)))
}

export const inWorkspace = (w, project) => w.projects.some((p) => projectKey(p) === projectKey(project))

// Projects that share a working directory across providers (the same repo
// opened with Claude Code and with Codex) and aren't grouped yet — offered as
// one-click workspaces.
const normCwd = (c) =>
  String(c || '')
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()

export function suggestWorkspaces(indexProjects = [], current = workspaces) {
  const grouped = new Set(current.flatMap((w) => w.projects.map(projectKey)))
  const byCwd = new Map()
  for (const p of indexProjects) {
    if (!p.cwd) continue
    const k = normCwd(p.cwd)
    if (!byCwd.has(k)) byCwd.set(k, [])
    byCwd.get(k).push(p)
  }
  const out = []
  for (const [, list] of byCwd) {
    const providers = new Set(list.map((p) => p.provider))
    if (providers.size < 2) continue
    if (list.every((p) => grouped.has(projectKey(p)))) continue
    out.push({ name: baseName(list[0].cwd), cwd: list[0].cwd, projects: list.map(strip), providers: [...providers] })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
