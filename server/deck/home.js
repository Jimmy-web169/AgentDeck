import crypto from 'node:crypto'
import fs from 'node:fs'
import { folderIdentity } from './catalog.js'
import { configDir } from '../shared/roots.js'
import { bucketActivity } from '../shared/activity.js'
import { queryList } from '../shared/homeQuery.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
const keyOf = (s) => JSON.stringify([s.provider, s.root])
const numeric = (v) => typeof v === 'number' && Number.isFinite(v)
const sum = (rows, k) => rows.reduce((n, r) => n + (numeric(r[k]) ? r[k] : 0), 0)
const stamp = (v) => v == null ? 0 : new Date(v).getTime() || 0
const excludedRoots = (q) => {
  const keys = queryList(q, 'excludedRoots') || new Set()
  for (const key of keys) {
    let pair
    try { pair = JSON.parse(key) } catch { throw fail(400, 'Invalid excludedRoots') }
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((v) => typeof v !== 'string' || !v) || JSON.stringify(pair) !== key) throw fail(400, 'Invalid excludedRoots')
  }
  return keys
}

// Home reads registered sources, never a sidebar folder. Canonical folders are
// presentation groups only; missing working directories must not erase history.
export function createHomeService(providers, { now = Date.now, pageSize = 50 } = {}) {
  const snapshots = new Map(), cache = new Map(), flights = new Map()
  let generation = 0
  const invalidate = () => { generation++; cache.clear() }

  async function resolve(q) {
    const excluded = queryList(q, 'excluded') || new Set()
    const roots = excludedRoots(q)
    const groups = new Map(), errors = []
    for (const p of Object.values(providers)) {
      if (excluded.has(p.id)) continue
      try {
        for (const r of p.loadRoots()) {
          const source = { provider: p.id, root: r.id, rootLabel: r.label || r.id, allProjects: true }
          if (roots.has(keyOf(source))) continue
          if (r.dir) {
            try { if (!fs.statSync(r.dir, { throwIfNoEntry: false })?.isDirectory()) source.error = 'Registered data root is unavailable' }
            catch { source.error = 'Registered data root cannot be read' }
          }
          if (!groups.has(keyOf(source))) groups.set(keyOf(source), source)
        }
      } catch (e) { if (!errors.some((x) => x.provider === p.id)) errors.push({ provider: p.id, error: e.message }) }
    }
    const sources = [...groups.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    return { sources, errors }
  }

  async function collect(q) {
    const view = q.get('view')
    if (!['stats', 'insights', 'history', 'plugins', 'resources'].includes(view)) throw fail(400, 'Unknown Home page')
    const scope = await resolve(q), errors = [...scope.errors], notices = [], results = []
    for (const source of scope.sources) {
      const adapter = providers[source.provider]?.home
      const report = (e, extra = {}) => errors.push({ provider: source.provider, root: source.root, rootLabel: source.rootLabel, ...extra, error: e.message || String(e) })
      if (source.error) { report(source.error); continue }
      if (typeof adapter?.[view] !== 'function') { report('This provider does not support this Home page'); continue }
      try {
        if (view === 'resources') {
          const entries = []
          try { entries.push({ scope: 'user', ...await adapter.resources(source) }) } catch (e) { report(e, { resourceScope: 'user' }) }
          results.push({ ...source, entries })
          continue
        }
        const data = await adapter[view](source)
        if (data.incomplete?.length) notices.push({ ...source, message: `${data.incomplete.length} transcripts could not contribute usage; totals are partial.` })
        if (data.coverage?.readError) report(data.coverage.readError)
        if (data.coverage?.unattributed) notices.push({ ...source, message: `${data.coverage.unattributed} prompts have no recorded folder; they are still included.` })
        if (data.coverage?.malformed) notices.push({ ...source, message: `${data.coverage.malformed} malformed history records were skipped.` })
        results.push({ ...source, data, note: adapter.statsNote || '' })
      } catch (e) { report(e) }
    }
    const common = { scope, errors, notices, capturedAt: now() }
    if (view === 'plugins' || view === 'resources') return { ...common, sources: results }
    if (view === 'stats') {
      const sources = results.map(({ data, ...source }) => {
        const projects = (data.projects || []).map((p) => ({ ...p, folder: folderIdentity(p.cwd, { ...source, slug: p.slug }) }))
        const totals = Object.fromEntries(['sessions', 'subagentSessions', 'userTurns', 'toolCalls'].map((k) => [k, sum(projects, k)]))
        const tokens = {}, fields = data.fields || { common: [], specific: [] }
        for (const k of [...fields.common, ...fields.specific]) tokens[k] = projects.every((p) => numeric(p.tokens?.[k])) ? sum(projects.map((p) => p.tokens), k) : null
        return { ...source, stats: { ...totals, tokens, fields, projects } }
      })
      const totals = Object.fromEntries(['sessions', 'subagentSessions', 'userTurns', 'toolCalls'].map((k) => [k, sum(sources.map((s) => s.stats), k)]))
      const tokens = {}, coverage = {}
      for (const k of new Set(sources.flatMap((s) => s.stats.fields.common))) {
        const available = sources.filter((s) => s.stats.fields.common.includes(k) && numeric(s.stats.tokens[k]))
        tokens[k] = available.length ? sum(available.map((s) => s.stats.tokens), k) : null
        coverage[k] = { available: available.length, sources: scope.sources.length }
      }
      const folders = new Map()
      for (const source of sources) for (const p of source.stats.projects) {
        const f = folders.get(p.folder.id) || { ...p.folder, sessions: 0, sources: [] }
        f.sessions += p.sessions || 0
        f.sources.push({ provider: source.provider, root: source.root, rootLabel: source.rootLabel, note: source.note, stats: { ...p, fields: source.stats.fields } })
        folders.set(f.id, f)
      }
      return { ...common, totals: { ...totals, tokens }, coverage, sources, folders: [...folders.values()].sort((a, b) => b.sessions - a.sessions || a.id.localeCompare(b.id)) }
    }
    if (view === 'insights') {
      const records = new Map(), sources = [], folders = new Map()
      for (const source of results) {
        let count = 0, skipped = 0
        for (const r of source.data.records || []) {
          if (r.isSubagent) continue
          if (r.oversized) { skipped++; continue }
          const key = JSON.stringify([source.provider, source.root, r.id])
          if (records.has(key)) continue
          const identity = folderIdentity(r.cwd, { ...source, slug: r.slug })
          const record = { ...r, slug: identity.id, cwd: identity.cwd }
          records.set(key, record); count++
          const folder = folders.get(identity.id) || { ...identity, records: [], sourceRecords: new Map() }
          folder.records.push(record); folders.set(identity.id, folder)
          // Keep native project identity alongside the canonical overview key.
          // Drill-down must not substitute a canonical folder ID for a slug.
          const sourceKey = JSON.stringify([source.provider, source.root, r.slug])
          const group = folder.sourceRecords.get(sourceKey) || { provider: source.provider, root: source.root, rootLabel: source.rootLabel, slug: r.slug, cwd: r.cwd, records: [] }
          group.records.push(r)
          folder.sourceRecords.set(sourceKey, group)
        }
        if (skipped) notices.push({ ...source, message: `${skipped} oversized transcripts excluded from Insights.` })
        sources.push({ provider: source.provider, root: source.root, rootLabel: source.rootLabel, sessions: count })
      }
      const activityOf = (rows) => bucketActivity(rows, { days: 84, now: now() })
      return { ...common, sources, activity: activityOf([...records.values()]), folders: [...folders.values()].map(({ records, sourceRecords, ...folder }) => ({ ...folder, activity: activityOf(records), sources: [...sourceRecords.values()].map(({ records, ...source }) => ({ ...source, activity: activityOf(records) })) })).sort((a, b) => (a.cwd || '').localeCompare(b.cwd || '')) }
    }
    const query = (q.get('search') || '').trim().toLowerCase(), history = []
    for (const source of results) {
      for (const h of source.data.history || []) {
        if (query && !String(h.display).toLowerCase().includes(query)) continue
        history.push({ ...h, key: JSON.stringify([source.provider, source.root, h.rowId]), provider: source.provider, root: source.root, rootLabel: source.rootLabel, cwd: h.project || null })
      }
    }
    history.sort((a, b) => stamp(b.ts) - stamp(a.ts) || a.key.localeCompare(b.key))
    return { ...common, history }
  }

  const queryKey = (q) => JSON.stringify([configDir(), q.get('view'), [...(queryList(q, 'excluded') || [])].sort(), [...excludedRoots(q)].sort(), q.get('search') || ''])
  async function read(q) {
    const key = queryKey(q), cursor = q.get('cursor')
    if (cursor) {
      const saved = snapshots.get(cursor)
      if (!saved || saved.key !== key || now() - saved.at > 120000) throw fail(409, 'History results expired or scope changed. Refresh to continue.')
      return historyPage(saved.data, key, saved.offset, saved.at)
    }
    if (q.get('fresh') === '1') invalidate()
    let data = cache.get(key)?.data
    if (!data || now() - data.capturedAt > 15000) {
      const gen = generation, flightKey = `${gen}:${key}`
      let flight = flights.get(flightKey)
      if (!flight) {
        flight = collect(q).finally(() => flights.delete(flightKey))
        flights.set(flightKey, flight)
      }
      data = await flight
      if (gen === generation) { cache.set(key, { data }); while (cache.size > 8) cache.delete(cache.keys().next().value) }
    }
    return q.get('view') === 'history' ? historyPage(data, key, 0, now()) : data
  }
  function historyPage(data, key, offset, at) {
    let nextCursor = null
    if (offset + pageSize < data.history.length) {
      nextCursor = crypto.randomUUID()
      snapshots.set(nextCursor, { data, key, offset: offset + pageSize, at })
      for (const [token, saved] of snapshots) if (now() - saved.at > 120000) snapshots.delete(token)
      while (snapshots.size > 24) snapshots.delete(snapshots.keys().next().value)
    }
    return { ...data, total: data.history.length, history: data.history.slice(offset, offset + pageSize), nextCursor }
  }
  return { read, resolve, invalidate }
}
