import type { ServerProvider } from '../registry.ts'
import type { ProviderHomeData, HomeActivityRecord } from './homeAdapter.ts'
import { jsonRecord } from '../shared/json.ts'
interface Source {
  provider: string
  root: string
  rootLabel: string
  allProjects: true
  error?: string
}
interface SourceError {
  provider: string
  root?: string
  rootLabel?: string
  error: unknown
}
interface Notice extends Source {
  message: string
}
interface SourceResult extends Source {
  data: ProviderHomeData
  note: string
}
type FolderIdentity = ReturnType<typeof folderIdentity>
interface InsightSource {
  provider: string
  root: string
  rootLabel: string
  slug: string
  cwd?: string | null
  records: HomeActivityRecord[]
}
interface InsightFolder extends FolderIdentity {
  records: HomeActivityRecord[]
  sourceRecords: Map<string, InsightSource>
}
interface StatsFolder extends FolderIdentity {
  sessions: number
  sources: unknown[]
}
import { homeSourceKey, homeProjectKey, homeRecordKey, homeReportCacheKey } from '../../shared/identity.ts'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { folderIdentity } from './catalog.ts'
import { configDir } from '../shared/roots.ts'
import { bucketActivity } from '../shared/activity.ts'
import { queryList } from '../shared/homeQuery.ts'

const fail = (status: number, message: string) => Object.assign(new Error(message), { status })
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const sum = (rows: (Record<string, unknown> | undefined)[], k: string) => rows.reduce((n, r) => n + (numeric(r?.[k]) ? Number(r?.[k]) : 0), 0)
const stamp = (v: string | number | null | undefined) => (v == null ? 0 : new Date(v).getTime() || 0)
const excludedRoots = (q: URLSearchParams) => {
  const keys = queryList(q, 'excludedRoots') || new Set()
  for (const key of keys) {
    let pair: unknown
    try {
      pair = JSON.parse(key)
    } catch {
      throw fail(400, 'Invalid excludedRoots')
    }
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((v) => typeof v !== 'string' || !v) || JSON.stringify(pair) !== key)
      throw fail(400, 'Invalid excludedRoots')
  }
  return keys
}

