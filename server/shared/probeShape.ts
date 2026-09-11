import type { ProbeResult } from '../../shared/probe.ts'
export type { ProbeResult } from '../../shared/probe.ts'
import crypto from 'node:crypto'
import { jsonRecord } from './json.ts'
export interface ProbeSpec {
  sample?: { glob?: string; newest?: number; head?: number; tail?: number }
  required?: string[]
  enums?: Record<string, string[]>
  types?: Record<string, string>
  version_field?: string
}
export interface Observation {
  records: number
  keys: string[]
  enums: Record<string, string[]>
  types: Record<string, string[]>
  presence: Record<string, number>
  versions: string[]
}
export interface Baseline {
  keys: string[]
  enums: Record<string, string[]>
  types: Record<string, string[]>
  fingerprint: string
  at: string
  versions: string[]
}
export interface StoredProbe {
  baseline?: Baseline
  last?: ProbeResult & Pick<Observation, 'keys' | 'enums' | 'types'>
}

const REQUIRED_MIN_SHARE = 0.5
const MAX_KEY_DEPTH = 2
// ---- observing a record set ----
const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
// values at a dotted path; `[]` steps into array elements — 'message.content[].type'
export function valuesAt(rec: unknown, dotted: string): unknown[] {
  let cur = [rec]
  for (const raw of String(dotted).split('.')) {
    const arr = raw.endsWith('[]')
    const key = arr ? raw.slice(0, -2) : raw
    const next: unknown[] = []
    for (const v of cur) {
      if (!v || typeof v !== 'object') continue
      const x = jsonRecord(v)[key]
      if (x === undefined) continue
      if (arr) {
        if (Array.isArray(x)) next.push(...x)
      } else next.push(x)
    }
    cur = next
    if (!cur.length) break
  }
  return cur
}
// a key that is really data (a file path, a UUID, a timestamp used as a map key)
// is not part of the format — Claude's file-history snapshots are keyed by
// absolute paths, and those must never end up in a fingerprint or on disk
const DATA_KEY = /[\\/:\s]|^[0-9a-f-]{20,}$|^\d{4}-\d{2}-\d{2}/i
const MAX_KEYS_PER_OBJECT = 40
function collectKeys(rec: unknown, prefix: string, depth: number, into: Set<string>) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return
  const entries = Object.entries(rec)
  if (entries.length > MAX_KEYS_PER_OBJECT) return // a dictionary, not a record shape
  for (const [k, v] of entries) {
    if (DATA_KEY.test(k) || k.length > 64) continue
    const p = prefix ? `${prefix}.${k}` : k
    into.add(p)
    if (depth < MAX_KEY_DEPTH && v && typeof v === 'object' && !Array.isArray(v)) collectKeys(v, p, depth + 1, into)
  }
}
export function observe(records: unknown[], spec: ProbeSpec | null): Observation {
  const keys = new Set<string>()
  const enums: Record<string, Set<string>> = {}
  const types: Record<string, Set<string>> = {}
  const presence: Record<string, number> = {}
  const versions = new Set<string>()
  for (const r of records) {
    collectKeys(r, '', 0, keys)
    for (const f of Object.keys(spec?.enums || {}))
      for (const v of valuesAt(r, f))
        if (typeof v === 'string') {
          enums[f] ||= new Set()
          enums[f].add(v)
        }
    for (const f of Object.keys(spec?.types || {}))
      for (const v of valuesAt(r, f)) {
        types[f] ||= new Set()
        types[f].add(typeOf(v))
      }
    for (const f of spec?.required || []) if (valuesAt(r, f).length) presence[f] = (presence[f] || 0) + 1
    if (spec?.version_field) for (const v of valuesAt(r, spec.version_field)) if (typeof v === 'string') versions.add(v)
  }
  const sorted = (o: Record<string, Set<string>>) =>
    Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, [...o[k]].sort()])
    )
  return { records: records.length, keys: [...keys].sort(), enums: sorted(enums), types: sorted(types), presence, versions: [...versions].sort() }
}
export const fingerprint = (obs: Pick<Observation, 'keys' | 'enums' | 'types'>) =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify({ keys: obs.keys, enums: obs.enums, types: obs.types }))
    .digest('hex')
    .slice(0, 16)

// ---- comparing with the descriptor and the stored baseline ----
export function compare(spec: ProbeSpec | null, obs: Observation, baseline: Pick<Baseline, 'keys' | 'enums'> | null) {
  const details: ProbeResult['details'] = []
  if (!obs.records) return { status: 'empty', details }
  for (const f of spec?.required || []) {
    const share = (obs.presence[f] || 0) / obs.records
    if (share < REQUIRED_MIN_SHARE) details.push({ level: 'drift', msg: `required key "${f}" is in ${Math.round(share * 100)}% of the sampled records` })
  }
  for (const [f, allowed] of Object.entries(spec?.enums || {})) {
    const unknown = (obs.enums[f] || []).filter((v) => !allowed.includes(v))
    if (unknown.length) details.push({ level: 'drift', msg: `new ${f} value${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}` })
  }
  for (const [f, t] of Object.entries(spec?.types || {})) {
    const seen = (obs.types[f] || []).filter((x) => x !== 'null' && x !== 'undefined')
    const bad = seen.filter((x) => x !== t)
    if (bad.length) details.push({ level: 'drift', msg: `${f} is ${bad.join('/')}, expected ${t}` })
  }
  if (baseline) {
    const known = new Set(baseline.keys || [])
    const added = obs.keys.filter((k) => !known.has(k))
    if (added.length)
      details.push({ level: 'changed', msg: `new key${added.length > 1 ? 's' : ''}: ${added.slice(0, 8).join(', ')}${added.length > 8 ? ' …' : ''}` })
    for (const [f, vals] of Object.entries(obs.enums)) {
      const base = new Set(baseline.enums?.[f] || [])
      const allowed = new Set(spec?.enums?.[f] || [])
      const fresh = vals.filter((v) => !base.has(v) && allowed.has(v))
      if (fresh.length) details.push({ level: 'changed', msg: `first sighting of ${f} = ${fresh.join(', ')}` })
    }
  }
  const status = details.some((d) => d.level === 'drift') ? 'drift' : details.length ? 'changed' : baseline ? 'ok' : 'baseline'
  return { status, details }
}
