#!/usr/bin/env node
// make-fixture.mjs — a synthetic, self-contained AgentDeck data root for demos.
//
// Writes BOTH providers' on-disk formats (the shapes AgentDeck's real parsers
// read — see spec/DATA-MODEL.md, server/providers/*/parser.js, paths.js) into one
// directory, plus the two roots.<id>.json files that point at them:
//
//   <out>/
//     roots.claude.json  roots.codex.json  manifest.json
//     claude/   projects/<slug>/<session>.jsonl (+ <session>/subagents/agent-*.jsonl,
//               memory/*.md), history.jsonl, settings.json, CLAUDE.md, skills/
//     codex/    sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl, history.jsonl,
//               config.toml ([mcp_servers.x]), AGENTS.md, skills/
//
// Serve it without touching anyone's real homes:
//   AGENTDECK_CONFIG_DIR=tmp/demo-root AGENTDECK_PORT=47861 node server/index.js
//
// Everything is fictional: projects "orbit-api", "lantern-docs", …, user "demo"
// (C:\Users\demo\code\… on win32, /home/demo/code/… elsewhere), no real people
// or companies. Deterministic for a given --seed and --now.
//
// Usage:
//   node scripts/demo/make-fixture.mjs [--out tmp/demo-root] [--scenario v2-highlights|empty|single-project]
//                                      [--seed 42] [--now 2026-09-07T12:00:00] [--platform win32|posix] [--force]
//
// Importable too: `generateFixture({ out, scenario, seed, now, platform })` → manifest.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { idFor } from '../../server/shared/roots.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const SCENARIOS = ['v2-highlights', 'empty', 'single-project']

// ---- deterministic randomness -----------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
class Rng {
  constructor(seed) {
    this.next = mulberry32(seed)
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1))
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)]
  }
  hex(n) {
    let s = ''
    while (s.length < n) s += Math.floor(this.next() * 16).toString(16)
    return s
  }
  // RFC-4122 layout (version 4 for Claude, 7-style for Codex — only the look differs)
  uuid(version = 4) {
    const h = this.hex(32).split('')
    h[12] = String(version)
    h[16] = '89ab'[Math.floor(this.next() * 4)]
    const s = h.join('')
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
  }
  b64(n) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let s = ''
    for (let i = 0; i < n; i++) s += A[Math.floor(this.next() * 64)]
    return s
  }
}

// ---- fictional world ---------------------------------------------------------

const DEMO_HOME = { win32: 'C:\\Users\\demo', posix: '/home/demo' }
const cwdFor = (platform, name) => (platform === 'win32' ? `${DEMO_HOME.win32}\\code\\${name}` : `${DEMO_HOME.posix}/code/${name}`)
// Claude Code names a project dir after its cwd with every non-alphanumeric char → '-'
export const claudeSlug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-')

const CLAUDE_VERSION = '2.1.40'
const CODEX_VERSION = '0.62.0'
const MODELS = { opus: 'claude-opus-4-1-20250805', sonnet: 'claude-sonnet-4-5-20250929', haiku: 'claude-haiku-4-5-20251001' }
const CODEX_MODEL = 'gpt-5-codex'

// ---- Antigravity (agy) writer -------------------------------------------------------
// One conversation = brain/<id>/.system_generated/logs/transcript_full.jsonl (steps:
// USER_INPUT / PLANNER_RESPONSE / GENERIC results paired by adjacency) plus the
// per-conversation SQLite the provider decodes for workspace, git, model and
// tokens (raw protobuf blobs — see server/providers/antigravity/sqlite.js), an
// annotations/<id>.pbtxt title, history.jsonl and cache/last_conversations.json.

const AGY_VERSION = '1.1.27'
const AGY_MODEL = 'gemini-3.8-flash-high'
const AGY_MODEL_LABEL = 'Gemini 3.8 Flash (High)'
let DatabaseSync = null
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {}
// minimal protobuf wire-format encoder, enough for the three blobs the reader looks at
const pbVarint = (n) => {
  const out = []
  let v = BigInt(n)
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v) b |= 0x80
    out.push(b)
  } while (v)
  return Buffer.from(out)
}
const pbField = (num, wire, payload) => Buffer.concat([pbVarint((num << 3) | wire), payload])
const pbInt = (num, n) => pbField(num, 0, pbVarint(n))
const pbStr = (num, s) => pbField(num, 2, Buffer.concat([pbVarint(Buffer.byteLength(s)), Buffer.from(s)]))
const pbMsg = (num, ...parts) => {
  const body = Buffer.concat(parts)
  return pbField(num, 2, Buffer.concat([pbVarint(body.length), body]))
}
const fileUri = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')

function agyToolCall(step, cwd) {
  if (step.tool === 'shell') return { name: 'run_command', args: { CommandLine: step.cmd, Cwd: cwd, Blocking: true, toolAction: 'Running command', toolSummary: snippet(step.cmd, 40) } }
  const target = `${cwd}${cwd.includes('\\') ? '\\' : '/'}${step.file.replace(/\//g, cwd.includes('\\') ? '\\' : '/')}`
  if (step.add) return { name: 'write_to_file', args: { TargetFile: target, CodeContent: step.patch, EmptyFile: false, toolAction: 'Creating file', toolSummary: `Create ${step.file}` } }
  return { name: 'replace_file_content', args: { TargetFile: target, ReplacementChunks: [{ AllowMultiple: false, TargetContent: '…', ReplacementContent: step.patch }], toolAction: 'Editing file', toolSummary: `Edit ${step.file}` } }
}
const agyToolResult = (step) => (step.tool === 'shell' ? step.out : step.add ? `Created ${step.file}.` : `Updated ${step.file}: 1 chunk replaced.`)

function agySession(rng, ctx, entry, sid, startMs) {
  const { cwd, tasks } = ctx
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const recs = []
  const history = []
  const usage = [] // one steps.metadata row per PLANNER_RESPONSE
  const tokens = { input: 0, output: 0, cacheRead: 0, reasoning: 0 }
  let step = 0
  const push = (ms, source, type, rest) => recs.push({ step_index: step++, source, type, status: 'DONE', created_at: iso(ms), ...rest })
  const planner = (ms, rest) => {
    push(ms, 'MODEL', 'PLANNER_RESPONSE', rest)
    const u = { input: rng.int(6000, 14000), output: rng.int(150, 700), cacheRead: 0, reasoning: rng.int(40, 300) }
    u.cacheRead = Math.round(u.input * (0.5 + rng.next() * 0.35))
    usage.push(u)
    for (const k of Object.keys(tokens)) tokens[k] += u[k]
  }
  const result = (ms, content) => `Created At: ${iso(ms)}\nCompleted At: ${iso(ms)}\n${content}`
  const wrapUser = (prompt, ms, first) =>
    `<USER_REQUEST>\n${prompt}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ${iso(ms)}.\n</ADDITIONAL_METADATA>` +
    (first ? `\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to ${AGY_MODEL_LABEL}. No need to comment on this change if the user doesn't ask about it. If reporting what model you are, please use a human readable name instead of the exact string.\n</USER_SETTINGS_CHANGE>` : '')
  const totalMs = entry.dur * 60000
  const perTurn = totalMs / entry.turns
  const off = entry.task ?? 0
  let t = startMs
  let title = null
  let toolCalls = 0
  for (let i = 0; i < entry.turns; i++) {
    const turnStart = t
    const task = i < tasks.length ? tasks[(off + i) % tasks.length] : FOLLOWUPS_CODEX[(i - tasks.length) % FOLLOWUPS_CODEX.length]
    const prompt = i === 0 || i >= tasks.length ? task.prompt : `${rng.pick(['Next, ', 'Now ', 'Also: '])}${task.prompt[0].toLowerCase()}${task.prompt.slice(1)}`
    if (i === 0) title = task.title || snippet(prompt)
    push(t, 'USER_EXPLICIT', 'USER_INPUT', { content: wrapUser(prompt, t, i === 0) })
    history.push({ display: prompt, timestamp: iso(t), workspace: cwd })
    t += rng.int(3, 8) * 1000
    // agy emits one PLANNER_RESPONSE per batch of tool calls, each answered by a GENERIC step
    const steps = task.steps || []
    for (let k = 0; k < steps.length; ) {
      const batch = steps.slice(k, k + (k === 0 ? 1 : 2))
      const rest = { tool_calls: batch.map((s) => agyToolCall(s, cwd)) }
      if (k === 0 && task.reasoning) rest.thinking = `**${task.title || 'Planning the change'}**\n\n${task.reasoning}`
      k += batch.length
      planner(t, rest)
      toolCalls += batch.length
      for (const s of batch) {
        t += rng.int(1, 20) * 1000
        push(t, 'MODEL', 'GENERIC', { content: result(t, agyToolResult(s)) })
      }
      t += rng.int(3, 10) * 1000
    }
    planner(t, { content: task.reply })
    t = Math.max(t + rng.int(10, 50) * 1000, turnStart + perTurn)
  }
  const lastTs = new Date(recs[recs.length - 1].created_at).getTime()
  return { recs, history, lastTs, title, usage, tokens, toolCalls }
}

// conversations/<id>.db — the blobs server/providers/antigravity/sqlite.js decodes
function agyWriteDb(file, { cwd, branch, name, usage }) {
  if (!DatabaseSync) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec('CREATE TABLE trajectory_metadata_blob (data BLOB); CREATE TABLE executor_metadata (id INTEGER, data BLOB); CREATE TABLE steps (step_index INTEGER, metadata BLOB)')
    db.prepare('INSERT INTO trajectory_metadata_blob (data) VALUES (?)').run(pbMsg(1, pbStr(1, fileUri(cwd)), pbMsg(3, pbStr(1, `demo/${name}`), pbStr(2, `https://example.com/demo/${name}.git`)), pbStr(4, branch)))
    db.prepare('INSERT INTO executor_metadata (id, data) VALUES (?, ?)').run(1, pbMsg(10, pbMsg(1, pbInt(1, 1318), pbInt(6, 65536), pbMsg(3, pbStr(28, AGY_MODEL)))))
    const ins = db.prepare('INSERT INTO steps (step_index, metadata) VALUES (?, ?)')
    usage.forEach((u, i) => ins.run(i, pbMsg(9, pbInt(2, u.input), pbInt(3, u.output), pbInt(5, u.cacheRead), pbInt(9, u.reasoning))))
  } finally {
    db.close()
  }
  return true
}

function agyHomeExtras(home, cwds) {
  writeText(path.join(home, 'settings.json'), JSON.stringify({ version: AGY_VERSION, trustedWorkspaces: cwds, toolPermission: 'request-review', altScreenMode: 'default' }, null, 2) + '\n')
  writeText(path.join(home, 'skills', 'release-notes', 'SKILL.md'), '---\nname: release-notes\ndescription: Draft release notes from the commits since the last tag\n---\n\nRun `git log --oneline <last-tag>..HEAD`, group by type, and write a short paragraph per group.\n')
}


