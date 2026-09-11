import { sourceKey } from '../../shared/identity.ts'
import fs from 'node:fs'
import path from 'node:path'
import { jsonRecord } from './json.ts'
import { observe, compare, fingerprint, type ProbeSpec, type StoredProbe, type ProbeResult } from './probeShape.ts'
export { observe, compare, fingerprint, valuesAt } from './probeShape.ts'
import type { Root } from '../../shared/types.d.ts'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { stateFile } from './state.ts'

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

const specCache = new Map<string, ProbeSpec | null>()
export function loadProbeSpec(providerId: string): ProbeSpec | null {
  if (specCache.has(providerId)) return specCache.get(providerId) ?? null
  let spec: ProbeSpec | null = null
  try {
    const doc = yaml.load(fs.readFileSync(path.join(SPEC_DIR, `${providerId}.yaml`), 'utf8'))
    spec = (jsonRecord(doc).probe as ProbeSpec | undefined) || null
  } catch {}
  specCache.set(providerId, spec)
  return spec
}

// ---- glob → files (segments: literal, `*` with optional prefix/suffix, `**`) ----
const segRe = (seg: string) =>
  new RegExp(
    '^' +
      seg
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/\\\\]*') +
      '$'
  )
export function expandGlob(rootDir: string, glob: string) {
  const segs = String(glob || '')
    .split('/')
    .filter(Boolean)
  let frontier = [rootDir]
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const last = i === segs.length - 1
    const next = []
    for (const dir of frontier) {
      let entries: fs.Dirent[]
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
          if (d === undefined) break
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
    .filter((entry) => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// ---- sampling: head + tail lines of each file, parsed as JSONL ----
export function sampleRecords(files: { file: string; size: number }[], { head = 200, tail = 200, maxBytes = 8 * 1024 * 1024 } = {}) {
  const out: unknown[] = []
  for (const f of files) {
    let text: string
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
        const r: unknown = JSON.parse(l)
        if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r)
      } catch {}
    }
  }
  return out
}

// ---- store + runner ----------------------------------------------------------------------
const storePath = (id: string) => stateFile('probe', id)
const readStore = (id: string): Record<string, StoredProbe> => {
  try {
    return JSON.parse(fs.readFileSync(storePath(id), 'utf8')) || {}
  } catch {
    return {}
  }
}
const writeStore = (id: string, store: Record<string, StoredProbe>) => {
  try {
    const file = storePath(id)
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, JSON.stringify(store, null, 2))
  } catch {}
}
const last = new Map<string, ProbeResult>() // `${id}|${rootId}` -> result

// Probe one root of one provider; persists the baseline on first sight and the
// latest observation always (for "accept"). Returns { status, details, at, … }.
export function runProbe(providerId: string, root: Root) {
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
  if (!baseline && obs.records)
    entry.baseline = { keys: obs.keys, enums: obs.enums, types: obs.types, fingerprint: result.fingerprint, at: now, versions: obs.versions }
  entry.last = { ...result, keys: obs.keys, enums: obs.enums, types: obs.types }
  store[root.id] = entry
  writeStore(providerId, store)
  last.set(sourceKey(providerId, root.id), result)
  return result
}

// what GET /api/roots attaches to each root: the latest result, or the stored one after a restart
export function probeStatus(providerId: string, rootId: string) {
  const k = sourceKey(providerId, rootId)
  if (last.has(k)) return last.get(k)
  const e = readStore(providerId)[rootId]
  if (!e?.last) return null
  const { keys, enums, types, ...rest } = e.last
  last.set(k, rest)
  return rest
}

// "accept": the latest observation becomes the baseline (the drift was a real format change we now understand)
export function acceptProbe(providerId: string, root: Root) {
  const store = readStore(providerId)
  const e = store[root.id]
  if (!e?.last) return runProbe(providerId, root)
  e.baseline = {
    keys: e.last.keys,
    enums: e.last.enums,
    types: e.last.types,
    fingerprint: e.last.fingerprint,
    at: new Date().toISOString(),
    versions: e.last.versions,
  }
  store[root.id] = e
  writeStore(providerId, store)
  return runProbe(providerId, root)
}

// every root of every provider, once
interface ProbeProvider {
  id: string
  loadRoots(): Root[]
}
export function runAllProbes(providers: Record<string, ProbeProvider>, log = console) {
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
        log.warn(`[probe] ${p.id} ${root.dir}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }
}

// startup + hourly, for every provider's roots; returns a stop function
export function scheduleProbes(providers: Record<string, ProbeProvider>, { intervalMs = 60 * 60 * 1000, initialDelayMs = 3000, log = console } = {}) {
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
