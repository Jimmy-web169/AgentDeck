import fs from 'node:fs'
import type { HttpProvider } from '../http.ts'
import type { Project } from '../../shared/types.d.ts'
import { jsonRecord } from '../shared/json.ts'
import path from 'node:path'
import crypto from 'node:crypto'
import { configDir } from '../shared/roots.ts'

const error = (status: number, message: string) => Object.assign(new Error(message), { status })
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Folder identity is local to this server. Only real, resolved directories are
// merged; missing paths remain source-specific instead of guessing aliases.
export function folderIdentity(cwd: string | null | undefined, source: Partial<Pick<FolderSource, 'provider' | 'root' | 'slug'>>) {
  try {
    if (!cwd || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('unresolved')
    const canonical = fs.realpathSync.native(cwd)
    return { id: hash(['local-folder-v1', canonical]), cwd: canonical, resolved: true }
  } catch {
    return { id: hash(['unresolved-v1', source.provider, source.root, source.slug]), cwd: cwd || null, resolved: false }
  }
}

export interface FolderSource {
  provider: string
  root: string
  rootLabel: string
  slug: string
  cwd: string | null
  sessionCount: number
}
export interface Folder {
  id: string
  cwd: string | null
  resolved: boolean
  name: string
  sources: FolderSource[]
  sessionCount: number
  lastActivity: number
}
interface SourceError {
  provider: string
  root?: string
  rootLabel?: string
  error: unknown
}
export interface FolderCatalog {
  folders: Folder[]
  errors: SourceError[]
  capturedAt: number
}
export function createFolderCatalog(providers: Record<string, HttpProvider>, { now = Date.now, ttl = 30000 } = {}) {
  let cache: { scope: string; at: number; data: FolderCatalog } | null = null
  let inflight: { scope: string; generation: number; promise: Promise<FolderCatalog> } | null = null,
    generation = 0
  const query = async (provider: HttpProvider, endpoint: string, values: Record<string, string>) => {
    const r = await provider.dispatch('GET', `/api/${endpoint}`, new URLSearchParams(values))
    if (r.status !== 200) throw error(r.status, String(jsonRecord(r.body).error || 'Source unavailable'))
    return r.body
  }
  const invalidate = () => {
    generation++
    cache = null
  }
  async function list(): Promise<FolderCatalog> {
    const scope = configDir()
    if (cache && cache.scope === scope && now() - cache.at < ttl) return cache.data
    if (inflight?.scope === scope && inflight.generation === generation) return inflight.promise
    const gen = generation
    const promise = (async (): Promise<FolderCatalog> => {
      const groups = new Map<string, Folder>(),
        errors: SourceError[] = []
      for (const provider of Object.values(providers)) {
        let roots: ReturnType<HttpProvider['loadRoots']>
        try {
          roots = provider.loadRoots()
        } catch (e) {
          errors.push({ provider: provider.id, error: jsonRecord(e).message })
          continue
        }
        for (const root of roots) {
          try {
            if (root.dir && !fs.statSync(root.dir, { throwIfNoEntry: false })?.isDirectory()) throw error(404, 'Registered data root is unavailable')
            // Provider-owned normalized output; its contract is checked in integration tests.
            const data = (await query(provider, 'projects', { root: root.id })) as { projects: (Project & { sessions?: number })[] }
            for (const project of data.projects || []) {
              const source = {
                provider: provider.id,
                root: root.id,
                rootLabel: root.label || root.id,
                slug: project.slug,
                cwd: project.cwd || null,
                sessionCount: project.sessionCount ?? project.sessions ?? 0,
              }
              const identity = folderIdentity(project.cwd, source)
              const folder = groups.get(identity.id) || {
                ...identity,
                name: identity.cwd ? path.basename(identity.cwd) : '(no working folder)',
                sources: [],
                sessionCount: 0,
                lastActivity: 0,
              }
              folder.sources.push(source)
              folder.sessionCount += source.sessionCount
              folder.lastActivity = Math.max(folder.lastActivity, Number(project.lastActivity) || 0)
              groups.set(identity.id, folder)
            }
          } catch (e) {
            errors.push({ provider: provider.id, root: root.id, rootLabel: root.label, error: jsonRecord(e).message })
          }
        }
      }
      const data = { folders: [...groups.values()].sort((a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id)), errors, capturedAt: now() }
      if (gen === generation) cache = { scope, data, at: now() }
      return data
    })()
    const flight = { promise, scope, generation: gen }
    inflight = flight
    try {
      return await promise
    } finally {
      if (inflight === flight) inflight = null
    }
  }
  return { list, invalidate }
}