// A "task" is one user turn with the tool steps the agent takes for it.
//   claude step: { tool, input, result }      codex step: { tool: 'shell', cmd, out, exit? } | { tool: 'apply_patch', file, patch, add? }
const P = {
  'orbit-api': {
    branch: 'feat/rate-limit',
    memory: true,
    claude: [
      {
        prompt: 'Add a rate limit to POST /v1/orders — 60 requests per minute per API key, and answer 429 with a Retry-After header.',
        title: 'Rate limit for POST /v1/orders',
        thinking: 'The routes register through a Fastify plugin; a per-key token bucket in the auth plugin is the smallest change. Check how the API key reaches the handler first.',
        steps: [
          { tool: 'Grep', input: { pattern: 'orders', path: 'src/routes', output_mode: 'files_with_matches' }, result: 'src/routes/orders.js\nsrc/routes/index.js\ntest/orders.test.js' },
          { tool: 'Read', input: { file_path: 'src/routes/orders.js' }, result: "     1\timport { createOrder, listOrders } from '../services/orders.js'\n     2\t\n     3\texport default async function ordersRoutes(app) {\n     4\t  app.post('/v1/orders', { preHandler: [app.requireApiKey] }, async (req, reply) => {\n     5\t    const order = await createOrder(req.apiKey.tenantId, req.body)\n     6\t    reply.code(201)\n     7\t    return order\n     8\t  })\n     9\t  app.get('/v1/orders', { preHandler: [app.requireApiKey] }, async (req) => listOrders(req.apiKey.tenantId, req.query))\n    10\t}" },
          { tool: 'Read', input: { file_path: 'src/plugins/auth.js' }, result: "     1\timport fp from 'fastify-plugin'\n     2\t\n     3\texport default fp(async (app) => {\n     4\t  app.decorate('requireApiKey', async (req, reply) => {\n     5\t    const key = req.headers['x-api-key']\n     6\t    const found = key && (await app.db.apiKeys.find(key))\n     7\t    if (!found) return reply.code(401).send({ error: 'invalid api key' })\n     8\t    req.apiKey = found\n     9\t  })\n    10\t})" },
          { tool: 'Edit', input: { file_path: 'src/routes/orders.js', old_string: "  app.post('/v1/orders', { preHandler: [app.requireApiKey] }, async (req, reply) => {", new_string: "  app.post('/v1/orders', { preHandler: [app.requireApiKey, app.rateLimit({ max: 60, windowMs: 60_000, keyOf: (req) => req.apiKey.id })] }, async (req, reply) => {" }, result: 'The file src/routes/orders.js has been updated successfully.' },
          { tool: 'Write', input: { file_path: 'src/plugins/rateLimit.js', content: "import fp from 'fastify-plugin'\n\n// Fixed-window counter per key. Good enough for a per-tenant cap; swap the Map\n// for Redis when the API runs on more than one instance.\nexport default fp(async (app) => {\n  app.decorate('rateLimit', ({ max, windowMs, keyOf }) => {\n    const hits = new Map()\n    return async (req, reply) => {\n      const k = keyOf(req)\n      const now = Date.now()\n      const cur = hits.get(k)\n      if (!cur || cur.reset <= now) hits.set(k, { n: 1, reset: now + windowMs })\n      else if (++cur.n > max) {\n        reply.header('Retry-After', Math.ceil((cur.reset - now) / 1000))\n        return reply.code(429).send({ error: 'rate limit exceeded' })\n      }\n    }\n  })\n})\n" }, result: 'File created successfully at: src/plugins/rateLimit.js' },
          { tool: 'Bash', input: { command: 'npm test -- orders', description: 'Run the orders test file' }, result: '\n> orbit-api@1.8.0 test\n> node --test test/orders.test.js\n\n✔ POST /v1/orders creates an order (41ms)\n✔ POST /v1/orders rejects a missing api key (6ms)\n✔ POST /v1/orders answers 429 after 60 requests (188ms)\n✔ GET /v1/orders lists the tenant\'s orders (12ms)\n\nℹ tests 4\nℹ pass 4\nℹ fail 0' },
        ],
        reply: 'Done. `POST /v1/orders` now runs a per-API-key fixed-window limiter (60/min) registered as `app.rateLimit(...)` in a new `src/plugins/rateLimit.js`; the 61st call in a window gets `429` with `Retry-After` in seconds. All four order tests pass, including a new one for the 429 path.\n\nOne caveat: the counter is in-process. If orbit-api ever runs more than one instance behind the load balancer, the bucket needs to move to Redis — I left a note in the plugin.',
      },
      {
        prompt: 'The webhook retry test is flaky — it fails about one run in five with a timeout. Find out why and fix it properly, not by raising the timeout.',
        title: 'Flaky webhook retry test',
        thinking: 'One-in-five with a timeout smells like real timers racing the test clock. Read the test and the retry scheduler before guessing.',
        steps: [
          { tool: 'Read', input: { file_path: 'test/webhooks.test.js' }, result: "     1\timport test from 'node:test'\n     2\timport assert from 'node:assert/strict'\n     3\timport { deliver } from '../src/webhooks/deliver.js'\n     4\t\n     5\ttest('retries three times with backoff', async () => {\n     6\t  let calls = 0\n     7\t  const fetchStub = async () => { calls++; return { ok: calls === 4 } }\n     8\t  await deliver({ url: 'https://example.com/hook' }, { fetch: fetchStub, backoffMs: 50 })\n     9\t  assert.equal(calls, 4)\n    10\t})" },
          { tool: 'Read', input: { file_path: 'src/webhooks/deliver.js' }, result: "     1\texport async function deliver(hook, { fetch, backoffMs = 1000, attempts = 4 } = {}) {\n     2\t  for (let i = 0; i < attempts; i++) {\n     3\t    const res = await fetch(hook.url, { method: 'POST' })\n     4\t    if (res.ok) return true\n     5\t    await new Promise((r) => setTimeout(r, backoffMs * 2 ** i + Math.random() * backoffMs))\n     6\t  }\n     7\t  return false\n     8\t}" },
          { tool: 'Bash', input: { command: 'for i in 1 2 3 4 5 6; do npm test -- webhooks 2>&1 | grep -E "pass|fail"; done', description: 'Run the webhook test six times' }, result: 'ℹ pass 1\nℹ fail 0\nℹ pass 1\nℹ fail 0\nℹ pass 0\nℹ fail 1\nℹ pass 1\nℹ fail 0\nℹ pass 1\nℹ fail 0\nℹ pass 1\nℹ fail 0' },
          { tool: 'Edit', input: { file_path: 'src/webhooks/deliver.js', old_string: "export async function deliver(hook, { fetch, backoffMs = 1000, attempts = 4 } = {}) {", new_string: "export async function deliver(hook, { fetch, backoffMs = 1000, attempts = 4, jitter = Math.random, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {" }, result: 'The file src/webhooks/deliver.js has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'src/webhooks/deliver.js', old_string: "    await new Promise((r) => setTimeout(r, backoffMs * 2 ** i + Math.random() * backoffMs))", new_string: "    await sleep(backoffMs * 2 ** i + jitter() * backoffMs)" }, result: 'The file src/webhooks/deliver.js has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'test/webhooks.test.js', old_string: "  await deliver({ url: 'https://example.com/hook' }, { fetch: fetchStub, backoffMs: 50 })", new_string: "  const waits = []\n  await deliver({ url: 'https://example.com/hook' }, { fetch: fetchStub, backoffMs: 50, jitter: () => 0, sleep: async (ms) => waits.push(ms) })\n  assert.deepEqual(waits, [50, 100, 200])" }, result: 'The file test/webhooks.test.js has been updated successfully.' },
          { tool: 'Bash', input: { command: 'for i in $(seq 1 20); do npm test -- webhooks 2>&1 | grep -c "fail 0"; done | sort | uniq -c', description: 'Run the webhook test twenty times' }, result: '     20 1' },
        ],
        reply: 'Root cause: the test used real timers. With `backoffMs: 50` the three real waits plus jitter add up to 350–500 ms, and on a loaded CI runner that occasionally crossed the 500 ms default test timeout. The fix is to make `deliver()` take injectable `sleep` and `jitter` functions (production defaults unchanged) so the test records the intended back-off schedule (`[50, 100, 200]`) instead of actually waiting. 20 consecutive runs green.',
      },
      {
        prompt: 'Write a migration that adds an `archived_at` column to orders, and a nightly job that archives orders older than 18 months.',
        title: 'Archive old orders nightly',
        thinking: 'Follow the existing migration numbering and register the job where the other cron jobs live.',
        steps: [
          { tool: 'Glob', input: { pattern: 'migrations/*.sql' }, result: 'migrations/0039_customers_locale.sql\nmigrations/0040_orders_currency.sql\nmigrations/0041_api_keys_last_used.sql' },
          { tool: 'Write', input: { file_path: 'migrations/0042_orders_archived_at.sql', content: 'ALTER TABLE orders ADD COLUMN archived_at timestamptz;\nCREATE INDEX orders_archived_at_idx ON orders (archived_at) WHERE archived_at IS NULL;\n' }, result: 'File created successfully at: migrations/0042_orders_archived_at.sql' },
          { tool: 'Read', input: { file_path: 'src/jobs/index.js' }, result: "     1\timport { schedule } from './cron.js'\n     2\timport { expireApiKeys } from './expireApiKeys.js'\n     3\t\n     4\texport function registerJobs(app) {\n     5\t  schedule('0 3 * * *', () => expireApiKeys(app))\n     6\t}" },
          { tool: 'Write', input: { file_path: 'src/jobs/archiveOrders.js', content: "export async function archiveOrders(app, { months = 18 } = {}) {\n  const { rowCount } = await app.db.query(\n    `UPDATE orders SET archived_at = now() WHERE archived_at IS NULL AND created_at < now() - ($1 || ' months')::interval`,\n    [months]\n  )\n  app.log.info({ archived: rowCount }, 'archived old orders')\n  return rowCount\n}\n" }, result: 'File created successfully at: src/jobs/archiveOrders.js' },
          { tool: 'Edit', input: { file_path: 'src/jobs/index.js', old_string: "  schedule('0 3 * * *', () => expireApiKeys(app))", new_string: "  schedule('0 3 * * *', () => expireApiKeys(app))\n  schedule('30 3 * * *', () => archiveOrders(app))" }, result: 'The file src/jobs/index.js has been updated successfully.' },
          { tool: 'Bash', input: { command: 'npm run migrate:dry', description: 'Dry-run pending migrations' }, result: '> orbit-api@1.8.0 migrate:dry\n> node scripts/migrate.js --dry\n\npending: 0042_orders_archived_at.sql\nALTER TABLE orders ADD COLUMN archived_at timestamptz;\nCREATE INDEX orders_archived_at_idx ON orders (archived_at) WHERE archived_at IS NULL;\n(dry run — nothing applied)' },
        ],
        reply: 'Added `migrations/0042_orders_archived_at.sql` (nullable `archived_at` plus a partial index on the un-archived rows, which is what the nightly `UPDATE` scans) and `src/jobs/archiveOrders.js`, scheduled at 03:30 right after the API-key expiry job. The dry run shows just the one pending migration.',
      },
      {
        prompt: 'Audit the API for endpoints that accept a body without validating it, and fix the two worst offenders.',
        title: 'Input validation audit',
        thinking: 'This is a search problem across every route file — a good job for an Explore sub-agent while I look at the schema helper.',
        steps: [
          { tool: 'Task', input: { description: 'Find unvalidated endpoints', subagent_type: 'Explore', prompt: 'In src/routes/, list every route that reads req.body but has no `schema` option and no explicit validate() call. Report route, file and line.' }, result: 'Routes reading req.body without a schema:\n- POST /v1/customers — src/routes/customers.js:9 (no schema, spreads req.body into the insert)\n- PATCH /v1/customers/:id — src/routes/customers.js:21 (no schema)\n- POST /v1/webhooks — src/routes/webhooks.js:14 (no schema; url is not checked)\n- POST /v1/orders — src/routes/orders.js:4 (validated via createOrder → orderSchema)\n\nWorst: the two customers routes — req.body goes straight into SQL parameters, so unknown columns 500 instead of 400.' },
          { tool: 'Task', input: { description: 'Check validation test coverage', subagent_type: 'Explore', prompt: 'Which route files under test/ assert a 400 for a malformed body? Just list file → routes.' }, result: 'test/orders.test.js → POST /v1/orders (400 on missing items)\ntest/webhooks.test.js → none\ntest/customers.test.js → none (only happy paths)' },
          { tool: 'Read', input: { file_path: 'src/routes/customers.js' }, result: "     1\timport { createCustomer, updateCustomer } from '../services/customers.js'\n     2\t\n     3\texport default async function customersRoutes(app) {\n     4\t  app.post('/v1/customers', { preHandler: [app.requireApiKey] }, async (req, reply) => {\n     5\t    reply.code(201)\n     6\t    return createCustomer(req.apiKey.tenantId, req.body)\n     7\t  })\n     8\t  app.patch('/v1/customers/:id', { preHandler: [app.requireApiKey] }, async (req) => updateCustomer(req.apiKey.tenantId, req.params.id, req.body))\n     9\t}" },
          { tool: 'Edit', input: { file_path: 'src/routes/customers.js', old_string: "export default async function customersRoutes(app) {", new_string: "const customerBody = {\n  type: 'object',\n  additionalProperties: false,\n  required: ['email', 'name'],\n  properties: { email: { type: 'string', format: 'email' }, name: { type: 'string', minLength: 1, maxLength: 200 }, locale: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' } },\n}\nconst customerPatch = { ...customerBody, required: [] }\n\nexport default async function customersRoutes(app) {" }, result: 'The file src/routes/customers.js has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'src/routes/customers.js', old_string: "  app.post('/v1/customers', { preHandler: [app.requireApiKey] }, async (req, reply) => {", new_string: "  app.post('/v1/customers', { preHandler: [app.requireApiKey], schema: { body: customerBody } }, async (req, reply) => {" }, result: 'The file src/routes/customers.js has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'src/routes/customers.js', old_string: "  app.patch('/v1/customers/:id', { preHandler: [app.requireApiKey] }, async (req) =>", new_string: "  app.patch('/v1/customers/:id', { preHandler: [app.requireApiKey], schema: { body: customerPatch } }, async (req) =>" }, result: 'The file src/routes/customers.js has been updated successfully.' },
          { tool: 'Bash', input: { command: 'npm test 2>&1 | tail -4', description: 'Run the whole suite' }, result: 'ℹ tests 31\nℹ pass 31\nℹ fail 0\nℹ duration_ms 2140.8' },
        ],
        reply: 'Two sub-agents did the sweep: four routes read `req.body`, and only `/v1/orders` validates (inside the service). The customers routes were the worst — the body went straight into SQL parameters, so a typo\'d field produced a 500. Both now carry a JSON schema (`additionalProperties: false`, e-mail format, locale pattern); the PATCH variant has no required fields. `POST /v1/webhooks` still lacks a schema for `url` — want me to do that one next?',
      },
      {
        prompt: 'Explain how the idempotency-key middleware works and write it up in docs/idempotency.md.',
        title: 'Document idempotency keys',
        thinking: 'Read the middleware, then write the doc — no code changes.',
        steps: [
          { tool: 'Read', input: { file_path: 'src/middleware/idempotency.js' }, result: "     1\t// Idempotency-Key: the first response for a key is stored for 24h and\n     2\t// replayed for retries with the same key + same request hash; a different\n     3\t// body under the same key is a 422.\n     4\texport function idempotency(store) {\n     5\t  return async (req, reply) => {\n     6\t    const key = req.headers['idempotency-key']\n     7\t    if (!key) return\n     8\t    const hash = sha256(req.rawBody)\n     9\t    const hit = await store.get(`${req.apiKey.id}:${key}`)\n    10\t    if (hit && hit.hash !== hash) return reply.code(422).send({ error: 'idempotency key reused with a different body' })\n    11\t    if (hit) return reply.code(hit.status).headers(hit.headers).send(hit.body)\n    12\t    reply.onSend(async (_req, r, payload) => store.set(`${req.apiKey.id}:${key}`, { hash, status: r.statusCode, headers: r.getHeaders(), body: payload }, 86400))\n    13\t  }\n    14\t}" },
          { tool: 'Write', input: { file_path: 'docs/idempotency.md', content: '# Idempotency keys\n\nSend `Idempotency-Key: <any string up to 255 chars>` on a `POST`. The first\nresponse for that key is stored for 24 hours, scoped to your API key, and\nreplayed for any retry that sends the same key **and the same body**.\n\n| Situation | Result |\n| --- | --- |\n| same key, same body | the stored response (status, headers, body) |\n| same key, different body | `422 idempotency key reused with a different body` |\n| no key | the request is processed normally, nothing is stored |\n\nKeys are per API key — two tenants can use the same value without colliding.\n' }, result: 'File created successfully at: docs/idempotency.md' },
        ],
        reply: 'Written to `docs/idempotency.md`. In short: the middleware keys stored responses on `<apiKeyId>:<Idempotency-Key>`, hashes the raw body to detect a key being reused for a different request (422), and captures the first response in `onSend` with a 24 h TTL. Requests without the header pass straight through.',
      },
    ],
    codex: [
      {
        prompt: 'The webhook retry test is flaky — fails about one run in five with a timeout. Find the cause and fix it.',
        title: 'Fix flaky webhook retry test',
        reasoning: 'Reproduce first to confirm the flake rate, then read the test and the code under test. A timing race between real timers and the runner timeout is the likely culprit.',
        steps: [
          { tool: 'shell', cmd: 'for i in 1 2 3 4 5 6 7 8; do npm test -- webhooks 2>&1 | grep -E "^ℹ (pass|fail)"; done', out: 'ℹ pass 1\nℹ fail 0\nℹ pass 1\nℹ fail 0\nℹ pass 0\nℹ fail 1\nℹ pass 1\nℹ fail 0\nℹ pass 1\nℹ fail 0\nℹ pass 1\nℹ fail 0\nℹ pass 0\nℹ fail 1\nℹ pass 1\nℹ fail 0' },
          { tool: 'shell', cmd: 'cat test/webhooks.test.js src/webhooks/deliver.js', out: "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { deliver } from '../src/webhooks/deliver.js'\n\ntest('retries three times with backoff', async () => {\n  let calls = 0\n  const fetchStub = async () => { calls++; return { ok: calls === 4 } }\n  await deliver({ url: 'https://example.com/hook' }, { fetch: fetchStub, backoffMs: 50 })\n  assert.equal(calls, 4)\n})\nexport async function deliver(hook, { fetch, backoffMs = 1000, attempts = 4 } = {}) {\n  for (let i = 0; i < attempts; i++) {\n    const res = await fetch(hook.url, { method: 'POST' })\n    if (res.ok) return true\n    await new Promise((r) => setTimeout(r, backoffMs * 2 ** i + Math.random() * backoffMs))\n  }\n  return false\n}" },
          { tool: 'apply_patch', file: 'src/webhooks/deliver.js', patch: "*** Begin Patch\n*** Update File: src/webhooks/deliver.js\n@@\n-export async function deliver(hook, { fetch, backoffMs = 1000, attempts = 4 } = {}) {\n+export async function deliver(hook, { fetch, backoffMs = 1000, attempts = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), jitter = Math.random } = {}) {\n   for (let i = 0; i < attempts; i++) {\n     const res = await fetch(hook.url, { method: 'POST' })\n     if (res.ok) return true\n-    await new Promise((r) => setTimeout(r, backoffMs * 2 ** i + Math.random() * backoffMs))\n+    await sleep(backoffMs * 2 ** i + jitter() * backoffMs)\n   }\n   return false\n }\n*** End Patch" },
          { tool: 'apply_patch', file: 'test/webhooks.test.js', patch: "*** Begin Patch\n*** Update File: test/webhooks.test.js\n@@\n-  await deliver({ url: 'https://example.com/hook' }, { fetch: fetchStub, backoffMs: 50 })\n+  const waits = []\n+  await deliver({ url: 'https://example.com/hook' }, { fetch: fetchStub, backoffMs: 50, jitter: () => 0, sleep: async (ms) => waits.push(ms) })\n   assert.equal(calls, 4)\n+  assert.deepEqual(waits, [50, 100, 200])\n*** End Patch" },
          { tool: 'shell', cmd: 'for i in $(seq 1 20); do npm test -- webhooks 2>&1 | grep -c "fail 0"; done | sort | uniq -c', out: '     20 1' },
        ],
        reply: 'The test relied on real timers: three back-off waits plus jitter (350–500 ms at `backoffMs: 50`) occasionally crossed the runner\'s 500 ms timeout. `deliver()` now takes injectable `sleep`/`jitter` (defaults unchanged in production) and the test asserts the schedule `[50, 100, 200]` without waiting. 20/20 runs pass.',
      },
      {
        prompt: 'Add request logging with a correlation id to every route. Reuse an incoming X-Request-Id when present.',
        title: 'Correlation ids in request logs',
        reasoning: 'Fastify already has a request id generator; the plugin should override it to honour the header and add the id to the log bindings and the response.',
        steps: [
          { tool: 'shell', cmd: 'rg -n "fastify\\(" src', out: 'src/app.js:6:const app = fastify({ logger: true })' },
          { tool: 'apply_patch', add: true, file: 'src/plugins/requestId.js', patch: "*** Begin Patch\n*** Add File: src/plugins/requestId.js\n+import fp from 'fastify-plugin'\n+\n+// Echo the request id back so a client can quote it in a support ticket.\n+export default fp(async (app) => {\n+  app.addHook('onRequest', async (req, reply) => {\n+    reply.header('x-request-id', req.id)\n+  })\n+})\n*** End Patch" },
          { tool: 'apply_patch', file: 'src/app.js', patch: "*** Begin Patch\n*** Update File: src/app.js\n@@\n-const app = fastify({ logger: true })\n+import { randomUUID } from 'node:crypto'\n+import requestId from './plugins/requestId.js'\n+\n+const app = fastify({\n+  logger: { level: 'info' },\n+  requestIdHeader: 'x-request-id',\n+  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),\n+})\n+app.register(requestId)\n*** End Patch" },
          { tool: 'shell', cmd: 'npm test 2>&1 | tail -3', out: 'ℹ pass 31\nℹ fail 0\nℹ duration_ms 2088.4' },
        ],
        reply: 'Every request now logs with a `reqId` that is either the incoming `X-Request-Id` or a fresh UUID, and the same id is echoed in the `x-request-id` response header via a small `requestId` plugin. Test suite still green (31/31).',
      },
      {
        prompt: 'Upgrade fastify to v5 and fix whatever deprecations show up.',
        title: 'Fastify 5 upgrade',
        reasoning: 'Bump, run the tests, and follow the deprecation output rather than guessing at the migration guide.',
        steps: [
          { tool: 'shell', cmd: 'npm i fastify@5 fastify-plugin@5 2>&1 | tail -2', out: 'added 3 packages, changed 12 packages, and audited 214 packages in 6s\nfound 0 vulnerabilities' },
          { tool: 'shell', cmd: 'npm test 2>&1 | grep -E "FSTDEP|fail|pass" | sort | uniq -c', out: '      1 (node:22140) [FSTDEP019] FastifyDeprecation: request.routeConfig is deprecated, use request.routeOptions.config\n      1 ℹ fail 2\n      1 ℹ pass 29' },
          { tool: 'shell', cmd: 'rg -n "routeConfig|reply\\.getResponseTime" src', out: 'src/plugins/metrics.js:11:    const route = req.routeConfig.url\nsrc/plugins/metrics.js:14:    histogram.observe({ route }, reply.getResponseTime())' },
          { tool: 'apply_patch', file: 'src/plugins/metrics.js', patch: "*** Begin Patch\n*** Update File: src/plugins/metrics.js\n@@\n-    const route = req.routeConfig.url\n+    const route = req.routeOptions.url\n@@\n-    histogram.observe({ route }, reply.getResponseTime())\n+    histogram.observe({ route }, reply.elapsedTime)\n*** End Patch" },
          { tool: 'shell', cmd: 'npm test 2>&1 | tail -3', out: 'ℹ pass 31\nℹ fail 0\nℹ duration_ms 1994.1' },
        ],
        reply: 'fastify 5.x and fastify-plugin 5.x are in. Two failures came from the metrics plugin (`request.routeConfig` → `request.routeOptions`, `reply.getResponseTime()` → `reply.elapsedTime`); no other deprecations fired. 31/31 passing.',
      },
    ],
  },
  'lantern-docs': {
    branch: 'main',
    claude: [
      {
        prompt: 'Rewrite the getting-started page so a new user reaches a running example in under five minutes. Keep the current headings so links do not break.',
        title: 'Getting-started rewrite',
        thinking: 'Read the page and the build config; the rewrite must preserve heading anchors.',
        steps: [
          { tool: 'Read', input: { file_path: 'docs/getting-started.md' }, result: '     1\t---\n     2\ttitle: Getting started\n     3\t---\n     4\t\n     5\t## Install\n     6\t\n     7\tLantern is distributed as an npm package…\n     8\t\n     9\t## Configure\n    10\t\n    11\tBefore running Lantern you will want to understand its configuration model in depth…\n    12\t\n    13\t## Run\n    14\t\n    15\tSee the CLI reference.' },
          { tool: 'Edit', input: { file_path: 'docs/getting-started.md', old_string: '## Configure\n\nBefore running Lantern you will want to understand its configuration model in depth…', new_string: '## Configure\n\nYou do not need to configure anything yet — `lantern init` writes a working\n`lantern.config.mjs`. Come back to [Configuration](./configuration.md) once the\nexample runs.\n\n```sh\nnpx lantern init my-site\ncd my-site\n```' }, result: 'The file docs/getting-started.md has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'docs/getting-started.md', old_string: '## Run\n\nSee the CLI reference.', new_string: '## Run\n\n```sh\nnpm run dev\n```\n\nOpen http://localhost:4321 — edit `docs/index.md` and the page reloads. That is\nthe whole loop; the [CLI reference](./reference/cli.md) has every flag.' }, result: 'The file docs/getting-started.md has been updated successfully.' },
          { tool: 'Bash', input: { command: 'npm run build 2>&1 | tail -3', description: 'Build the docs site' }, result: '18:02:11 [build] 64 page(s) built in 3.41s\n18:02:11 [build] Complete!' },
        ],
        reply: 'The page now goes Install → `lantern init` → `npm run dev` with a copy-paste block at each step and defers the configuration deep-dive to its own page. Headings (`Install`, `Configure`, `Run`) are unchanged so existing anchors still resolve. Build is clean.',
      },
      {
        prompt: 'Add a versioned sidebar: v2 pages under /v2, v1 kept at /v1 with a banner saying it is no longer maintained.',
        title: 'Versioned sidebar (v1/v2)',
        thinking: 'Move the tree, then add a banner component that reads the version from the URL.',
        steps: [
          { tool: 'Glob', input: { pattern: 'docs/**/*.md' }, result: 'docs/index.md\ndocs/getting-started.md\ndocs/configuration.md\ndocs/guides/auth.md\ndocs/guides/deploy.md\ndocs/reference/cli.md\ndocs/reference/config.md\ndocs/changelog.md' },
          { tool: 'Read', input: { file_path: 'astro.config.mjs' }, result: "     1\timport { defineConfig } from 'astro/config'\n     2\timport lantern from '@lantern/astro'\n     3\t\n     4\texport default defineConfig({\n     5\t  integrations: [lantern({ sidebar: 'auto' })],\n     6\t})" },
          { tool: 'Bash', input: { command: 'mkdir -p docs/v1 docs/v2 && git mv docs/guides docs/reference docs/configuration.md docs/getting-started.md docs/v2/ && cp -r docs/v2 docs/v1', description: 'Split the docs tree into v1 and v2' }, result: '' },
          { tool: 'Edit', input: { file_path: 'astro.config.mjs', old_string: "  integrations: [lantern({ sidebar: 'auto' })],", new_string: "  integrations: [lantern({ sidebar: 'auto', versions: [{ label: 'v2 (current)', base: '/v2' }, { label: 'v1', base: '/v1', banner: 'VersionBanner' }] })]," }, result: 'The file astro.config.mjs has been updated successfully.' },
          { tool: 'Write', input: { file_path: 'src/components/VersionBanner.astro', content: '---\nconst { version } = Astro.props\n---\n<aside class="banner">\n  You are reading the <strong>{version}</strong> docs, which are no longer maintained.\n  <a href="/v2/getting-started/">Switch to v2 →</a>\n</aside>\n' }, result: 'File created successfully at: src/components/VersionBanner.astro' },
          { tool: 'Bash', input: { command: 'npm run build 2>&1 | tail -2', description: 'Build the docs site' }, result: '18:41:37 [build] 126 page(s) built in 5.02s\n18:41:37 [build] Complete!' },
        ],
        reply: 'The tree is now `docs/v1/**` and `docs/v2/**`; the sidebar integration gets a `versions` list, and v1 pages render `VersionBanner` with a link to the v2 equivalent. 126 pages build. The old top-level URLs (`/guides/auth`) need redirects to `/v2/...` — shall I add them to `astro.config.mjs`?',
      },
      {
        prompt: 'Check every internal link on the built site and fix the broken ones.',
        title: 'Fix broken internal links',
        thinking: 'Run a link checker over dist/ and fix the sources it points at.',
        steps: [
          { tool: 'Bash', input: { command: 'npx linkinator ./dist --recurse --skip "^https?://" 2>&1 | grep -E "\\[4[0-9]{2}\\]"', description: 'Find broken internal links' }, result: '[404] http://localhost:8080/v2/guides/auth/ → /guides/deploy/\n[404] http://localhost:8080/v2/reference/cli/ → /configuration/\n[404] http://localhost:8080/v1/getting-started/ → /reference/cli/' },
          { tool: 'Edit', input: { file_path: 'docs/v2/guides/auth.md', old_string: '](/guides/deploy/)', new_string: '](../guides/deploy.md)' }, result: 'The file docs/v2/guides/auth.md has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'docs/v2/reference/cli.md', old_string: '](/configuration/)', new_string: '](../configuration.md)' }, result: 'The file docs/v2/reference/cli.md has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'docs/v1/getting-started.md', old_string: '](/reference/cli/)', new_string: '](./reference/cli.md)' }, result: 'The file docs/v1/getting-started.md has been updated successfully.' },
          { tool: 'Bash', input: { command: 'npm run build >/dev/null 2>&1 && npx linkinator ./dist --recurse --skip "^https?://" 2>&1 | tail -1', description: 'Rebuild and re-check links' }, result: '126 links checked, 0 broken' },
        ],
        reply: 'Three broken links, all absolute paths that predate the v1/v2 split. Switched them to relative Markdown links (which the build resolves per version) — 126 links checked, 0 broken.',
      },
      {
        prompt: 'Generate a changelog page from the last 20 git tags, newest first, one section per tag with the commit subjects.',
        title: 'Changelog page from git tags',
        thinking: 'Read tags and subjects with git, then write Markdown.',
        steps: [
          { tool: 'Bash', input: { command: 'git tag --sort=-v:refname | head -20', description: 'List the latest tags' }, result: 'v2.3.0\nv2.2.1\nv2.2.0\nv2.1.0\nv2.0.0\nv1.9.2\nv1.9.1\nv1.9.0\nv1.8.0\nv1.7.3' },
          { tool: 'Bash', input: { command: 'git log --format="%s" v2.2.1..v2.3.0 | head', description: 'Subjects in the newest release' }, result: 'feat(sidebar): version switcher\nfix(build): stale cache on Windows\ndocs: getting started rewrite' },
          { tool: 'Write', input: { file_path: 'docs/v2/changelog.md', content: '---\ntitle: Changelog\n---\n\n## v2.3.0\n\n- feat(sidebar): version switcher\n- fix(build): stale cache on Windows\n- docs: getting started rewrite\n\n## v2.2.1\n\n- fix(cli): `lantern init` on paths with spaces\n' }, result: 'File created successfully at: docs/v2/changelog.md' },
        ],
        reply: 'Wrote `docs/v2/changelog.md` from the ten tags the repo has (there are not twenty yet), newest first, one section per tag listing the commit subjects between it and the previous tag.',
      },
    ],
  },
  'atlas-mobile': {
    branch: 'fix/offline-queue',
    claude: [
      {
        prompt: 'The offline queue drops mutations when the app is backgrounded mid-sync. Reproduce it and fix it.',
        title: 'Offline queue loses mutations on background',
        thinking: 'Look at how the queue persists and what happens on the AppState change event.',
        steps: [
          { tool: 'Read', input: { file_path: 'src/sync/queue.ts' }, result: "     1\texport class MutationQueue {\n     2\t  private items: Mutation[] = []\n     3\t  private flushing = false\n     4\t\n     5\t  async flush() {\n     6\t    if (this.flushing) return\n     7\t    this.flushing = true\n     8\t    const batch = this.items.splice(0)\n     9\t    for (const m of batch) await this.api.send(m)\n    10\t    this.flushing = false\n    11\t  }\n    12\t}" },
          { tool: 'Grep', input: { pattern: 'AppState', path: 'src', output_mode: 'content' }, result: "src/sync/index.ts:14:AppState.addEventListener('change', (s) => { if (s === 'active') queue.flush() })" },
          { tool: 'Edit', input: { file_path: 'src/sync/queue.ts', old_string: '    const batch = this.items.splice(0)\n    for (const m of batch) await this.api.send(m)\n    this.flushing = false', new_string: '    // Send one at a time and only drop an item after it was acknowledged, so a\n    // background kill mid-flush leaves the unsent tail in the persisted queue.\n    try {\n      while (this.items.length) {\n        await this.api.send(this.items[0])\n        this.items.shift()\n        await this.persist()\n      }\n    } finally {\n      this.flushing = false\n    }' }, result: 'The file src/sync/queue.ts has been updated successfully.' },
          { tool: 'Bash', input: { command: 'yarn test sync 2>&1 | tail -5', description: 'Run the sync tests' }, result: 'PASS src/sync/__tests__/queue.test.ts\n  ✓ flushes in order (12 ms)\n  ✓ keeps unsent items when send throws (9 ms)\n  ✓ keeps unsent items when interrupted mid-flush (11 ms)\n\nTests: 3 passed, 3 total' },
        ],
        reply: 'Reproduced: `flush()` spliced the whole queue out of memory *before* sending, so a background kill after the first request lost everything still in flight. It now sends one item at a time, removes each only after the server acknowledged it, and persists after every step. Added a test that interrupts mid-flush.',
      },
      {
        prompt: 'Add a dark theme toggle to Settings and persist the choice with MMKV.',
        title: 'Dark theme toggle',
        thinking: 'Find the theme provider and the settings screen; MMKV is already a dependency.',
        steps: [
          { tool: 'Read', input: { file_path: 'src/theme/index.ts' }, result: "     1\timport { createContext, useContext } from 'react'\n     2\texport const light = { bg: '#ffffff', fg: '#111111' }\n     3\texport const dark = { bg: '#0f1115', fg: '#e6e6e6' }\n     4\texport const ThemeContext = createContext(light)\n     5\texport const useTheme = () => useContext(ThemeContext)" },
          { tool: 'Read', input: { file_path: 'src/screens/Settings.tsx' }, result: "     1\timport { View, Text, Switch } from 'react-native'\n     2\texport function Settings() {\n     3\t  return (\n     4\t    <View>\n     5\t      <Text>Settings</Text>\n     6\t    </View>\n     7\t  )\n     8\t}" },
          { tool: 'Edit', input: { file_path: 'src/theme/index.ts', old_string: "export const useTheme = () => useContext(ThemeContext)", new_string: "export const useTheme = () => useContext(ThemeContext)\n\nimport { MMKV } from 'react-native-mmkv'\nconst store = new MMKV()\nexport const loadScheme = (): 'light' | 'dark' => (store.getString('theme') === 'dark' ? 'dark' : 'light')\nexport const saveScheme = (s: 'light' | 'dark') => store.set('theme', s)" }, result: 'The file src/theme/index.ts has been updated successfully.' },
          { tool: 'Edit', input: { file_path: 'src/screens/Settings.tsx', old_string: '      <Text>Settings</Text>', new_string: "      <Text>Settings</Text>\n      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>\n        <Text>Dark theme</Text>\n        <Switch value={scheme === 'dark'} onValueChange={(v) => setScheme(v ? 'dark' : 'light')} />\n      </View>" }, result: 'The file src/screens/Settings.tsx has been updated successfully.' },
          { tool: 'Bash', input: { command: 'yarn tsc --noEmit 2>&1 | tail -1', description: 'Type-check' }, result: 'Done in 9.84s.' },
        ],
        reply: 'Settings has a "Dark theme" switch; the choice is stored under the `theme` key in MMKV and read at startup by the theme provider, so the app opens in the last chosen scheme. Type-check passes.',
      },
      {
        prompt: 'Profile the map screen — it drops to about 40 fps when more than 200 markers are shown.',
        title: 'Map screen frame drops',
        thinking: 'Rendering each marker as its own component with an inline style object is the usual reason; clustering plus memoisation should do it.',
        steps: [
          { tool: 'Read', input: { file_path: 'src/screens/MapScreen.tsx' }, result: "     1\texport function MapScreen({ places }) {\n     2\t  return (\n     3\t    <MapView>\n     4\t      {places.map((p) => (\n     5\t        <Marker key={p.id} coordinate={p.coord} onPress={() => open(p)} style={{ opacity: p.active ? 1 : 0.6 }} />\n     6\t      ))}\n     7\t    </MapView>\n     8\t  )\n     9\t}" },
          { tool: 'Edit', input: { file_path: 'src/screens/MapScreen.tsx', old_string: '      {places.map((p) => (\n        <Marker key={p.id} coordinate={p.coord} onPress={() => open(p)} style={{ opacity: p.active ? 1 : 0.6 }} />\n      ))}', new_string: '      {clusters.map((c) =>\n        c.count > 1 ? <ClusterMarker key={c.id} cluster={c} onPress={zoomTo} /> : <PlaceMarker key={c.place.id} place={c.place} onPress={open} />\n      )}' }, result: 'The file src/screens/MapScreen.tsx has been updated successfully.' },
          { tool: 'Write', input: { file_path: 'src/screens/PlaceMarker.tsx', content: "import { memo } from 'react'\nimport { Marker } from 'react-native-maps'\n\nconst ACTIVE = { opacity: 1 }\nconst IDLE = { opacity: 0.6 }\nexport const PlaceMarker = memo(function PlaceMarker({ place, onPress }) {\n  return <Marker coordinate={place.coord} tracksViewChanges={false} onPress={() => onPress(place)} style={place.active ? ACTIVE : IDLE} />\n})\n" }, result: 'File created successfully at: src/screens/PlaceMarker.tsx' },
          { tool: 'Bash', input: { command: 'yarn test map 2>&1 | tail -3', description: 'Run the map tests' }, result: 'Tests: 5 passed, 5 total\nSnapshots: 2 passed, 2 total\nDone in 6.21s.' },
        ],
        reply: 'Three changes: markers are clustered above ~40 on screen (supercluster over the visible region), each marker is a memoised component with `tracksViewChanges={false}`, and the two style objects are hoisted so props stay referentially stable. On the 300-marker fixture the profiler shows a steady 60 fps while panning.',
      },
      {
        prompt: 'Bump React Native to 0.76 and fix whatever breaks.',
        title: 'React Native 0.76 upgrade',
        thinking: 'Upgrade, type-check, then fix the breakage the compiler reports.',
        steps: [
          { tool: 'Bash', input: { command: 'yarn upgrade react-native@0.76.5 @react-native/metro-config@0.76.5 2>&1 | tail -2', description: 'Upgrade React Native' }, result: 'success Saved lockfile.\nDone in 48.12s.' },
          { tool: 'Bash', input: { command: 'yarn tsc --noEmit 2>&1 | grep error | head', description: 'Type-check after the upgrade' }, result: "src/components/Sheet.tsx(41,9): error TS2322: Type '{ enabled: boolean; }' is not assignable to type 'IntrinsicAttributes & KeyboardAvoidingViewProps'.\n  Property 'enabled' does not exist on type 'KeyboardAvoidingViewProps'." },
          { tool: 'Edit', input: { file_path: 'src/components/Sheet.tsx', old_string: '<KeyboardAvoidingView enabled={open} behavior="padding">', new_string: '<KeyboardAvoidingView behavior={open ? \'padding\' : undefined}>' }, result: 'The file src/components/Sheet.tsx has been updated successfully.' },
          { tool: 'Bash', input: { command: 'yarn tsc --noEmit && yarn test 2>&1 | tail -2', description: 'Type-check and run all tests' }, result: 'Tests: 48 passed, 48 total\nDone in 41.77s.' },
        ],
        reply: 'RN 0.76.5 is in with the matching metro config. The only break was `KeyboardAvoidingView`\'s removed `enabled` prop (toggling `behavior` instead). 48 tests pass; the new architecture is on by default now, so it is worth a manual pass on the map screen before release.',
      },
    ],
  },
  'beacon-infra': {
    branch: 'main',
    claude: [
      {
        prompt: 'Add a staging environment that mirrors prod, but with one node per pool and no multi-AZ database.',
        title: 'Staging environment',
        thinking: 'Copy the prod env and shrink the sizes; validate before planning.',
        steps: [
          { tool: 'Glob', input: { pattern: 'envs/**/*.tf' }, result: 'envs/prod/main.tf\nenvs/prod/variables.tf\nenvs/prod/outputs.tf' },
          { tool: 'Read', input: { file_path: 'envs/prod/main.tf' }, result: '     1\tmodule "cluster" {\n     2\t  source     = "../../modules/cluster"\n     3\t  name       = "beacon-prod"\n     4\t  node_count = { api = 3, workers = 4 }\n     5\t}\n     6\t\n     7\tmodule "db" {\n     8\t  source   = "../../modules/db"\n     9\t  name     = "beacon-prod"\n    10\t  multi_az = true\n    11\t}' },
          { tool: 'Write', input: { file_path: 'envs/staging/main.tf', content: 'module "cluster" {\n  source     = "../../modules/cluster"\n  name       = "beacon-staging"\n  node_count = { api = 1, workers = 1 }\n}\n\nmodule "db" {\n  source   = "../../modules/db"\n  name     = "beacon-staging"\n  multi_az = false\n}\n' }, result: 'File created successfully at: envs/staging/main.tf' },
          { tool: 'Bash', input: { command: 'cd envs/staging && terraform init -backend=false >/dev/null && terraform validate', description: 'Validate the staging config' }, result: 'Success! The configuration is valid.' },
        ],
        reply: '`envs/staging/` mirrors prod through the same two modules with `node_count = { api = 1, workers = 1 }` and `multi_az = false`; `terraform validate` passes. It still needs its own backend block and a `staging` workspace in the pipeline before the first apply.',
      },
      {
        prompt: 'Rotate the RDS master password through Secrets Manager and get rid of the plaintext variable.',
        title: 'RDS password via Secrets Manager',
        thinking: 'Find every use of the variable, switch the module to manage_master_user_password, then plan.',
        steps: [
          { tool: 'Grep', input: { pattern: 'master_password', output_mode: 'content' }, result: 'modules/db/main.tf:14:  master_password = var.master_password\nmodules/db/variables.tf:9:variable "master_password" {\nenvs/prod/main.tf:12:  master_password = var.db_password' },
          { tool: 'Edit', input: { file_path: 'modules/db/main.tf', old_string: '  master_password = var.master_password', new_string: '  manage_master_user_password = true' }, result: 'The file modules/db/main.tf has been updated successfully.' },
          { tool: 'Bash', input: { command: 'cd envs/prod && terraform plan -no-color 2>&1 | grep -E "^  [~+-]|Plan:"', description: 'Plan the change in prod' }, result: '  ~ resource "aws_db_instance" "this" {\n      + manage_master_user_password = true\n      - password                    = (sensitive value) -> null\nPlan: 0 to add, 1 to change, 0 to destroy.' },
        ],
        reply: 'The DB module now sets `manage_master_user_password = true`, so RDS owns the secret in Secrets Manager and rotates it; the `master_password` variable and the `db_password` wiring in prod are gone. The plan is a single in-place change on the instance — no replacement.',
      },
      {
        prompt: 'Why does terraform plan show a diff on the ALB listener every single run, even with no changes?',
        title: 'Perpetual ALB listener diff',
        thinking: 'A perpetual diff on a listener is usually the default action ordering or a certificate ARN the provider normalises.',
        steps: [
          { tool: 'Bash', input: { command: 'cd envs/prod && terraform plan -no-color 2>&1 | grep -B2 -A6 "aws_lb_listener"', description: 'Show the listener diff' }, result: '  ~ resource "aws_lb_listener" "https" {\n      ~ default_action {\n          ~ order = 1 -> 0\n        }\n    }' },
          { tool: 'Read', input: { file_path: 'modules/alb/main.tf' }, result: '    22\t  default_action {\n    23\t    type             = "forward"\n    24\t    target_group_arn = aws_lb_target_group.api.arn\n    25\t    order            = 0\n    26\t  }' },
          { tool: 'Edit', input: { file_path: 'modules/alb/main.tf', old_string: '    target_group_arn = aws_lb_target_group.api.arn\n    order            = 0', new_string: '    target_group_arn = aws_lb_target_group.api.arn' }, result: 'The file modules/alb/main.tf has been updated successfully.' },
          { tool: 'Bash', input: { command: 'cd envs/prod && terraform plan -no-color 2>&1 | tail -1', description: 'Re-plan' }, result: 'No changes. Your infrastructure matches the configuration.' },
        ],
        reply: 'The module pinned `order = 0` on the default action, but the API always stores `1` for a single action, so every plan tried to "fix" it. Dropping the explicit `order` (the provider computes it) gives a clean `No changes.` plan.',
      },
    ],
  },
  'quill-editor': {
    branch: 'main',
    codex: [
      {
        prompt: 'Implement undo/redo grouping: consecutive keystrokes within 500 ms should form one undo step.',
        title: 'Undo grouping by time',
        reasoning: 'The history stack pushes one entry per transaction. Merging a new entry into the previous one when the gap is under the threshold and both are plain text inserts keeps the change small.',
        steps: [
          { tool: 'shell', cmd: 'rg -n "class History" src', out: 'src/history.ts:8:export class History {' },
          { tool: 'shell', cmd: 'sed -n 1,40p src/history.ts', out: "import type { Transaction } from './transaction'\n\nexport class History {\n  private undo: Transaction[] = []\n  private redo: Transaction[] = []\n\n  push(tr: Transaction) {\n    this.undo.push(tr)\n    this.redo = []\n  }\n\n  undoOne() { const tr = this.undo.pop(); if (tr) this.redo.push(tr); return tr }\n  redoOne() { const tr = this.redo.pop(); if (tr) this.undo.push(tr); return tr }\n}" },
          { tool: 'apply_patch', file: 'src/history.ts', patch: "*** Begin Patch\n*** Update File: src/history.ts\n@@\n export class History {\n   private undo: Transaction[] = []\n   private redo: Transaction[] = []\n+  private lastAt = 0\n+  constructor(private groupMs = 500, private now = () => Date.now()) {}\n \n   push(tr: Transaction) {\n-    this.undo.push(tr)\n+    const t = this.now()\n+    const prev = this.undo[this.undo.length - 1]\n+    if (prev && tr.isTyping && prev.isTyping && t - this.lastAt < this.groupMs) this.undo[this.undo.length - 1] = prev.merge(tr)\n+    else this.undo.push(tr)\n+    this.lastAt = t\n     this.redo = []\n   }\n*** End Patch" },
          { tool: 'shell', cmd: 'npm test -- history 2>&1 | tail -6', out: ' PASS  src/__tests__/history.test.ts\n  ✓ groups keystrokes within 500ms (4 ms)\n  ✓ does not group across a pause (3 ms)\n  ✓ never groups a paste into typing (2 ms)\n\nTests: 3 passed, 3 total' },
        ],
        reply: '`History` now takes `groupMs` (default 500) and an injectable clock. A typing transaction that lands within the window of the previous typing transaction is merged into it; pastes and formatting changes never merge. Three new tests cover the window, the pause and the paste case.',
      },
      {
        prompt: 'Markdown paste: when the clipboard has Markdown, convert it into rich nodes instead of inserting the raw text.',
        title: 'Markdown paste plugin',
        reasoning: 'Add a paste plugin that detects Markdown heuristically and runs the existing markdown parser; fall through to plain text otherwise.',
        steps: [
          { tool: 'shell', cmd: 'ls src/plugins', out: 'index.ts\nkeymap.ts\nlinkify.ts\nplaceholder.ts' },
          { tool: 'apply_patch', add: true, file: 'src/plugins/markdownPaste.ts', patch: "*** Begin Patch\n*** Add File: src/plugins/markdownPaste.ts\n+import { parseMarkdown } from '../markdown'\n+import type { Plugin } from './types'\n+\n+const LOOKS_LIKE_MD = /^(#{1,6}\\s|[-*]\\s|\\d+\\.\\s|>\\s|```)/m\n+\n+export const markdownPaste: Plugin = {\n+  name: 'markdownPaste',\n+  onPaste(view, event) {\n+    const text = event.clipboardData?.getData('text/plain') ?? ''\n+    if (!LOOKS_LIKE_MD.test(text)) return false\n+    view.dispatch(view.state.tr.replaceSelection(parseMarkdown(text)))\n+    return true\n+  },\n+}\n*** End Patch" },
          { tool: 'apply_patch', file: 'src/plugins/index.ts', patch: "*** Begin Patch\n*** Update File: src/plugins/index.ts\n@@\n import { placeholder } from './placeholder'\n+import { markdownPaste } from './markdownPaste'\n \n-export const defaultPlugins = [keymap, linkify, placeholder]\n+export const defaultPlugins = [keymap, linkify, placeholder, markdownPaste]\n*** End Patch" },
          { tool: 'shell', cmd: 'npm run typecheck 2>&1 | tail -1', out: 'Found 0 errors.' },
        ],
        reply: 'New `markdownPaste` plugin: if the pasted text starts a line with a heading, list, quote or fence marker it is parsed with the existing `parseMarkdown` and inserted as nodes; anything else falls through to the default paste. Registered in `defaultPlugins`; typecheck is clean.',
      },
      {
        prompt: 'The collaborative cursor flickers when two users type in the same paragraph. Can you make it stable?',
        title: 'Collab cursor flicker',
        reasoning: 'Remote cursors are re-created on every remote transaction. Keying the decorations by client id and mapping positions through the transaction avoids the remove/add cycle.',
        steps: [
          { tool: 'shell', cmd: 'rg -n "DecorationSet|remoteCursors" src/collab', out: 'src/collab/cursors.ts:12:    return DecorationSet.create(state.doc, remoteCursors(state).map(toWidget))' },
          { tool: 'apply_patch', file: 'src/collab/cursors.ts', patch: "*** Begin Patch\n*** Update File: src/collab/cursors.ts\n@@\n-  apply(tr, old, _oldState, state) {\n-    return DecorationSet.create(state.doc, remoteCursors(state).map(toWidget))\n+  apply(tr, old, _oldState, state) {\n+    const mapped = old.map(tr.mapping, tr.doc)\n+    const meta = tr.getMeta(cursorsKey)\n+    if (!meta) return mapped\n+    // replace only the client whose cursor moved; keep every other widget as-is\n+    const stale = mapped.find(undefined, undefined, (spec) => spec.clientId === meta.clientId)\n+    return mapped.remove(stale).add(tr.doc, [toWidget(meta)])\n*** End Patch" },
          { tool: 'shell', cmd: 'npm test -- collab 2>&1 | tail -3', out: 'Tests: 7 passed, 7 total\nSnapshots: 0 total\nTime: 2.1 s' },
        ],
        reply: 'Cursor decorations are now mapped through each transaction and only the moving client\'s widget is replaced (keyed by `clientId`) instead of rebuilding the whole set, so the other cursors keep their DOM nodes and stop flickering. Collab tests pass.',
      },
    ],
  },
  'meadow-cli': {
    branch: 'main',
    codex: [
      {
        prompt: 'Add a `meadow export --format csv` subcommand that writes the current plot to stdout or to --out.',
        title: 'CSV export subcommand',
        reasoning: 'Follow the existing cobra command layout; the plot type already has a Rows() accessor.',
        steps: [
          { tool: 'shell', cmd: 'go list ./... && ls cmd', out: 'meadow\nmeadow/cmd\nmeadow/internal/plot\nmeadow/internal/sync\nroot.go\nsync.go\nstatus.go' },
          { tool: 'apply_patch', add: true, file: 'cmd/export.go', patch: '*** Begin Patch\n*** Add File: cmd/export.go\n+package cmd\n+\n+import (\n+\t"encoding/csv"\n+\t"os"\n+\n+\t"github.com/spf13/cobra"\n+\t"meadow/internal/plot"\n+)\n+\n+var exportOut, exportFormat string\n+\n+var exportCmd = &cobra.Command{\n+\tUse:   "export",\n+\tShort: "Export the current plot",\n+\tRunE: func(cmd *cobra.Command, args []string) error {\n+\t\tp, err := plot.Load(cwd())\n+\t\tif err != nil {\n+\t\t\treturn err\n+\t\t}\n+\t\tw := os.Stdout\n+\t\tif exportOut != "" {\n+\t\t\tf, err := os.Create(exportOut)\n+\t\t\tif err != nil {\n+\t\t\t\treturn err\n+\t\t\t}\n+\t\t\tdefer f.Close()\n+\t\t\tw = f\n+\t\t}\n+\t\tcw := csv.NewWriter(w)\n+\t\tdefer cw.Flush()\n+\t\treturn cw.WriteAll(p.Rows())\n+\t},\n+}\n+\n+func init() {\n+\texportCmd.Flags().StringVar(&exportFormat, "format", "csv", "output format (csv)")\n+\texportCmd.Flags().StringVar(&exportOut, "out", "", "write to a file instead of stdout")\n+\trootCmd.AddCommand(exportCmd)\n+}\n*** End Patch' },
          { tool: 'shell', cmd: 'go build ./... && go test ./... 2>&1 | tail -4', out: 'ok  \tmeadow/cmd\t0.412s\nok  \tmeadow/internal/plot\t0.118s\nok  \tmeadow/internal/sync\t1.204s' },
        ],
        reply: '`meadow export [--format csv] [--out file]` is in `cmd/export.go`: it loads the plot for the working directory and streams `plot.Rows()` through `encoding/csv` to stdout or the given file. `--format` only accepts `csv` for now so the flag is there when JSON lands. Build and tests pass.',
      },
      {
        prompt: 'Make `meadow sync` resumable after a network drop — it currently starts over from the first record.',
        title: 'Resumable sync',
        reasoning: 'Persist a cursor after each acknowledged batch and start from it; treat a missing cursor as a full sync.',
        steps: [
          { tool: 'shell', cmd: 'rg -n "func (s \\*Syncer) Run" internal/sync', out: 'internal/sync/sync.go:31:func (s *Syncer) Run(ctx context.Context) error {' },
          { tool: 'apply_patch', file: 'internal/sync/sync.go', patch: '*** Begin Patch\n*** Update File: internal/sync/sync.go\n@@\n func (s *Syncer) Run(ctx context.Context) error {\n-\tfor _, b := range s.batches() {\n+\tcursor, _ := s.store.Cursor()\n+\tfor _, b := range s.batchesFrom(cursor) {\n \t\tif err := s.client.Push(ctx, b); err != nil {\n \t\t\treturn err\n \t\t}\n+\t\tif err := s.store.SetCursor(b.Last()); err != nil {\n+\t\t\treturn err\n+\t\t}\n \t}\n+\treturn s.store.ClearCursor()\n-\treturn nil\n }\n*** End Patch' },
          { tool: 'shell', cmd: 'go test ./internal/sync/... -run Resume -v 2>&1 | tail -5', out: '=== RUN   TestResumeAfterDrop\n--- PASS: TestResumeAfterDrop (0.02s)\n=== RUN   TestResumeClearsCursorOnSuccess\n--- PASS: TestResumeClearsCursorOnSuccess (0.01s)\nok  \tmeadow/internal/sync\t0.318s' },
        ],
        reply: 'Sync now records a cursor (the last record id of each acknowledged batch) in the local store and resumes from it; a completed run clears the cursor so the next sync is full again. Two tests cover the drop-and-resume path and the clear.',
      },
    ],
  },
}

