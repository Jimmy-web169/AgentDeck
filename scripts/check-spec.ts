#!/usr/bin/env node
import type { SessionSummary, TimelineEvent } from '../shared/types.d.ts'
interface Descriptor {
  id: string
  status?: string
  timeline?: { map?: { kind?: string }[]; parts?: Record<string, unknown> }
  tokens?: Record<string, unknown>
}
interface ParsedFixture {
  summary: SessionSummary
  timeline: TimelineEvent[]
}
interface Parser {
  readRecords(file: string): unknown[]
  summarize(records: unknown[], id: string): SessionSummary
  buildTimeline(records: unknown[]): TimelineEvent[]
}
// check-spec.mjs — the conformance gate of the provider protocol layer (spec/).
//
// A descriptor is only worth something if the code agrees with it. This runs
// three checks and exits 1 on any failure:
//   1. every spec/providers/<id>.yaml validates against spec/provider.schema.json
//   2. every fixture session in spec/fixtures/<id>/ parses through that provider's
//      real parser (readRecords → buildTimeline + summarize) to exactly the
//      committed golden output in spec/fixtures/<id>/expected/<session>.json
//      (--update rewrites the goldens after an intended parser change)
//   3. the descriptor's vocabulary covers what the parser produced: timeline
//      kinds, part kinds and token fields — so a parser that starts emitting
//      something the descriptor does not describe fails here, and vice versa
//
// Fixtures are fictional (made by scripts/demo/make-fixture.ts, or hand-written
// from real record shapes for Antigravity); a provider without a fixture only
// gets check 1.
//
//   node scripts/check-spec.ts [--update] [--only claude,codex]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import yaml from 'js-yaml'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC = path.join(REPO, 'spec')
const argv = process.argv.slice(2)
const UPDATE = argv.includes('--update')
const onlyArg = argv[argv.indexOf('--only') + 1]
const ONLY = argv.includes('--only') && onlyArg ? onlyArg.split(',') : null

const read = (p: fs.PathOrFileDescriptor) => fs.readFileSync(p, 'utf8')
const rel = (p: string) => path.relative(REPO, p).replace(/\\/g, '/')
let failures = 0
const ok = (msg: string) => console.log(`  ✓ ${msg}`)
const bad = (msg: string) => {
  failures++
  console.log(`  ✗ ${msg}`)
}

// ---- 1. descriptors validate ---------------------------------------------------------

const schema = JSON.parse(read(path.join(SPEC, 'provider.schema.json')))
const ajv = new Ajv2020({ allErrors: true, strict: false })
const contracts: Record<string, string> = {}
for (const name of fs
  .readdirSync(path.join(SPEC, 'api'))
  .filter((name) => name.endsWith('.schema.json'))
  .sort()) {
  const contract = JSON.parse(read(path.join(SPEC, 'api', name)))
  ajv.addSchema(contract)
  contracts[contract.title] = contract.$id
}
const validateContract = (name: string, value: unknown, label: string) => {
  const check = ajv.getSchema(contracts[name])
  if (!check) throw new Error(`Missing contract ${name}`)
  if (!check(value)) bad(`${label}: ${name} contract — ${ajv.errorsText(check.errors)}`)
}
const validate = ajv.compile(schema)
const descriptors: Record<string, Descriptor> = {}
console.log('descriptors')
for (const f of fs
  .readdirSync(path.join(SPEC, 'providers'))
  .filter((x) => x.endsWith('.yaml'))
  .sort()) {
  const id = f.replace(/\.yaml$/, '')
  if (ONLY && !ONLY.includes(id)) continue
  const doc = yaml.load(read(path.join(SPEC, 'providers', f))) as Descriptor
  descriptors[id] = doc
  if (validate(doc)) ok(`spec/providers/${f} valid (${doc.status || 'no status'})`)
  else
    bad(
      `spec/providers/${f}: ${(validate.errors || [])
        .map((e) => `${e.instancePath || '/'} ${e instanceof Error ? e.message : String(e)}`)
        .slice(0, 5)
        .join('; ')}`
    )
  if (doc.id !== id) bad(`spec/providers/${f}: id "${doc.id}" does not match the file name`)
}

// ---- 2 + 3. fixtures parse to the goldens and fit the descriptor's vocabulary ------------

