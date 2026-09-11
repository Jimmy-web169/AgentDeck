import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateFixture } from '../../scripts/demo/make-fixture.ts'
import assert from 'node:assert/strict'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { TestContext } from 'node:test'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
let contracts: Ajv2020 | undefined

export function assertContract(name: string, value: unknown) {
  if (!contracts) {
    const registry = new Ajv2020({ allErrors: true, strict: false })
    for (const file of fs.readdirSync(path.join(ROOT, 'spec/api')).filter((file) => file.endsWith('.schema.json'))) {
      registry.addSchema(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/api', file), 'utf8')))
    }
    contracts = registry
  }
  const ajv = contracts
  const validate = ajv.getSchema(`${name}.schema.json`)
  assert.ok(validate, `Missing ${name} contract`)
  assert.ok(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`)
}

// WP-7 boundary: tests depend on this instead of demo-generator internals.
export const makeFixture = (
  options: { out?: string; scenario?: string; seed?: number; now?: number | string; platform?: string; force?: boolean } | undefined
) => generateFixture(options)

export function specFixture(t: TestContext) {
  const staging = path.join(ROOT, 'tmp')
  fs.mkdirSync(staging, { recursive: true })
  const dir = fs.mkdtempSync(path.join(staging, 'http-spec-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const cases = {
    claude: {
      id: '00fb8673-8b42-4835-a84f-3e32248c1e89',
      input: 'session-00fb8673.jsonl',
      relative: 'projects/C--home-demo-code-orbit-api/00fb8673-8b42-4835-a84f-3e32248c1e89.jsonl',
    },
    codex: {
      id: '3d5465c2-6ffd-76db-9962-51657f9592e0',
      input: 'session-3d5465c2.jsonl',
      relative: 'sessions/2026/09/01/rollout-2026-09-01T06-20-00-3d5465c2-6ffd-76db-9962-51657f9592e0.jsonl',
    },
    antigravity: {
      id: '7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f',
      input: 'session-7d1c4e2a.jsonl',
      relative: 'brain/7d1c4e2a-9b3f-4c5d-8e6f-0a1b2c3d4e5f/.system_generated/logs/transcript_full.jsonl',
    },
  }
  for (const [provider, entry] of Object.entries(cases)) {
    const home = path.join(dir, provider)
    const target = path.join(home, entry.relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(ROOT, 'spec/fixtures', provider, entry.input), target)
    fs.writeFileSync(path.join(dir, `roots.${provider}.json`), JSON.stringify([{ id: provider, dir: home, label: 'Spec fixture' }]))
  }
  return { dir, cases }
}

// Required fields emitted by the generated native fixture, checked by the
// provider contract assertions (UI summaries also accept partial totals).
export interface FixtureStatsTotals {
  sessions: number
  subagentSessions: number
  userTurns: number
  toolCalls: number
  tokens: Record<string, number>
}
export interface FixtureStats extends FixtureStatsTotals {
  projects: (FixtureStatsTotals & { slug: string; cwd: string | null })[]
  fields: { common: string[]; specific: string[] }
}