// Follow-up turns for sessions longer than a project's task list.
const FOLLOWUPS_CLAUDE = [
  { prompt: 'Looks good. Add tests for the edge cases you mentioned.', steps: [{ tool: 'Write', input: { file_path: 'test/edge-cases.test.js', content: "import test from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('rejects an empty payload', async () => {\n  assert.equal((await run({})).status, 400)\n})\n" }, result: 'File created successfully at: test/edge-cases.test.js' }, { tool: 'Bash', input: { command: 'npm test 2>&1 | tail -3', description: 'Run the suite' }, result: 'ℹ pass 33\nℹ fail 0\nℹ duration_ms 2210.3' }], reply: 'Added `test/edge-cases.test.js` (empty payload, oversized payload, unknown field) — 33 tests pass.' },
  { prompt: 'Update the README section for this.', steps: [{ tool: 'Grep', input: { pattern: '^## ', path: 'README.md', output_mode: 'content' }, result: 'README.md:3:## Install\nREADME.md:12:## Usage\nREADME.md:40:## Configuration\nREADME.md:88:## Contributing' }, { tool: 'Edit', input: { file_path: 'README.md', old_string: '## Configuration', new_string: '## Configuration\n\nSee the section below for the options added in this change.' }, result: 'The file README.md has been updated successfully.' }], reply: 'README updated under **Configuration** with the new options and an example.' },
  { prompt: 'Run the full suite once more and summarise what changed in this session.', steps: [{ tool: 'Bash', input: { command: 'npm test 2>&1 | tail -3 && git diff --stat | tail -1', description: 'Run tests and show the diff size' }, result: 'ℹ pass 33\nℹ fail 0\nℹ duration_ms 2187.9\n 7 files changed, 143 insertions(+), 19 deletions(-)' }], reply: 'All green. Summary of this session: the change itself, the regression test that pins it, a README paragraph, and the follow-up edge-case tests — 7 files, +143/−19.' },
  { prompt: 'Commit message please — conventional commits, subject line only.', steps: [], reply: '```\nfeat: harden request handling and cover the edge cases\n```' },
  { prompt: 'Can you double-check there is nothing left that references the old behaviour?', steps: [{ tool: 'Grep', input: { pattern: 'TODO|FIXME|deprecated', path: 'src', output_mode: 'content' }, result: 'src/legacy/compat.js:3:// TODO remove after v2' }], reply: 'Only one hit, and it is the pre-existing note in `src/legacy/compat.js` about removing the compat layer after v2 — unrelated to this change. Nothing else references the old behaviour.' },
]
const FOLLOWUPS_CODEX = [
  { prompt: 'Add a test for the failure path too.', reasoning: 'One negative test next to the existing ones.', steps: [{ tool: 'apply_patch', file: 'test/failure.test.js', add: true, patch: "*** Begin Patch\n*** Add File: test/failure.test.js\n+import test from 'node:test'\n+import assert from 'node:assert/strict'\n+\n+test('surfaces the upstream error', async () => {\n+  await assert.rejects(run({ fail: true }), /upstream/)\n+})\n*** End Patch" }, { tool: 'shell', cmd: 'npm test 2>&1 | tail -2', out: 'ℹ pass 32\nℹ fail 0' }], reply: 'Added `test/failure.test.js` asserting the upstream error is surfaced; 32 tests pass.' },
  { prompt: 'Summarise the diff for the PR description.', reasoning: 'Read the stat and describe the intent.', steps: [{ tool: 'shell', cmd: 'git diff --stat | tail -1', out: ' 4 files changed, 61 insertions(+), 9 deletions(-)' }], reply: '**What**: the change requested above plus a regression test.\n**Why**: see the first message of this thread.\n**Risk**: low — behaviour is unchanged for callers that do not opt in.\n\n4 files, +61/−9.' },
  { prompt: 'Run the linter and fix anything it flags.', reasoning: 'Lint, patch, re-run.', steps: [{ tool: 'shell', cmd: 'npm run lint 2>&1 | tail -3', out: 'src/plugins/requestId.js\n  4:1  warning  Unexpected console statement  no-console\n✖ 1 problem (0 errors, 1 warning)' }, { tool: 'apply_patch', file: 'src/plugins/requestId.js', patch: "*** Begin Patch\n*** Update File: src/plugins/requestId.js\n@@\n-  console.log('requestId plugin loaded')\n*** End Patch" }, { tool: 'shell', cmd: 'npm run lint 2>&1 | tail -1', out: '✨ 0 problems' }], reply: 'One warning (a leftover `console.log`), removed. Lint is clean.' },
]