// Home reads registered sources, never a sidebar folder. Canonical folders are
// presentation groups only; missing working directories must not erase history.
export function createHomeService(providers: Record<string, ServerProvider>, { now = Date.now, pageSize = 50 } = {}) {
  type Collected = Awaited<ReturnType<typeof collect>>
  type History = Extract<Collected, { history: unknown }>
  const snapshots = new Map<string, { data: History; key: string; offset: number; at: number }>(),
    cache = new Map<string, { data: Collected }>(),
    flights = new Map<string, Promise<Collected>>()
  let generation = 0
  const invalidate = () => {
    generation++
    cache.clear()
  }

  async function resolve(q: URLSearchParams) {
    const excluded = queryList(q, 'excluded') || new Set()
    const roots = excludedRoots(q)
    const groups = new Map<string, Source>(),
      errors: SourceError[] = []
    for (const p of Object.values(providers)) {
      if (excluded.has(p.id)) continue
      try {
        for (const r of p.loadRoots()) {
          const source: Source = { provider: p.id, root: r.id, rootLabel: r.label || r.id, allProjects: true }
          if (roots.has(homeSourceKey(source))) continue
          if (r.dir) {
            try {
              if (!fs.statSync(r.dir, { throwIfNoEntry: false })?.isDirectory()) source.error = 'Registered data root is unavailable'
            } catch {
              source.error = 'Registered data root cannot be read'
            }
          }
          if (!groups.has(homeSourceKey(source))) groups.set(homeSourceKey(source), source)
        }
      } catch (e) {
        if (!errors.some((x) => x.provider === p.id)) errors.push({ provider: p.id, error: jsonRecord(e).message })
      }
    }
    const sources = [...groups.values()].sort((a, b) => homeSourceKey(a).localeCompare(homeSourceKey(b)))
    return { sources, errors }
  }

  async function collect(q: URLSearchParams) {
    const view = q.get('view') || ''
    if (view !== 'stats' && view !== 'insights' && view !== 'history' && view !== 'plugins' && view !== 'resources') throw fail(400, 'Unknown Home page')
    const scope = await resolve(q),
      errors = [...scope.errors],
      notices: Notice[] = [],
      results: SourceResult[] = [],
      resourceResults: (Source & { entries: (Awaited<ReturnType<NonNullable<ServerProvider['home']>['resources']>> & { scope: string })[] })[] = []
    for (const source of scope.sources) {
      const adapter = providers[source.provider]?.home
      const report = (e: unknown, extra: Record<string, unknown> = {}) =>
        errors.push({ provider: source.provider, root: source.root, rootLabel: source.rootLabel, ...extra, error: jsonRecord(e).message || String(e) })
      if (source.error) {
        report(source.error)
        continue
      }
      if (typeof adapter?.[view] !== 'function') {
        report('This provider does not support this Home page')
        continue
      }
      try {
        if (view === 'resources') {
          const entries = []
          try {
            entries.push({ scope: 'user', ...(await adapter.resources(source)) })
          } catch (e) {
            report(e, { resourceScope: 'user' })
          }
          resourceResults.push({ ...source, entries })
          continue
        }
        const data = await adapter[view](source)
        if (data.incomplete?.length)
          notices.push({ ...source, message: `${data.incomplete.length} transcripts could not contribute usage; totals are partial.` })
        if (data.coverage?.readError) report(data.coverage.readError)
        if (data.coverage?.unattributed)
          notices.push({ ...source, message: `${data.coverage.unattributed} prompts have no recorded folder; they are still included.` })
        if (data.coverage?.malformed) notices.push({ ...source, message: `${data.coverage.malformed} malformed history records were skipped.` })
        results.push({ ...source, data, note: adapter.statsNote || '' })
      } catch (e) {
        report(e)
      }
    }
    const common = { scope, errors, notices, capturedAt: now() }
    if (view === 'resources') return { ...common, sources: resourceResults }
    if (view === 'plugins') return { ...common, sources: results }
    if (view === 'stats') {
      const sources = results.map(({ data, ...source }) => {
        const projects = (data.projects || []).map((p) => ({ ...p, folder: folderIdentity(p.cwd, { ...source, slug: p.slug }) }))
        const totals = Object.fromEntries(['sessions', 'subagentSessions', 'userTurns', 'toolCalls'].map((k) => [k, sum(projects, k)])) as Record<
          'sessions' | 'subagentSessions' | 'userTurns' | 'toolCalls',
          number
        >
        const tokens: Record<string, number | null> = {},
          fields = data.fields || { common: [], specific: [] }
        for (const k of [...fields.common, ...fields.specific])
          tokens[k] = projects.every((p) => numeric(p.tokens?.[k]))
            ? sum(
                projects.map((p) => p.tokens),
                k
              )
            : null
        return { ...source, stats: { ...totals, tokens, fields, projects } }
      })
      const totals = Object.fromEntries(
        ['sessions', 'subagentSessions', 'userTurns', 'toolCalls'].map((k) => [
          k,
          sum(
            sources.map((s) => s.stats),
            k
          ),
        ])
      ) as Record<'sessions' | 'subagentSessions' | 'userTurns' | 'toolCalls', number>
      const tokens: Record<string, number | null> = {},
        coverage: Record<string, { available: number; sources: number }> = {}
      for (const k of new Set(sources.flatMap((s) => s.stats.fields.common))) {
        const available = sources.filter((s) => s.stats.fields.common.includes(k) && numeric(s.stats.tokens[k]))
        tokens[k] = available.length
          ? sum(
              available.map((s) => s.stats.tokens),
              k
            )
          : null
        coverage[k] = { available: available.length, sources: scope.sources.length }
      }
      const folders = new Map<string, StatsFolder>()
      for (const source of sources)
        for (const p of source.stats.projects) {
          const f = folders.get(p.folder.id) || { ...p.folder, sessions: 0, sources: [] }
          f.sessions += p.sessions || 0
          f.sources.push({
            provider: source.provider,
            root: source.root,
            rootLabel: source.rootLabel,
            note: source.note,
            stats: { ...p, fields: source.stats.fields },
          })
          folders.set(f.id, f)
        }
      return {
        ...common,
        totals: { ...totals, tokens },
        coverage,
        sources,
        folders: [...folders.values()].sort((a, b) => b.sessions - a.sessions || a.id.localeCompare(b.id)),
      }
    }
    if (view === 'insights') {
      const records = new Map<string, HomeActivityRecord>(),
        sources = [],
        folders = new Map<string, InsightFolder>()
      for (const source of results) {
        let count = 0,
          skipped = 0
        for (const r of source.data.records || []) {
          if (r.isSubagent) continue
          if (r.oversized) {
            skipped++
            continue
          }
          const key = homeRecordKey(source, r.id)
          if (records.has(key)) continue
          const identity = folderIdentity(r.cwd, { ...source, slug: r.slug })
          const record = { ...r, slug: identity.id, cwd: identity.cwd }
          records.set(key, record)
          count++
          const folder: InsightFolder = folders.get(identity.id) || { ...identity, records: [], sourceRecords: new Map() }
          folder.records.push(record)
          folders.set(identity.id, folder)
          // Keep native project identity alongside the canonical overview key.
          // Drill-down must not substitute a canonical folder ID for a slug.
          const sourceKey = homeProjectKey({ ...source, slug: r.slug })
          const group = folder.sourceRecords.get(sourceKey) || {
            provider: source.provider,
            root: source.root,
            rootLabel: source.rootLabel,
            slug: r.slug,
            cwd: r.cwd,
            records: [],
          }
          group.records.push(r)
          folder.sourceRecords.set(sourceKey, group)
        }
        if (skipped) notices.push({ ...source, message: `${skipped} oversized transcripts excluded from Insights.` })
        sources.push({ provider: source.provider, root: source.root, rootLabel: source.rootLabel, sessions: count })
      }
      const activityOf = (rows: HomeActivityRecord[]) => bucketActivity(rows, { days: 84, now: now() })
      return {
        ...common,
        sources,
        activity: activityOf([...records.values()]),
        folders: [...folders.values()]
          .map(({ records, sourceRecords, ...folder }) => ({
            ...folder,
            activity: activityOf(records),
            sources: [...sourceRecords.values()].map(({ records, ...source }) => ({ ...source, activity: activityOf(records) })),
          }))
          .sort((a, b) => (a.cwd || '').localeCompare(b.cwd || '')),
      }
    }
    const query = (q.get('search') || '').trim().toLowerCase(),
      history = []
    for (const source of results) {
      for (const h of source.data.history || []) {
        if (query && !String(h.display).toLowerCase().includes(query)) continue
        history.push({
          ...h,
          key: homeRecordKey(source, h.rowId),
          provider: source.provider,
          root: source.root,
          rootLabel: source.rootLabel,
          cwd: h.project || null,
        })
      }
    }
    history.sort((a, b) => stamp(b.ts) - stamp(a.ts) || a.key.localeCompare(b.key))
    return { ...common, history }
  }

  const queryKey = (q: URLSearchParams) =>
    homeReportCacheKey(configDir(), q.get('view'), [...(queryList(q, 'excluded') || [])].sort(), [...excludedRoots(q)].sort(), q.get('search') || '')
  async function read(q: URLSearchParams): Promise<Collected | ReturnType<typeof historyPage>> {
    const key = queryKey(q),
      cursor = q.get('cursor')
    if (cursor) {
      const saved = snapshots.get(cursor)
      if (!saved || saved.key !== key || now() - saved.at > 120000) throw fail(409, 'History results expired or scope changed. Refresh to continue.')
      return historyPage(saved.data, key, saved.offset, saved.at)
    }
    if (q.get('fresh') === '1') invalidate()
    let data = cache.get(key)?.data
    if (!data || now() - data.capturedAt > 15000) {
      const gen = generation,
        flightKey = `${gen}:${key}`
      let flight = flights.get(flightKey)
      if (!flight) {
        flight = collect(q).finally(() => flights.delete(flightKey))
        flights.set(flightKey, flight)
      }
      data = await flight
      if (gen === generation) {
        cache.set(key, { data })
        while (cache.size > 8) {
          const first = cache.keys().next()
          if (first.done) break
          cache.delete(first.value)
        }
      }
    }
    return q.get('view') === 'history' && 'history' in data ? historyPage(data, key, 0, now()) : data
  }
  function historyPage(data: History, key: string, offset: number, at: number) {
    let nextCursor = null
    if (offset + pageSize < data.history.length) {
      nextCursor = crypto.randomUUID()
      snapshots.set(nextCursor, { data, key, offset: offset + pageSize, at })
      for (const [token, saved] of snapshots) if (now() - saved.at > 120000) snapshots.delete(token)
      while (snapshots.size > 24) {
        const first = snapshots.keys().next()
        if (first.done) break
        snapshots.delete(first.value)
      }
    }
    return { ...data, total: data.history.length, history: data.history.slice(offset, offset + pageSize), nextCursor }
  }
  return { read, resolve, invalidate }
}