// the goldens never carry file-system facts (mtime, paths) — the parser output is
// compared on content only, so a checkout on another machine gives the same result
const VOLATILE = new Set(['mtime', 'mtimeMs', 'file', 'path'])
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !VOLATILE.has(k))
        .map(([k, x]) => [k, strip(x)])
    )
  return v
}
function diffPaths(a: unknown, b: unknown, p = '', out: string[] = []): string[] {
  if (out.length >= 8) return out
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${p || '/'}: length ${a.length} → ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffPaths(a[i], b[i], `${p}[${i}]`, out)
    return out
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${p}.${k}: missing in expected`)
      else if (!(k in b)) out.push(`${p}.${k}: missing in actual`)
      else diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${p}.${k}`, out)
      if (out.length >= 8) break
    }
    return out
  }
  if (a !== b) out.push(`${p || '/'}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
  return out
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

for (const id of Object.keys(descriptors)) {
  const dir = path.join(SPEC, 'fixtures', id)
  const manifest = path.join(dir, 'fixture.json')
  if (!fs.existsSync(manifest)) {
    console.log(`fixtures/${id}: none (descriptor validated only)`)
    continue
  }
  console.log(`fixtures/${id}`)
  const fx = JSON.parse(read(manifest))
  let parser: Parser
  try {
    parser = await import(pathToFileURL(path.join(REPO, 'server', 'providers', id, 'parser.ts')).href)
  } catch (e) {
    bad(`server/providers/${id}/parser.ts could not be imported: ${e instanceof Error ? e.message : String(e)}`)
    continue
  }
  const desc = descriptors[id]
  const declaredKinds = new Set((desc.timeline?.map || []).map((r) => r.kind).filter(Boolean))
  const declaredParts = new Set(Object.keys(desc.timeline?.parts || {}))
  const tokenFields = Object.entries(desc.tokens || {}).filter(([k, v]) => k !== 'source' && k !== 'total' && v != null)

  for (const s of fx.sessions) {
    const file = path.join(dir, s.file)
    const records = parser.readRecords(file)
    const actual = strip({ summary: parser.summarize(records, s.id), timeline: parser.buildTimeline(records) }) as ParsedFixture
    const goldenPath = path.join(dir, 'expected', `${s.id}.json`)
    if (UPDATE || !fs.existsSync(goldenPath)) {
      fs.mkdirSync(path.dirname(goldenPath), { recursive: true })
      fs.writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`)
      ok(`${s.file}: golden ${UPDATE ? 'updated' : 'created'} → ${rel(goldenPath)}`)
    } else {
      const expected = JSON.parse(read(goldenPath))
      const diff = diffPaths(expected, actual)
      if (!diff.length) ok(`${s.file}: parser output matches ${rel(goldenPath)} (${actual.timeline.length} events)`)
      else
        bad(
          `${s.file}: parser output differs from the golden — ${diff.join(' | ')}${diff.length >= 8 ? ' …' : ''}  (run with --update if the change is intended)`
        )
    }
    validateContract('SessionSummary', actual.summary, s.file)
    actual.timeline.forEach((event, index) => {
      validateContract('TimelineEvent', event, `${s.file} timeline[${index}]`)
    })
    const golden: ParsedFixture = JSON.parse(read(goldenPath))
    validateContract('SessionSummary', golden.summary, `${s.file} golden`)
    golden.timeline.forEach((event, index) => {
      validateContract('TimelineEvent', event, `${s.file} golden timeline[${index}]`)
    })
    // vocabulary: what the parser produced must be described by the descriptor
    const kindsSeen = new Set(actual.timeline.map((e) => e.kind))
    const partsSeen = new Set(actual.timeline.flatMap((e) => (e.parts || []).map((p) => p.kind)))
    const kindMiss = [...kindsSeen].filter((k) => !declaredKinds.has(k))
    const partMiss = [...partsSeen].filter((k) => !declaredParts.has(k))
    if (kindMiss.length) bad(`${s.file}: timeline kinds not in the descriptor's timeline.map: ${kindMiss.join(', ')}`)
    if (partMiss.length) bad(`${s.file}: part kinds not in the descriptor's timeline.parts: ${partMiss.join(', ')}`)
    const tokMiss = tokenFields.filter(([k]) => typeof actual.summary.tokens?.[camel(k)] !== 'number')
    if (tokMiss.length)
      bad(`${s.file}: descriptor tokens.${tokMiss.map(([k]) => k).join('/')} have no numeric summary.tokens.${tokMiss.map(([k]) => camel(k)).join('/')}`)
    if (!kindMiss.length && !partMiss.length && !tokMiss.length)
      ok(
        `${s.file}: vocabulary — kinds {${[...kindsSeen].join(', ')}}, parts {${[...partsSeen].join(', ')}}, tokens ${tokenFields.map(([k]) => k).join('/')} all described`
      )
  }
}

console.log(failures ? `\ncheck-spec: FAIL — ${failures} problem(s)` : '\ncheck-spec: ok')
process.exit(failures ? 1 : 0)