// ---- schedule (the Insights story) -------------------------------------------
// Each entry: weeks ago + weekday (1 = Mon … 7 = Sun, 0 = "today"), local start
// hour:minute, provider, project, duration (min), user turns, flags.

function schedule(scenario) {
  if (scenario === 'empty') return []
  if (scenario === 'single-project') {
    return [
      { w: 0, d: 0, h: 10, m: 5, provider: 'claude', project: 'orbit-api', dur: 35, turns: 5, subagents: true, title: true },
      { w: 0, d: 0, h: 14, m: 20, provider: 'codex', project: 'orbit-api', dur: 25, turns: 3, rate: true },
      { w: 0, d: -1, h: 9, m: 40, provider: 'claude', project: 'orbit-api', dur: 90, turns: 9, title: true },
      { w: 1, d: 3, h: 11, m: 0, provider: 'codex', project: 'orbit-api', dur: 30, turns: 4 },
      { w: 2, d: 2, h: 16, m: 15, provider: 'claude', project: 'orbit-api', dur: 20, turns: 3 },
      { w: 0, d: -1, h: 16, m: 30, provider: 'antigravity', project: 'orbit-api', dur: 20, turns: 2 },
    ]
  }
  // v2-highlights — 24 sessions over 12 weeks, mornings-heavy, weekdays, a 4-day streak ending today
  return [
    { w: 0, d: 0, h: 9, m: 40, provider: 'claude', project: 'orbit-api', dur: 38, turns: 6, subagents: true, title: true, task: 3 },
    { w: 0, d: 0, h: 11, m: 15, provider: 'codex', project: 'orbit-api', dur: 26, turns: 4, rate: true, thread: true, task: 0 },
    { w: 0, d: -1, h: 10, m: 5, provider: 'claude', project: 'lantern-docs', dur: 52, turns: 8, title: true },
    { w: 0, d: -1, h: 15, m: 30, provider: 'claude', project: 'atlas-mobile', dur: 21, turns: 3 },
    { w: 0, d: -2, h: 9, m: 10, provider: 'claude', project: 'orbit-api', dur: 178, turns: 22, title: true, custom: 'Rate limiting + archive job (long pairing session)' },
    { w: 0, d: -3, h: 21, m: 30, provider: 'codex', project: 'quill-editor', dur: 41, turns: 5, thread: true },
    { w: 0, d: -3, h: 14, m: 0, provider: 'claude', project: 'lantern-docs', dur: 12, turns: 2 },
    { w: 1, d: 2, h: 9, m: 30, provider: 'claude', project: 'atlas-mobile', dur: 63, turns: 9, title: true },
    { w: 1, d: 3, h: 10, m: 15, provider: 'codex', project: 'orbit-api', dur: 31, turns: 4 },
    { w: 1, d: 4, h: 16, m: 0, provider: 'claude', project: 'orbit-api', dur: 95, turns: 12, title: true },
    { w: 1, d: 5, h: 11, m: 0, provider: 'codex', project: 'quill-editor', dur: 16, turns: 2 },
    { w: 1, d: 6, h: 10, m: 30, provider: 'claude', project: 'lantern-docs', dur: 47, turns: 6 },
    { w: 2, d: 1, h: 9, m: 50, provider: 'claude', project: 'orbit-api', dur: 40, turns: 5, title: true },
    { w: 2, d: 3, h: 10, m: 0, provider: 'claude', project: 'atlas-mobile', dur: 236, turns: 24, title: true },
    { w: 2, d: 4, h: 22, m: 15, provider: 'codex', project: 'meadow-cli', dur: 35, turns: 4, thread: true },
    { w: 3, d: 2, h: 9, m: 20, provider: 'codex', project: 'meadow-cli', dur: 57, turns: 6 },
    { w: 3, d: 4, h: 10, m: 40, provider: 'claude', project: 'lantern-docs', dur: 29, turns: 4, title: true },
    { w: 4, d: 3, h: 9, m: 0, provider: 'claude', project: 'beacon-infra', dur: 72, turns: 8, title: true },
    { w: 4, d: 5, h: 15, m: 20, provider: 'claude', project: 'beacon-infra', dur: 24, turns: 3 },
    { w: 6, d: 2, h: 10, m: 10, provider: 'claude', project: 'beacon-infra', dur: 46, turns: 5, title: true },
    { w: 6, d: 4, h: 9, m: 45, provider: 'codex', project: 'quill-editor', dur: 19, turns: 3 },
    { w: 8, d: 3, h: 11, m: 0, provider: 'claude', project: 'orbit-api', dur: 33, turns: 4 },
    { w: 10, d: 2, h: 10, m: 0, provider: 'claude', project: 'atlas-mobile', dur: 31, turns: 4 },
    { w: 11, d: 4, h: 9, m: 30, provider: 'codex', project: 'orbit-api', dur: 42, turns: 5 },
    { w: 0, d: 0, h: 16, m: 5, provider: 'antigravity', project: 'orbit-api', dur: 22, turns: 3, title: true },
    { w: 1, d: 1, h: 10, m: 20, provider: 'antigravity', project: 'quill-editor', dur: 35, turns: 4 },
    { w: 3, d: 5, h: 15, m: 0, provider: 'antigravity', project: 'meadow-cli', dur: 18, turns: 2 },
  ]
}

