import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { configDir } from './roots.js'

// Format-drift detection (spec/PROVIDER-SPEC.md §5), driven by the `probe:`
// block of each descriptor in spec/providers/<id>.yaml:
//
//   sample:   { glob, newest, head, tail }   which files, how many, how much of each
//   required: [dotted.paths]                 keys every record of this format carries
//   enums:    { field: [values] }            closed vocabularies
//   types:    { field: type }                fields whose type must not change
//   version_field                            where the CLI stamps its version
//
// The newest files of every tracked root are sampled at startup and hourly
// (never on hot reads), the observed shape is fingerprinted and compared with
// the baseline stored in <configDir>/probe.<id>.json. Thresholds, decided
// 2026-09-08 (the "greatest common divisor" rule — warn only on what every
// consumer of the format needs):
//   drift    a required key present in fewer than half the sampled records, an
//            enum value the descriptor does not list, a type that changed
//            → badge on the folder chip; the Folders dialog says what and offers
//            "accept" (make this the new baseline) and "re-check"
//   changed  keys the baseline never saw (a vendor added something optional)
//            → recorded and shown in the Folders dialog only, no badge
//   ok / baseline (first run) / empty (nothing to sample yet)

const SPEC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'spec', 'providers')
const REQUIRED_MIN_SHARE = 0.5
const MAX_KEY_DEPTH = 2

const specCache = new Map()
export function loadProbeSpec(providerId) {
  if (specCache.has(providerId)) return specCache.get(providerId)
  let spec = null
  try {
    const doc = yaml.load(fs.readFileSync(path.join(SPEC_DIR, `${providerId}.yaml`), 'utf8'))
    spec = doc?.probe || null
  } catch {}
  specCache.set(providerId, spec)
  return spec
}

