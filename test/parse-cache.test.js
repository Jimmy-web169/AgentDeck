import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Shrink the LRU budgets so eviction is testable with tiny files. Must be set
// before the module is imported (the budget is read at import time).
process.env.AGENTDECK_PARSE_CACHE_BYTES = String(300) // 100 on-disk bytes at HEAP_FACTOR 3

const { cachedRecords, cachedDerived, fingerprintOf, etagOf, invalidate } = await import('../server/shared/parseCache.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-cache-'))
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

let seq = 0
function makeFile(bytes) {
  const f = path.join(dir, `f${seq++}.jsonl`)
  fs.writeFileSync(f, 'x'.repeat(bytes))
  return f
}
const countingParse = (counter) => (file) => {
  counter.n++
  return [fs.readFileSync(file, 'utf8')]
}

test('cachedRecords: parses once, revalidates by fingerprint, re-parses on change', () => {
  const f = makeFile(10)
  const c = { n: 0 }
  const v1 = cachedRecords(f, countingParse(c))
  const v2 = cachedRecords(f, countingParse(c))
  assert.equal(c.n, 1)
  assert.equal(v1, v2) // same shared reference on a hit
  fs.appendFileSync(f, 'more')
  cachedRecords(f, countingParse(c))
  assert.equal(c.n, 2)
})

test('stat-before-read: a stale fingerprint never masks newer content', () => {
  const f = makeFile(10)
  const c = { n: 0 }
  const fp0 = fingerprintOf(f) // stat at t0
  fs.appendFileSync(f, 'appended-after-stat') // file grows between stat and read
  const v = cachedRecords(f, countingParse(c), fp0) // read sees NEW content, stored under OLD fp
  assert.ok(v[0].includes('appended-after-stat'))
  // next request stats fresh -> fp mismatch -> re-parse (self-heals; the etag
  // built from fp0 was older than the body, never newer)
  const fp1 = fingerprintOf(f)
  assert.notEqual(fp0.key, fp1.key)
  cachedRecords(f, countingParse(c), fp1)
  assert.equal(c.n, 2)
})

test('etagOf quotes the fingerprint and appends extras', () => {
  const f = makeFile(5)
  const fp = fingerprintOf(f)
  assert.equal(etagOf(fp), `"${fp.key}"`)
  assert.equal(etagOf(fp, 'S'), `"${fp.key}:S"`)
})

test('records LRU: evicts oldest when over budget, and drops its derived values', () => {
  const c = { n: 0 }
  const a = makeFile(60) // 180 charged
  const b = makeFile(60) // 180 charged -> a must go (budget 300)
  cachedRecords(a, countingParse(c))
  cachedDerived(a, 'summary', () => 'sum-a')
  let computes = 0
  cachedRecords(b, countingParse(c))
  cachedDerived(a, 'summary', () => {
    computes++
    return 'sum-a2'
  })
  assert.equal(computes, 1) // a's derived entry was evicted along with its records
  cachedRecords(a, countingParse(c))
  assert.equal(c.n, 3) // a was re-parsed after eviction
})

test('derived cache: fingerprint-validated and size-bounded', () => {
  const f = makeFile(10)
  let computes = 0
  const v1 = cachedDerived(f, 'timeline', () => ({ n: ++computes }))
  const v2 = cachedDerived(f, 'timeline', () => ({ n: ++computes }))
  assert.equal(computes, 1)
  assert.equal(v1, v2)
  fs.appendFileSync(f, 'grow')
  cachedDerived(f, 'timeline', () => ({ n: ++computes }))
  assert.equal(computes, 2)
  // overflow the derived budget with big siblings -> f's entry is evicted
  cachedDerived(makeFile(60), 'timeline', () => 'big1')
  cachedDerived(makeFile(60), 'timeline', () => 'big2')
  cachedDerived(f, 'timeline', () => ({ n: ++computes }))
  assert.equal(computes, 3)
})

test('invalidate drops records and every derived kind for the file', () => {
  const f = makeFile(10)
  const c = { n: 0 }
  let computes = 0
  cachedRecords(f, countingParse(c))
  cachedDerived(f, 'summary', () => ++computes)
  cachedDerived(f, 'timeline', () => ++computes)
  invalidate(f)
  cachedRecords(f, countingParse(c))
  cachedDerived(f, 'summary', () => ++computes)
  cachedDerived(f, 'timeline', () => ++computes)
  assert.equal(c.n, 2)
  assert.equal(computes, 4)
})