// Resolve a schedule entry to a start time (ms). d = 0 → today, d < 0 → |d|
// days ago, d = 1..7 → that weekday (Mon..Sun) `w` weeks ago. Today's sessions
// are pulled back so they end a few minutes before `now`.
function startOf(entry, now) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  let daysAgo
  if (entry.d <= 0) daysAgo = -entry.d
  else {
    const dow = today.getDay() // 0 = Sun
    const target = entry.d % 7 // 1..6 Mon..Sat, 0 Sun
    daysAgo = (dow - target + 7) % 7 + 7 * entry.w
    if (daysAgo === 0 && entry.w === 0) daysAgo = 7 // "this weekday" already passed only if it is not today
  }
  const start = new Date(today.getTime() - daysAgo * 86400000)
  start.setHours(entry.h, entry.m, 0, 0)
  let t = start.getTime()
  if (daysAgo === 0) t = Math.min(t, now - (entry.dur + 4) * 60000)
  return t
}

// ---- Claude Code writer ------------------------------------------------------

function claudeSession(rng, ctx, entry, sid, startMs) {
  const { cwd, branch, tasks } = ctx
  const iso = (ms) => new Date(ms).toISOString()
  const recs = []
  const history = []
  let last = null
  let cacheRead = rng.int(16000, 26000)
  const model = entry.turns > 10 || entry.subagents ? MODELS.opus : rng.pick([MODELS.sonnet, MODELS.sonnet, MODELS.opus])
  const base = () => ({ parentUuid: last, isSidechain: false, userType: 'external', cwd, sessionId: sid, version: CLAUDE_VERSION, gitBranch: branch })
  const push = (rec) => {
    recs.push(rec)
    last = rec.uuid
    return rec
  }
  const user = (ms, content, extra = {}) => push({ ...base(), type: 'user', message: { role: 'user', content }, uuid: rng.uuid(), timestamp: iso(ms), ...extra })
  const assistant = (ms, content, stop) => {
    const out = content.reduce((n, b) => n + (b.type === 'text' ? Math.ceil(b.text.length / 3.6) : b.type === 'tool_use' ? Math.ceil(JSON.stringify(b.input).length / 3.6) : b.type === 'thinking' ? Math.ceil(b.thinking.length / 3.6) : 0), 0)
    const create = rng.int(300, 5200)
    const rec = push({
      ...base(),
      type: 'assistant',
      message: { id: `msg_${rng.hex(24)}`, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: rng.int(3, 11), cache_creation_input_tokens: create, cache_read_input_tokens: cacheRead, output_tokens: out + rng.int(5, 40), service_tier: 'standard' } },
      requestId: `req_${rng.hex(20)}`,
      uuid: rng.uuid(),
      timestamp: iso(ms),
    })
    cacheRead += create
    return rec
  }

  const totalMs = entry.dur * 60000
  const perTurn = totalMs / entry.turns
  let t = startMs
  const subagentFiles = []
  // start at task `entry.task` (defaults to 0) and rotate through the list
  const off = entry.task ?? 0
  const taskAt = (i) => tasks[(off + i) % tasks.length]
  let title = null

  for (let i = 0; i < entry.turns; i++) {
    const turnStart = t
    const task = i < tasks.length ? taskAt(i) : FOLLOWUPS_CLAUDE[(i - tasks.length) % FOLLOWUPS_CLAUDE.length]
    const prompt = i >= tasks.length ? task.prompt : i === 0 ? task.prompt : `${rng.pick(['Next: ', 'Now ', 'Also — ', 'Then, '])}${task.prompt[0].toLowerCase()}${task.prompt.slice(1)}`
    user(t, prompt)
    history.push({ display: prompt, pastedContents: {}, timestamp: t, project: cwd })
    if (i === 0) title = entry.custom || (entry.title ? task.title : snippet(prompt))
    if (i === 0 && entry.title) push({ type: 'ai-title', aiTitle: task.title, sessionId: sid, uuid: rng.uuid(), timestamp: iso(t + 1500) })
    if (i === 0 && entry.custom) push({ type: 'custom-title', customTitle: entry.custom, sessionId: sid, uuid: rng.uuid(), timestamp: iso(t + 1800) })
    t += rng.int(6, 18) * 1000
    const steps = entry.subagents || i > 0 ? task.steps : task.steps.filter((s) => s.tool !== 'Task')
    steps.forEach((step, k) => {
      const content = []
      if (k === 0 && task.thinking) content.push({ type: 'thinking', thinking: task.thinking, signature: rng.b64(88) })
      if (k === 0) content.push({ type: 'text', text: rng.pick(['Let me look at the relevant code first.', "I'll start by reading what's there.", 'Checking the current implementation.', 'Let me reproduce this before changing anything.']) })
      const id = `toolu_${rng.hex(24)}`
      content.push({ type: 'tool_use', id, name: step.tool, input: step.input })
      assistant(t, content, 'tool_use')
      t += rng.int(2, 14) * 1000
      const dur = step.tool === 'Bash' ? rng.int(2, 40) * 1000 : step.tool === 'Task' ? rng.int(40, 130) * 1000 : rng.int(1, 3) * 1000
      user(t + dur, [{ tool_use_id: id, type: 'tool_result', content: step.result }], { toolUseResult: step.tool === 'Bash' ? { stdout: step.result, stderr: '', interrupted: false, isImage: false } : step.tool === 'Task' ? { status: 'completed', agentId: null } : step.result })
      if (step.tool === 'Task' && entry.subagents) subagentFiles.push({ prompt: step.input.prompt, description: step.input.description, agentType: step.input.subagent_type, result: step.result, at: t, dur, toolUseId: id })
      t += dur + rng.int(8, 30) * 1000
    })
    assistant(t, [{ type: 'text', text: task.reply }], 'end_turn')
    // the human reads + types the next prompt in whatever is left of this turn's slice
    t = Math.max(t + rng.int(15, 60) * 1000, turnStart + perTurn)
  }
  const lastTs = new Date(recs[recs.length - 1].timestamp).getTime()
  return { recs, history, lastTs, model, subagentFiles, title }
}

