import fs from 'node:fs'

// Fingerprint-keyed caches for parsed session transcripts.
//
// Every entry is validated per request against the file's current
// `${mtimeMs}:${size}` (a stat is metadata-only and costs microseconds, vs
// re-reading + re-JSON.parsing the whole transcript). Session .jsonl files are
// append-only — any real change grows the file — so a matching fingerprint
// proves the cached value is current. No TTLs, no trust-the-cache windows:
// freshness is byte-for-byte equivalent to parsing on every request.

// Parsed-records cache: the big one. Bounded LRU, using each file's on-disk
// size as a cheap proxy for the parsed array's memory footprint.
const MAX_RECORD_BYTES = 64 * 1024 * 1024
const records = new Map() // path -> { fp, size, value }
let recordBytes = 0

// Derived-value caches (session summaries etc.): a few hundred bytes per
// entry, so no LRU — entries die with invalidate() when their file is removed.
const derived = new Map() // `${kind}\n${path}` -> { fp, value }

function fingerprint(file) {
  const st = fs.statSync(file)
  return `${st.mtimeMs}:${st.size}`
}

/** Parsed records for `file`, re-parsing (via `parse`) only when it changed. */
export function cachedRecords(file, parse) {
  const st = fs.statSync(file)
  const fp = `${st.mtimeMs}:${st.size}`
  const hit = records.get(file)
  if (hit && hit.fp === fp) {
    records.delete(file) // LRU bump: Map iteration order is insertion order
    records.set(file, hit)
    return hit.value
  }
  const value = parse(file)
  if (hit) recordBytes -= hit.size
  records.set(file, { fp, size: st.size, value })
  recordBytes += st.size
  while (recordBytes > MAX_RECORD_BYTES && records.size > 1) {
    const [oldPath, old] = records.entries().next().value
    records.delete(oldPath)
    recordBytes -= old.size
  }
  return value
}

/** A small value computed from `file` (e.g. its summary), keyed by kind. */
export function cachedDerived(file, kind, compute) {
  const fp = fingerprint(file)
  const key = `${kind}\n${file}`
  const hit = derived.get(key)
  if (hit && hit.fp === fp) return hit.value
  const value = compute()
  derived.set(key, { fp, value })
  return value
}

/** Drop everything cached for `file` (call on unlink). */
export function invalidate(file) {
  const hit = records.get(file)
  if (hit) {
    recordBytes -= hit.size
    records.delete(file)
  }
  for (const key of derived.keys()) {
    if (key.endsWith(`\n${file}`)) derived.delete(key)
  }
}
