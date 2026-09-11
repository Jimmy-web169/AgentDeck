// Browser state keeps the established keys; this is not an on-disk migration.
export const readStorage = (key: string) => localStorage.getItem(key)
export const writeStorage = (key: string, value: string) => localStorage.setItem(key, value)

interface Sections {
  workspaces: boolean
  pinned: boolean
  projects: boolean
}
const SECTIONS_KEY = 'agentdeck_sidebar_sections'
export function loadSidebarSections(): Sections {
  try {
    return { workspaces: true, pinned: true, projects: true, ...JSON.parse(readStorage(SECTIONS_KEY) || '{}') }
  } catch {
    return { workspaces: true, pinned: true, projects: true }
  }
}
export function saveSidebarSections(value: Sections) {
  try {
    writeStorage(SECTIONS_KEY, JSON.stringify(value))
  } catch {}
}