// what the list view prints when a session has no title record (parser.js cleanSnippet)
const snippet = (text, max = 140) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

function claudeSubagent(rng, ctx, parentSid, spec, agentId) {
  const { cwd, branch } = ctx
  const iso = (ms) => new Date(ms).toISOString()
  const recs = []
  let last = null
  let t = spec.at + 1200
  const base = () => ({ parentUuid: last, isSidechain: true, userType: 'external', cwd, sessionId: parentSid, agentId, version: CLAUDE_VERSION, gitBranch: branch })
  const push = (rec) => {
    recs.push(rec)
    last = rec.uuid
    return rec
  }
  push({ ...base(), type: 'user', message: { role: 'user', content: spec.prompt }, uuid: rng.uuid(), timestamp: iso(t) })
  const steps = [
    { name: 'Grep', input: { pattern: 'req\\.body', path: 'src/routes', output_mode: 'content' }, result: 'src/routes/customers.js:6:    return createCustomer(req.apiKey.tenantId, req.body)\nsrc/routes/customers.js:8:  app.patch(\'/v1/customers/:id\', { preHandler: [app.requireApiKey] }, async (req) => updateCustomer(req.apiKey.tenantId, req.params.id, req.body))\nsrc/routes/webhooks.js:14:    const hook = await registerHook(req.apiKey.tenantId, req.body)\nsrc/routes/orders.js:5:    const order = await createOrder(req.apiKey.tenantId, req.body)' },
    { name: 'Grep', input: { pattern: 'schema:', path: 'src/routes', output_mode: 'content' }, result: '' },
    { name: 'Read', input: { file_path: 'src/services/orders.js' }, result: "     1\timport { orderSchema } from '../schemas/order.js'\n     2\texport async function createOrder(tenantId, body) {\n     3\t  const data = orderSchema.parse(body)\n     4\t  …" },
  ]
  let cacheRead = rng.int(9000, 14000)
  for (const s of steps) {
    const id = `toolu_${rng.hex(24)}`
    push({ ...base(), type: 'assistant', message: { id: `msg_${rng.hex(24)}`, type: 'message', role: 'assistant', model: MODELS.haiku, content: [{ type: 'tool_use', id, name: s.name, input: s.input }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: rng.int(2, 6), cache_creation_input_tokens: rng.int(200, 900), cache_read_input_tokens: cacheRead, output_tokens: rng.int(60, 140), service_tier: 'standard' } }, requestId: `req_${rng.hex(20)}`, uuid: rng.uuid(), timestamp: iso(t) })
    t += rng.int(2, 6) * 1000
    push({ ...base(), type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: s.result }] }, toolUseResult: s.result, uuid: rng.uuid(), timestamp: iso(t) })
    t += rng.int(3, 9) * 1000
    cacheRead += 700
  }
  push({ ...base(), type: 'assistant', message: { id: `msg_${rng.hex(24)}`, type: 'message', role: 'assistant', model: MODELS.haiku, content: [{ type: 'text', text: spec.result }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 4, cache_creation_input_tokens: rng.int(200, 700), cache_read_input_tokens: cacheRead, output_tokens: Math.ceil(spec.result.length / 3.5), service_tier: 'standard' } }, requestId: `req_${rng.hex(20)}`, uuid: rng.uuid(), timestamp: iso(Math.min(t, spec.at + spec.dur - 500)) })
  return recs
}

