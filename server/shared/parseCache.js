import fs from 'node:fs'

// Fingerprint-keyed caches for parsed session transcripts.
//
// Every entry is validated per request against the file's current fingerprint
// (mtime + size + inode; a stat is metadata-only and costs microseconds, vs
// re-reading + re-JSON.parsing the whole transcript). Session .jsonl files are
// append-only — any real change grows the file — so a matching fingerprint
// proves the cached value is current. No TTLs, no trust-the-cache windows:
// freshness is byte-for-byte equivalent to parsing on every request.
//
// Ordering contract (avoids a stat/read TOCTOU): callers that also emit an
// ETag must stat exactly ONCE per request — via fingerprintOf() — BEFORE any
// content is read, and thread that same fingerprint through every cache lookup
// and into the etag. If the file grows between the stat and the read, the
// fingerprint is merely OLDER than the body: the next revalidation stat
// mismatches and re-parses (safe). Statting AFTER reading could bind a NEWER
// fingerprint to an OLD body, which a client would then cache forever behind
// 304s — the dangerous direction.
//
// Mutability contract: cached values are shared object references handed to
// every request. Callers MUST treat them as immutable — shallow-copy before
// attaching per-request fields (see the `{ ...sessionSummary(...) }` spreads
// in the provider api.js files).

// On-disk size understates the heap footprint of the parsed form: JS objects
// carry property maps, string headers, array slack etc., typically ~2-4x the
// JSON text. Charge a conservative 3x so the budgets bound real memory.
const HEAP_FACTOR = 3
// Budget for each cache (records and derived), in charged (already x3) bytes,
// i.e. ~21 MiB of on-disk transcript each. Env-overridable for tests/ops.
const MAX_CACHE_BYTES = Number(process.env.AGENTDECK_PARSE_CACHE_BYTES) > 0
  ? Number(process.env.AGENTDECK_PARSE_CACHE_BYTES)
  : 64 * 1024 * 1024

// Parsed-records cache. Bounded LRU (Map iteration order is insertion order;
// re-inserting on hit makes the first entry the least recently used).
const records = new Map() // path -> { fp, cost, value }
let recordBytes = 0

// Derived-value cache (summaries, timelines). Timelines are the same order of
// magnitude as the raw transcript, so this is size-accounted LRU exactly like
// `records`, charging each entry by its source file's size. (Summaries are far
// smaller; overcharging them just lowers effective capacity a little.)
const derived = new Map() // `${kind}\n${path}` -> { fp, cost, value }
let derivedBytes = 0

/**
 * Stat `file` exactly once and return its fingerprint. Call this BEFORE any
 * content read and pass the result to cachedRecords/cachedDerived/etagOf so
 * one request sees a single consistent snapshot (see ordering contract above).
 * `ino` disambiguates same-mtime/size replacements; it is 0 on some Windows /
 * network filesystems, where mtime+size alone carry the fingerprint.
 */
export function fingerprintOf(file) {
  const st = fs.statSync(file)
  return { key: `${st.mtimeMs}:${st.size}:${st.ino || 0}`, size: st.size, mtimeMs: st.mtimeMs }
}

/** Quote a fingerprint (+ optional payload-affecting extra) as an ETag value. */
export function etagOf(fp, extra = '') {
  return `"${fp.key}${extra ? `:${extra}` : ''}"`
}

function dropDerivedFor(file) {
  const suffix = `\n${file}`
  for (const [key, ent] of derived) {
    if (key.endsWith(suffix)) {
      derivedBytes -= ent.cost
      derived.delete(key)
    }
  }
}

/**
 * Parsed records for `file`, re-parsing (via `parse`) only when it changed.
 * Pass a pre-taken `fp` (from fingerprintOf) when the caller also uses the
 * fingerprint elsewhere in the same request; omitted, one is taken here —
 * still before the read.
 */
export function cachedRecords(file, parse, fp = fingerprintOf(file)) {
  const hit = records.get(file)
  if (hit && hit.fp === fp.key) {
    records.delete(file) // LRU bump
    records.set(file, hit)
    return hit.value
  }
  const value = parse(file)
  if (hit) recordBytes -= hit.cost
  const cost = fp.size * HEAP_FACTOR
  records.set(file, { fp: fp.key, cost, value })
  recordBytes += cost
  while (recordBytes > MAX_CACHE_BYTES && records.size > 1) {
    const [oldPath, old] = records.entries().next().value
    records.delete(oldPath)
    recordBytes -= old.cost
    // derived values are recomputed from records; keep their lifetimes coupled
    dropDerivedFor(oldPath)
  }
  return value
}

/**
 * A value computed from `file` (summary, timeline, ...), keyed by kind.
 * Same fingerprint-threading rules as cachedRecords.
 */
export function cachedDerived(file, kind, compute, fp = fingerprintOf(file)) {
  const key = `${kind}\n${file}`
  const hit = derived.get(key)
  if (hit && hit.fp === fp.key) {
    derived.delete(key) // LRU bump
    derived.set(key, hit)
    return hit.value
  }
  const value = compute()
  if (hit) derivedBytes -= hit.cost
  const cost = fp.size * HEAP_FACTOR
  derived.set(key, { fp: fp.key, cost, value })
  derivedBytes += cost
  while (derivedBytes > MAX_CACHE_BYTES && derived.size > 1) {
    const [oldKey, old] = derived.entries().next().value
    derived.delete(oldKey)
    derivedBytes -= old.cost
  }
  return value
}

/** Drop everything cached for `file` (call on unlink). */
export function invalidate(file) {
  const hit = records.get(file)
  if (hit) {
    recordBytes -= hit.cost
    records.delete(file)
  }
  dropDerivedFor(file)
}