// ---- glob → files (segments: literal, `*` with optional prefix/suffix, `**`) ----
const segRe = (seg) => new RegExp('^' + seg.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/\\\\]*') + '$')
export function expandGlob(rootDir, glob) {
  const segs = String(glob || '').split('/').filter(Boolean)
  let frontier = [rootDir]
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const last = i === segs.length - 1
    const next = []
    for (const dir of frontier) {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      if (seg === '**') {
        // any depth: this dir itself and every subdirectory
        const stack = [dir]
        while (stack.length) {
          const d = stack.pop()
          next.push(d)
          try {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) stack.push(path.join(d, e.name))
          } catch {}
        }
        continue
      }
      const re = seg.includes('*') ? segRe(seg) : null
      for (const e of entries) {
        if (re ? !re.test(e.name) : e.name !== seg) continue
        if (last ? !e.isFile() : !e.isDirectory()) continue
        next.push(path.join(dir, e.name))
      }
    }
    frontier = next
    if (!frontier.length) break
  }
  return frontier
    .map((file) => {
      try {
        const st = fs.statSync(file)
        return st.isFile() ? { file, mtimeMs: st.mtimeMs, size: st.size } : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// ---- sampling: head + tail lines of each file, parsed as JSONL ----
export function sampleRecords(files, { head = 200, tail = 200, maxBytes = 8 * 1024 * 1024 } = {}) {
  const out = []
  for (const f of files) {
    let text
    try {
      if (f.size > maxBytes) {
        // big file: read the first and last maxBytes/2 only
        const fd = fs.openSync(f.file, 'r')
        try {
          const half = Math.floor(maxBytes / 2)
          const a = Buffer.alloc(half)
          const b = Buffer.alloc(half)
          fs.readSync(fd, a, 0, half, 0)
          fs.readSync(fd, b, 0, half, f.size - half)
          text = a.toString('utf8') + '\n' + b.toString('utf8')
        } finally {
          fs.closeSync(fd)
        }
      } else text = fs.readFileSync(f.file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n').filter((l) => l.trim())
    const pick = lines.length <= head + tail ? lines : [...lines.slice(0, head), ...lines.slice(-tail)]
    for (const l of pick) {
      try {
        const r = JSON.parse(l)
        if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r)
      } catch {}
    }
  }
  return out
}

// ---- observing a record set ----
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
// values at a dotted path; `[]` steps into array elements — 'message.content[].type'
export function valuesAt(rec, dotted) {
  let cur = [rec]
  for (const raw of String(dotted).split('.')) {
    const arr = raw.endsWith('[]')
    const key = arr ? raw.slice(0, -2) : raw
    const next = []
    for (const v of cur) {
      if (!v || typeof v !== 'object') continue
      const x = v[key]
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
function collectKeys(rec, prefix, depth, into) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return
  for (const [k, v] of Object.entries(rec)) {
    const p = prefix ? `${prefix}.${k}` : k
    into.add(p)
    if (depth < MAX_KEY_DEPTH && v && typeof v === 'object' && !Array.isArray(v)) collectKeys(v, p, depth + 1, into)
  }
}
export function observe(records, spec) {
  const keys = new Set()
  const enums = {}
  const types = {}
  const presence = {}
  const versions = new Set()
  for (const r of records) {
    collectKeys(r, '', 0, keys)
    for (const f of Object.keys(spec?.enums || {})) for (const v of valuesAt(r, f)) if (typeof v === 'string') (enums[f] ||= new Set()).add(v)
    for (const f of Object.keys(spec?.types || {})) for (const v of valuesAt(r, f)) (types[f] ||= new Set()).add(typeOf(v))
    for (const f of spec?.required || []) if (valuesAt(r, f).length) presence[f] = (presence[f] || 0) + 1
    if (spec?.version_field) for (const v of valuesAt(r, spec.version_field)) if (typeof v === 'string') versions.add(v)
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, [...o[k]].sort()]))
  return { records: records.length, keys: [...keys].sort(), enums: sorted(enums), types: sorted(types), presence, versions: [...versions].sort() }
}
export const fingerprint = (obs) => crypto.createHash('sha1').update(JSON.stringify({ keys: obs.keys, enums: obs.enums, types: obs.types })).digest('hex').slice(0, 16)

// ---- comparing with the descriptor and the stored baseline ----
export function compare(spec, obs, baseline) {
  const details = []
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
    if (added.length) details.push({ level: 'changed', msg: `new key${added.length > 1 ? 's' : ''}: ${added.slice(0, 8).join(', ')}${added.length > 8 ? ' …' : ''}` })
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

// ---- store + runner ----------------------------------------------------------------------
const storePath = (id) => path.join(configDir(), `probe.${id}.json`)
const readStore = (id) => {
  try {
    return JSON.parse(fs.readFileSync(storePath(id), 'utf8')) || {}
  } catch {
    return {}
  }
}
const writeStore = (id, store) => {
  try {
    fs.writeFileSync(storePath(id), JSON.stringify(store, null, 2))
  } catch {}
}
const last = new Map() // `${id}|${rootId}` -> result

// Probe one root of one provider; persists the baseline on first sight and the
// latest observation always (for "accept"). Returns { status, details, at, … }.
export function runProbe(providerId, root) {
  const spec = loadProbeSpec(providerId)
  if (!spec?.sample?.glob) return null
  const files = expandGlob(root.dir, spec.sample.glob).slice(0, spec.sample.newest || 5)
  const obs = observe(sampleRecords(files, { head: spec.sample.head, tail: spec.sample.tail }), spec)
  const store = readStore(providerId)
  const entry = store[root.id] || {}
  const baseline = entry.baseline || null
  const { status, details } = compare(spec, obs, baseline)
  const now = new Date().toISOString()
  const result = { status, details, at: now, files: files.length, records: obs.records, versions: obs.versions, fingerprint: fingerprint(obs) }
  if (!baseline && obs.records) entry.baseline = { keys: obs.keys, enums: obs.enums, types: obs.types, fingerprint: result.fingerprint, at: now, versions: obs.versions }
  entry.last = { ...result, keys: obs.keys, enums: obs.enums, types: obs.types }
  store[root.id] = entry
  writeStore(providerId, store)
  last.set(`${providerId}|${root.id}`, result)
  return result
}

// what GET /api/roots attaches to each root: the latest result, or the stored one after a restart
export function probeStatus(providerId, rootId) {
  const k = `${providerId}|${rootId}`
  if (last.has(k)) return last.get(k)
  const e = readStore(providerId)[rootId]
  if (!e?.last) return null
  const { keys, enums, types, ...rest } = e.last
  last.set(k, rest)
  return rest
}

// "accept": the latest observation becomes the baseline (the drift was a real format change we now understand)
export function acceptProbe(providerId, root) {
  const store = readStore(providerId)
  const e = store[root.id]
  if (!e?.last) return runProbe(providerId, root)
  e.baseline = { keys: e.last.keys, enums: e.last.enums, types: e.last.types, fingerprint: e.last.fingerprint, at: new Date().toISOString(), versions: e.last.versions }
  store[root.id] = e
  writeStore(providerId, store)
  return runProbe(providerId, root)
}

// every root of every provider, once
export function runAllProbes(providers, log = console) {
    for (const p of Object.values(providers)) {
      let roots = []
      try {
        roots = p.loadRoots()
      } catch {
        continue
      }
      for (const root of roots) {
        try {
          const r = runProbe(p.id, root)
          if (r && r.status === 'drift') log.warn(`[probe] ${p.id} ${root.label || root.dir}: format drift — ${r.details.map((d) => d.msg).join('; ')}`)
          else if (r && r.status === 'changed') log.log(`[probe] ${p.id} ${root.label || root.dir}: ${r.details.map((d) => d.msg).join('; ')}`)
        } catch (e) {
          log.warn(`[probe] ${p.id} ${root.dir}: ${e.message}`)
        }
      }
    }
}

// startup + hourly, for every provider's roots; returns a stop function
export function scheduleProbes(providers, { intervalMs = 60 * 60 * 1000, initialDelayMs = 3000, log = console } = {}) {
  const runAll = () => runAllProbes(providers, log)
  const t0 = setTimeout(runAll, initialDelayMs)
  const t = setInterval(runAll, intervalMs)
  t.unref?.()
  t0.unref?.()
  return () => {
    clearTimeout(t0)
    clearInterval(t)
  }
}