// ---- Codex writer ------------------------------------------------------------

function codexSession(rng, ctx, entry, sid, startMs, opts = {}) {
  const { cwd, branch, tasks } = ctx
  const iso = (ms) => new Date(ms).toISOString()
  const recs = []
  const history = []
  const push = (ms, type, payload) => recs.push({ timestamp: iso(ms), type, payload })
  const effort = entry.turns > 4 ? 'high' : 'medium'
  let t = startMs
  const source = opts.parent ? { subagent: { thread_spawn: { parent_thread_id: opts.parent, agent_role: opts.role, agent_nickname: opts.nickname, depth: 1 } } } : 'cli'
  push(t, 'session_meta', { id: sid, timestamp: iso(t), cwd, originator: 'codex_cli_rs', cli_version: CODEX_VERSION, instructions: null, source, model_provider: 'openai', git: { commit_hash: rng.hex(40), branch, repository_url: `https://example.com/demo/${ctx.name}.git` } })
  const total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 }
  const totalMs = entry.dur * 60000
  const perTurn = totalMs / entry.turns
  let ctxTokens = rng.int(9000, 15000)
  const off = entry.task ?? 0
  let title = null
  for (let i = 0; i < entry.turns; i++) {
    const turnStart = t
    const task = i < tasks.length ? tasks[(off + i) % tasks.length] : FOLLOWUPS_CODEX[(i - tasks.length) % FOLLOWUPS_CODEX.length]
    const prompt = i === 0 || i >= tasks.length ? task.prompt : `${rng.pick(['Next, ', 'Now ', 'Also: '])}${task.prompt[0].toLowerCase()}${task.prompt.slice(1)}`
    push(t, 'turn_context', { cwd, approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write', network_access: false, exclude_tmpdir_env_var: false, exclude_slash_tmp: false }, model: CODEX_MODEL, effort, summary: 'auto' })
    push(t, 'event_msg', { type: 'user_message', message: prompt, kind: 'plain' })
    push(t, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] })
    history.push({ session_id: sid, ts: Math.floor(t / 1000), text: prompt })
    if (i === 0) title = entry.thread ? task.title : snippet(prompt)
    if (i === 0 && entry.thread) push(t + 900, 'event_msg', { type: 'thread_name_updated', thread_name: task.title })
    t += rng.int(4, 12) * 1000
    if (task.reasoning) {
      push(t, 'response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: `**${task.title || 'Planning the change'}**\n\n${task.reasoning}` }], content: null, encrypted_content: rng.b64(160) })
      push(t, 'event_msg', { type: 'agent_reasoning', text: task.reasoning })
      total.reasoning_output_tokens += rng.int(120, 480)
      t += rng.int(3, 9) * 1000
    }
    for (const step of task.steps) {
      const callId = `call_${rng.b64(22).replace(/[+/]/g, 'x')}`
      if (step.tool === 'shell') {
        const cmd = ['bash', '-lc', step.cmd]
        push(t, 'response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: cmd, workdir: cwd, timeout_ms: 120000 }), call_id: callId })
        const dur = rng.int(1, 45) + rng.next()
        t += Math.round(dur * 1000)
        push(t, 'response_item', { type: 'function_call_output', call_id: callId, output: JSON.stringify({ output: step.out, metadata: { exit_code: step.exit ?? 0, duration_seconds: Math.round(dur * 10) / 10 } }) })
      } else {
        push(t, 'response_item', { type: 'custom_tool_call', status: 'completed', call_id: callId, name: 'apply_patch', input: step.patch })
        t += rng.int(1, 3) * 1000
        push(t, 'response_item', { type: 'custom_tool_call_output', call_id: callId, output: JSON.stringify({ output: `Success. Updated the following files:\n${step.add ? 'A' : 'M'} ${step.file}`, metadata: { exit_code: 0, duration_seconds: 0 } }) })
      }
      total.output_tokens += rng.int(90, 320)
      t += rng.int(5, 20) * 1000
    }
    push(t, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: task.reply }] })
    push(t, 'event_msg', { type: 'agent_message', message: task.reply })
    total.output_tokens += Math.ceil(task.reply.length / 3.6)
    // cumulative token_count after the turn
    const turnIn = ctxTokens + rng.int(2000, 9000)
    ctxTokens = turnIn
    total.input_tokens += turnIn
    total.cached_input_tokens += Math.round(turnIn * (0.55 + rng.next() * 0.3))
    total.total_tokens = total.input_tokens + total.output_tokens + total.reasoning_output_tokens
    const last = { input_tokens: turnIn, cached_input_tokens: Math.round(turnIn * 0.7), output_tokens: rng.int(300, 1400), reasoning_output_tokens: rng.int(80, 400), total_tokens: 0 }
    last.total_tokens = last.input_tokens + last.output_tokens + last.reasoning_output_tokens
    const payload = { type: 'token_count', info: { total_token_usage: { ...total }, last_token_usage: last, model_context_window: 258400 } }
    if (entry.rate) payload.rate_limits = { primary: { used_percent: 23 + i * 2, window_minutes: 300, resets_at: Math.floor((t + 3 * 3600000) / 1000) }, secondary: { used_percent: 41, window_minutes: 10080, resets_at: Math.floor((t + 4 * 86400000) / 1000) } }
    push(t, 'event_msg', payload)
    t = Math.max(t + rng.int(10, 50) * 1000, turnStart + perTurn)
  }
  const lastTs = new Date(recs[recs.length - 1].timestamp).getTime()
  return { recs, history, lastTs, title }
}

// ---- writing -------------------------------------------------------------------

const writeJsonl = (file, recs, mtimeMs) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n')
  if (mtimeMs) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs))
}
const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const pad = (n) => String(n).padStart(2, '0')
const rolloutName = (ms, id) => {
  const d = new Date(ms)
  return `rollout-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${id}.jsonl`
}

function claudeHomeExtras(home, platform) {
  writeText(path.join(home, 'settings.json'), JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(npm test:*)', 'Bash(git diff:*)', 'Read', 'Edit'], deny: [] }, statusLine: { type: 'command', command: platform === 'win32' ? 'node scripts/statusline-bridge.mjs' : 'scripts/statusline-bridge.sh' } }, null, 2) + '\n')
  writeText(path.join(home, 'CLAUDE.md'), '# Preferences\n\n- Small commits, conventional-commit subjects.\n- Run the relevant test file before saying something works.\n- Prefer editing an existing file to creating a new one.\n')
  writeText(path.join(home, 'skills', 'release-notes', 'SKILL.md'), '---\nname: release-notes\ndescription: Draft release notes from the commits since the last tag\n---\n\nRun `git log --oneline <last-tag>..HEAD`, group by type (feat / fix / docs), and write a short paragraph per group.\n')
}

function codexHomeExtras(home) {
  writeText(
    path.join(home, 'config.toml'),
    `model = "${CODEX_MODEL}"\nmodel_reasoning_effort = "medium"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n\n[features]\nweb_search_request = true\n\n[mcp_servers.docs-search]\ncommand = "npx"\nargs = ["-y", "@demo/docs-search-mcp"]\nstartup_timeout_sec = 20\n`
  )
  writeText(path.join(home, 'AGENTS.md'), '# Working agreements\n\n- Explain the plan in one paragraph before editing.\n- Keep patches focused; one concern per apply_patch.\n- Always run the affected tests.\n')
  writeText(path.join(home, 'skills', 'changelog', 'SKILL.md'), '---\nname: changelog\ndescription: Add a Keep-a-Changelog entry for the current change\n---\n\nAppend one bullet under `## [Unreleased]` in CHANGELOG.md describing the user-visible change.\n')
}

function memoryFor(home, slug) {
  const dir = path.join(home, 'projects', slug, 'memory')
  writeText(path.join(dir, 'MEMORY.md'), '# orbit-api — memory index\n\n- [API conventions](api-conventions.md) — error shape, pagination, idempotency\n- [Testing](testing.md) — node:test, one file per route, no real timers\n')
  writeText(path.join(dir, 'api-conventions.md'), '---\nname: api-conventions\ndescription: Error shape, pagination and idempotency rules for orbit-api\n---\n\nErrors are `{ error: string }`. Lists paginate with `?cursor=` and return `{ items, nextCursor }`. POSTs honour `Idempotency-Key` for 24 h.\n')
  writeText(path.join(dir, 'testing.md'), '---\nname: testing\ndescription: How tests are organised in orbit-api\n---\n\n`node --test`, one file per route under `test/`. Never rely on real timers — inject `sleep`.\n')
}

// ---- main ----------------------------------------------------------------------

export function generateFixture({ out = path.join(REPO, 'tmp', 'demo-root'), scenario = 'v2-highlights', seed = 42, now = Date.now(), platform = process.platform === 'win32' ? 'win32' : 'posix', force = false } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario "${scenario}" — one of ${SCENARIOS.join(', ')}`)
  out = path.resolve(out)
  // refuse to wipe a directory that is not one of ours
  if (fs.existsSync(out)) {
    const entries = fs.readdirSync(out)
    if (entries.length && !entries.includes('manifest.json') && !force) throw new Error(`${out} exists and is not a generated fixture (no manifest.json) — pass --force to replace it`)
    fs.rmSync(out, { recursive: true, force: true })
  }
  const rng = new Rng(Number(seed) >>> 0)
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime()
  const claudeHome = path.join(out, 'claude')
  const codexHome = path.join(out, 'codex')
  const agyHome = path.join(out, 'antigravity')
  fs.mkdirSync(path.join(claudeHome, 'projects'), { recursive: true })
  fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true })
  fs.mkdirSync(path.join(agyHome, 'brain'), { recursive: true })
  claudeHomeExtras(claudeHome, platform)
  codexHomeExtras(codexHome)

  const manifest = { generatedAt: new Date(nowMs).toISOString(), scenario, seed: Number(seed), platform, claudeHome, codexHome, agyHome, rootIds: { claude: idFor(claudeHome), codex: idFor(codexHome), antigravity: idFor(agyHome) }, projects: [], sessions: [] }
  const claudeHistory = []
  const codexHistory = []
  const agyHistory = []
  const agyLast = {} // cwd -> newest conversation id (cache/last_conversations.json)
  const projects = new Map()
  const projectCtx = (name, provider) => {
    const cwd = cwdFor(platform, name)
    if (!projects.has(name)) projects.set(name, { name, cwd, claudeSlug: claudeSlug(cwd), providers: new Set() })
    projects.get(name).providers.add(provider)
    return { name, cwd, branch: P[name].branch, tasks: P[name][provider] || P[name].codex } // agy borrows the Codex task scripts
  }

  const entries = schedule(scenario).map((e) => ({ ...e, start: startOf(e, nowMs) })).sort((a, b) => a.start - b.start)
  // each session of a project starts at a different task, so titles and first
  // prompts differ down a project's list (an explicit `task` wins)
  const taskCounter = new Map()
  for (const entry of entries) {
    const ctx = projectCtx(entry.project, entry.provider)
    const ck = `${entry.provider}|${entry.project}`
    if (entry.task == null) entry.task = (taskCounter.get(ck) || 0) % ctx.tasks.length
    taskCounter.set(ck, (entry.task + 1) % ctx.tasks.length)
    if (entry.provider === 'claude') {
      const sid = rng.uuid(4)
      const s = claudeSession(rng, ctx, entry, sid, entry.start)
      const slug = claudeSlug(ctx.cwd)
      const file = path.join(claudeHome, 'projects', slug, `${sid}.jsonl`)
      writeJsonl(file, s.recs, s.lastTs)
      claudeHistory.push(...s.history)
      const agents = []
      s.subagentFiles.forEach((spec) => {
        const agentId = rng.hex(7)
        const recs = claudeSubagent(rng, ctx, sid, spec, agentId)
        const dir = path.join(claudeHome, 'projects', slug, sid, 'subagents')
        writeJsonl(path.join(dir, `agent-${agentId}.jsonl`), recs, new Date(recs[recs.length - 1].timestamp).getTime())
        // the sidecar Claude Code writes next to an Agent/Task transcript; toolUseId is
        // the parent's tool_use block id (what links the call to its agent in the UI)
        writeText(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: spec.agentType || 'Explore', description: spec.description, toolUseId: spec.toolUseId, spawnDepth: 1 }, null, 2))
        agents.push(agentId)
      })
      if (P[entry.project].memory) memoryFor(claudeHome, slug)
      manifest.sessions.push({ provider: 'claude', id: sid, title: s.title, project: entry.project, slug, cwd: ctx.cwd, start: new Date(entry.start).toISOString(), end: new Date(s.lastTs).toISOString(), minutes: entry.dur, turns: entry.turns, toolCalls: s.recs.filter((r) => r.type === 'assistant' && r.message.content.some((b) => b.type === 'tool_use')).length, model: s.model, subagents: agents, file })
    } else if (entry.provider === 'antigravity') {
      const sid = rng.uuid(4)
      const s = agySession(rng, ctx, entry, sid, entry.start)
      const file = path.join(agyHome, 'brain', sid, '.system_generated', 'logs', 'transcript_full.jsonl')
      writeJsonl(file, s.recs, s.lastTs)
      writeText(path.join(agyHome, 'annotations', `${sid}.pbtxt`), `title:"${s.title.replace(/"/g, '\\"')}"\n`)
      const hasDb = agyWriteDb(path.join(agyHome, 'conversations', `${sid}.db`), { cwd: ctx.cwd, branch: ctx.branch, name: ctx.name, usage: s.usage })
      if (entry.title) writeText(path.join(agyHome, 'brain', sid, 'task.md'), `# ${s.title}\n\n- [x] read the routes and the auth plugin\n- [x] add the limiter\n- [x] run the order tests\n`)
      agyHistory.push(...s.history)
      if (!agyLast[ctx.cwd] || entry.start > agyLast[ctx.cwd].start) agyLast[ctx.cwd] = { id: sid, start: entry.start }
      manifest.sessions.push({ provider: 'antigravity', id: sid, title: s.title, project: entry.project, slug: ctx.cwd, cwd: ctx.cwd, start: new Date(entry.start).toISOString(), end: new Date(s.lastTs).toISOString(), minutes: entry.dur, turns: entry.turns, toolCalls: s.toolCalls, model: hasDb ? AGY_MODEL : AGY_MODEL_LABEL, subagents: [], file, sqlite: hasDb })
    } else {
      const sid = rng.uuid(7)
      const s = codexSession(rng, ctx, entry, sid, entry.start)
      const d = new Date(entry.start)
      const file = path.join(codexHome, 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()), rolloutName(entry.start, sid))
      writeJsonl(file, s.recs, s.lastTs)
      codexHistory.push(...s.history)
      const children = []
      if (entry.rate) {
        // one independent sub-agent rollout linked back through session_meta.source (see spec/DATA-MODEL.md)
        const childId = rng.uuid(7)
        const childEntry = { dur: 6, turns: 1, thread: false }
        const childCtx = { ...ctx, tasks: [{ prompt: 'Scan test/ for tests that use real timers (setTimeout without a fake clock) and list them.', title: 'Timer audit', reasoning: 'A grep over the test directory is enough here.', steps: [{ tool: 'shell', cmd: 'rg -n "setTimeout" test', out: 'test/webhooks.test.js:8:  await deliver({ url: \'https://example.com/hook\' }, { fetch: fetchStub, backoffMs: 50 })\ntest/jobs.test.js:22:  await new Promise((r) => setTimeout(r, 20))' }], reply: 'Two tests touch real timers: `test/webhooks.test.js` (indirectly, through `deliver()` back-off) and `test/jobs.test.js:22` (an explicit 20 ms sleep). The first is the flaky one; the second is harmless but could use a fake clock too.' }] }
        const c = codexSession(rng, childCtx, childEntry, childId, entry.start + 90000, { parent: sid, role: 'explorer', nickname: 'Scout' })
        const cf = path.join(codexHome, 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()), rolloutName(entry.start + 90000, childId))
        writeJsonl(cf, c.recs, c.lastTs)
        children.push(childId)
      }
      manifest.sessions.push({ provider: 'codex', id: sid, title: s.title, project: entry.project, slug: ctx.cwd, cwd: ctx.cwd, start: new Date(entry.start).toISOString(), end: new Date(s.lastTs).toISOString(), minutes: entry.dur, turns: entry.turns, toolCalls: s.recs.filter((r) => r.type === 'response_item' && (r.payload.type === 'function_call' || r.payload.type === 'custom_tool_call')).length, model: CODEX_MODEL, subagents: children, file })
    }
  }
  claudeHistory.sort((a, b) => a.timestamp - b.timestamp)
  codexHistory.sort((a, b) => a.ts - b.ts)
  writeJsonl(path.join(claudeHome, 'history.jsonl'), claudeHistory)
  writeJsonl(path.join(codexHome, 'history.jsonl'), codexHistory)
  agyHistory.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  writeJsonl(path.join(agyHome, 'history.jsonl'), agyHistory)
  writeText(path.join(agyHome, 'cache', 'last_conversations.json'), JSON.stringify(Object.fromEntries(Object.entries(agyLast).map(([cwd, v]) => [cwd, v.id])), null, 2) + '\n')
  agyHomeExtras(agyHome, Object.keys(agyLast))
  manifest.projects = [...projects.values()].map((p) => ({ ...p, providers: [...p.providers].sort() }))

  // the roots files the server reads: label "~/.claude" / "~/.codex" so the UI
  // reads like a fresh install rather than showing the fixture's absolute path
  fs.writeFileSync(path.join(out, 'roots.claude.json'), JSON.stringify([{ id: manifest.rootIds.claude, label: '~/.claude', dir: claudeHome }], null, 2))
  fs.writeFileSync(path.join(out, 'roots.codex.json'), JSON.stringify([{ id: manifest.rootIds.codex, label: '~/.codex', dir: codexHome }], null, 2))
  fs.writeFileSync(path.join(out, 'roots.antigravity.json'), JSON.stringify([{ id: manifest.rootIds.antigravity, label: '~/.gemini/antigravity-cli', dir: agyHome }], null, 2))
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

// ---- CLI -------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') o.force = true
    else if (a === '--help' || a === '-h') o.help = true
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i]
  }
  return o
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const a = parseArgs(process.argv.slice(2))
  if (a.help) {
    console.log('usage: node scripts/demo/make-fixture.mjs [--out tmp/demo-root] [--scenario v2-highlights|empty|single-project] [--seed 42] [--now <iso>] [--platform win32|posix] [--force]')
    process.exit(0)
  }
  try {
    const m = generateFixture({ out: a.out, scenario: a.scenario, seed: a.seed ?? 42, now: a.now ? new Date(a.now).getTime() : Date.now(), platform: a.platform, force: !!a.force })
    const rel = path.relative(process.cwd(), path.dirname(m.claudeHome)) || '.'
    console.log(`fixture: ${rel}  (scenario ${m.scenario}, seed ${m.seed}, ${m.platform} paths)`)
    console.log(`  claude: ${m.sessions.filter((s) => s.provider === 'claude').length} sessions, ${m.sessions.reduce((n, s) => n + (s.provider === 'claude' ? s.subagents.length : 0), 0)} sub-agent transcripts`)
    console.log(`  codex:  ${m.sessions.filter((s) => s.provider === 'codex').length} sessions, ${m.sessions.reduce((n, s) => n + (s.provider === 'codex' ? s.subagents.length : 0), 0)} sub-agent rollouts`)
    console.log(`  projects: ${m.projects.map((p) => `${p.name} (${p.providers.join('+')})`).join(', ') || 'none'}`)
    console.log(`\nserve it (bash):        AGENTDECK_CONFIG_DIR=${rel} AGENTDECK_PORT=47861 AGENTDECK_WEB_PORT=47862 node server/index.js`)
    console.log(`serve it (PowerShell):  $env:AGENTDECK_CONFIG_DIR='${rel}'; $env:AGENTDECK_PORT=47861; $env:AGENTDECK_WEB_PORT=47862; node server/index.js`)
  } catch (e) {
    console.error(`make-fixture: ${e.message}`)
    process.exit(1)
  }
}
