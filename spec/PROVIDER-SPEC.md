# AgentDeck provider spec — DRAFT for discussion

Status: **draft, 2026-09-07** — machine-readable descriptors in `spec/`. Nothing here is enforced yet. It records what the
two existing providers (`claude`, `codex`) already share, where they silently
disagree, and the smallest normalized core a third provider (Antigravity `agy`,
next) should target. `DATA-MODEL.md` stays the per-provider description of what is
on disk; this file is the contract between a provider and the rest of AgentDeck.

Why now: every CLI vendor keeps its own on-disk format under `~/.claude`,
`~/.codex`, `~/.gemini/antigravity-cli`, … and there is no interchange standard
for *sessions*. The only shared standards are for packaging (Agent Plugins 1.0:
`plugin.json`, `skills/*/SKILL.md`, `mcp.json`) and for telemetry naming (OpenTelemetry
GenAI conventions: `execute_tool`, `invoke_agent`, `gen_ai.usage.*`). AgentDeck should
reuse those names where free and own the rest.

## 1. Core components

Field lists are the *minimum*. Optional fields are marked `?`. Names are the ones
already used in the code; renames are listed as decisions in §7.

| Component | Fields | Notes |
|---|---|---|
| `Root` | `id, label, dir, exists, hasData` | one neutral probe flag (today `hasProjects` vs `hasSessions`) |
| `Project` | `slug, cwd, sessionCount, lastActivity(ms)` | `slug` is opaque to the UI; only `cwd` is compared across providers |
| `SessionSummary` | `id, title, firstPrompt, lastUserPrompt, lastUserPromptTs, firstTs, lastTs, userTurns, assistantTurns, toolCalls, models[], toolCounts{}, tokens` + `cwd?, origin?('user'\|'subagent'), parentId?, childCount?, contextWindow?, mtime?, oversized?` | `origin`/`parentId` let sub-agents be plain sessions (codex) or nested (claude) |
| `Tokens` | `input, output, cacheRead, cacheCreate, reasoning, total` | **provider computes `total`; UI never re-derives it** (today three formulas disagree) |
| `TimelineEvent` | `kind('user'\|'assistant'\|'system'\|'attachment'), ts, id?` + `text` (user/system) or `model, usage?, parts[]` (assistant) | `id` nullable so codex can opt out explicitly |
| `Part` | `kind('text'\|'thinking'\|'tool_call')`; `tool_call` = `{id, name, input, result?{content, isError, meta?}, server?}` | matches OTel `tool_call` / `tool_call_response` one-to-one (raw vendor types stay: Claude `tool_use`, Codex `function_call`) |
| `Child` | `id, parentId, label, role?, depth?, summary: SessionSummary` | replaces claude `runs[]/agents[]` and codex `children[]`; workflow runs become optional `groups[]` |
| `Memory` | `scope('project'\|'thread'\|'user'), title, content, updatedAt?, writable` | claude = per-project `.md` (writable); codex = sqlite per thread (read-only) |
| `McpServer` | `name, scope('user'\|'project'\|'plugin'), sourcePath, transport('stdio'\|'http'\|'sse'\|'ws'), command?, args?, env?, cwd?, url?, headers?, enabled, toolAllow?, toolDeny?, raw` | never expand `${VAR}` secrets; show the literal template |
| `Instructions` | `kind('CLAUDE.md'\|'AGENTS.md'\|'GEMINI.md'), path, scope` | one resource kind, three file names |
| `Skill` | `name, path, description?, hasSkillMd` | Agent Skills spec is shared by every vendor |
| `Stats` | `root, projectCount, sessions, subagentSessions, userTurns, assistantTurns, toolCalls, toolCounts{}, modelCounts{}, tokens, projects[{slug, cwd, sessions, userTurns, toolCalls, tokens, models[], lastActivity}]` | keys already aligned; populations and token math are not (§4) |
| `Usage` | `rateLimits{windows[]}, ts(ms), sessionId?, contextWindow?` | one timestamp name |
| `HistoryEntry` | `display, ts(ms), sessionId?, project?` | normalize `ts` to ms server-side |
| `Activity` | output of `server/shared/activity.js` | already shared and unit-tested |

## 2. Descriptor layer (the protocol)

A provider is a **module**: one declarative descriptor plus a few code hooks.
The descriptor is what a human or an AI reads first; it says where the data is,
how records map onto the components in §1, what the CLI can do, and how to detect
that the vendor changed the format. Hooks implement only what a declaration cannot
(parsing quirks, sqlite, sidecar discovery). This mirrors how deepseek-harness
splits its runtime into swappable plugins: the core never knows a vendor, it only
consumes normalized components; every vendor-specific decision lives in one place.

```
spec/provider.schema.json      the contract (JSON Schema 2020-12, validated in CI)
spec/providers/claude.yaml     one descriptor per provider — YAML for readability
spec/providers/codex.yaml
server/providers/<id>/         hooks named in the descriptor: discover, parse,
                               subagents, memory, resources, api
```

Descriptor sections: `cli` (bin, version/update/resume argv, env home) ·
`roots` (default dirs, probe) · `projects` (directory / index / transcript grouping,
cwd source) · `sessions` (glob, id, format, envelope, title sources) · `timeline`
(ordered `when → kind` rules, part rules, tool-result pairing, noise) · `tokens`
(field paths, per-message vs cumulative, canonical `total`) · `subagents` (nested vs
independent sessions, spawn tool, link rule) · `memory` · `mcp[]` (path, format,
transport and field mapping) · `instructions` / `skills` / `plugins` · `usage` ·
`history` · `capabilities` (every feature graded `full | partial | read-only | none |
unknown`, so a gap is explicit and the UI hides what a provider lacks) · `probe`
(sample, required paths, enums, types, version field) · `hooks` · `known_unknowns`.

Roll-out plan:

1. **Now** — descriptors are documentation, validated against the schema in CI.
2. **Next** — a test per provider asserts the real parser agrees with the descriptor
   on fixtures (kind mapping, tool pairing, token fields). Drift between code and
   descriptor fails the build, so the descriptor cannot rot.
3. **Then** — the server loads `capabilities` and `cli` from the descriptor (the client
   registry's `capabilities`, `rateLimit`, terminal config move there) and runs the
   `probe` block for drift detection. Parsing stays in code until a generic
   rule-driven parser proves itself on a third provider (Antigravity is the test).

## 3. Provider contract (code side)

**Server** `server/providers/<id>/`: `paths.js` (roots via `makeRoots`, session
discovery, head read for `cwd`), `parser.js` (`readRecords` guarded by
`guardTranscriptSize`, `buildTimeline`, `summarize`), `resources.js` (`inventory()` +
CRUD for its config kinds), `api.js` (`TERMINAL_CONFIG {findBin, title, envKey,
resumeArgs, checkOrigin}`, a `ROUTES` map covering the 29 shared routes, one
`fingerprintOf` per file before any read, `withOversizeFallback` on every list/stats
handler, `export const dispatch = makeDispatch(ROUTES)`), one entry in
`server/registry.js`, `roots.<id>.json`.

Shared routes (both providers today): `roots` (GET/POST/DELETE, `POST roots/label`),
`projects`, `sessions`, `session`, `DELETE session`, `raw`, `subagents`, `stats`,
`activity`, `history`, `memory`, `plugins`, `usage`, `version`, `resources`
(GET/POST/DELETE), `skill-run`, `open`, `browse`, `pick-folder`, `terminal`
(POST/DELETE), `terminals`, `live-terminals`, `active-sessions`.
Claude-only today: `GET subagent`, `GET resource`, `POST/DELETE memory`.

**Client** `src/providers/<id>.jsx`: the registry keys `id, label, App, accent,
color, docsBase, docsMap, ns, thinkingLabel, rootStatusField, apiAddr, sessionTabs,
homePages, rateLimit, contextMeter, capabilities, rawTypeOf, components`, plus
`src/components/<id>/` with `Conversation, ToolCall, Resources, NewResourceForm,
SubagentsView, MemoryView, PluginsView, SkillImport, RateLimitsBar` and
`HomePages.jsx` exporting `HOME_PAGES`.

Addressing is the one real fork: claude routes take `(slug, id)`, codex takes `id`
and derives `slug` from the transcript. `apiAddr` in the registry hides it from the
shell; keep it that way.

## 4. Known misalignments (work items)

1. ~~Three total-token formulas disagree~~ **done 2026-09-07** — `server/shared/tokens.js`: the provider computes `tokens.total`; clients only fall back to the sum. Was: (`lib/format.js`, `shared/Stats.jsx`,
   `shared/activity.js`) whenever `total` is present or `reasoning` ≠ 0, i.e. always
   for codex. Fix: providers emit `tokens.total`; one helper reads only that.
2. ~~Codex `getStats` mixes populations~~ **done 2026-09-08** — every provider's stats carry `sessions` (top-level) and `subagentSessions` (spawned children) per project and at the root; turns and tokens add up over both, so root = Σ projects (`test/provider-shapes.test.js`). Was: per-project `sessions` excludes
   sub-agents, the token/turn loop includes them, so root `sessions` ≠ Σ projects.
   Fix: emit `sessions` and `subagentSessions` separately, same population everywhere.
3. ~~Two Stats components~~ **done 2026-09-08** — `shared/Stats.jsx` serves every provider (`providerLabel` prop); `codex/Stats.jsx` is gone. Was — *partly done 2026-09-07*: both now render the token tiles through `shared/TokenTiles.jsx` from `GET /api/stats` `fields` (common first, then provider-specific); the remaining differences below still stand. Was: (`shared/Stats.jsx` vs `codex/Stats.jsx`): "user
   prompts"/"Prompts", "cache read"/"Cached input", "Tool usage"/"Tools used", model
   chips (counts dropped) vs bars, `cacheCreate` tile always 0 for codex, reasoning
   only for codex, `assistantTurns` shown only by codex, session id/time range only
   by codex. Fix: one Stats component driven by the `Stats` shape above; hide
   zero-valued tiles instead of provider-specific tiles.
4. ~~`GET /api/memory` means two different things~~ **done 2026-09-08** — every provider's payload carries `scope` (`project` | `thread` | `artifacts`) and `writable`; the per-provider bodies (`index`/`files`, `memories`) stay. Was: writable project notes vs
   read-only thread memories. Fix: `Memory` component above with `scope` + `writable`.
5. ~~history / usage / roots / plugins vocabulary~~ **done 2026-09-08** — `history[]` = `{ display, project, sessionId, ts }` (ms) on every provider (codex resolves `project` from its rollout index); `usage` = `{ root, rateLimits, contextWindow, sessionId, ts }`; roots carry `hasSessions`; `plugins.marketplaces` = `[{ name, repo }]`. Was: `history.project` (claude) vs `history.sessionId` (codex), ISO vs ms `ts`;
   `usage.updatedAt` vs `ts`; `roots.hasProjects` vs `hasSessions`;
   `plugins.marketplaces` objects vs strings.
6. ~~`GET /api/browse` and `pick-folder` are byte-identical copies~~ **done 2026-09-08** — `server/shared/browse.js`.
7. ~~Codex `getStats`/`getActivity` skip the fingerprint~~ **done 2026-09-08** — one `fingerprintOf` per file before the read, as claude does.
8. Home aggregation **revised 2026-09-09** — Provider mode preserves native root-scoped pages; Folder mode aggregates registered roots using the sidebar's provider/root exclusions. Stats drills through folders and sources, or uses native detail directly for a single root. Insights retains the complete overview without extra folder dashboards; Plugins/Resources/History remain source-owned. See §9.

## 5. Format-drift detection

Vendors change their on-disk formats without notice. The `probe:` block of each
descriptor (`spec/providers/<id>.yaml`) says what to watch — **implemented
2026-09-08** in `server/shared/formatProbe.js`, which reads that block at runtime:

```yaml
probe:
  sample: { glob: "projects/*/*.jsonl", newest: 5, head: 200, tail: 200 }
  required: [type, timestamp, uuid, sessionId]     # dotted paths every record carries
  enums: { type: [user, assistant, system, summary, …] }   # observed values ⊆ set
  types: { "message.usage.input_tokens": number }
  version_field: version
```

The newest files of every tracked root are sampled at startup, hourly, and when a
folder is added (never on hot reads); the observed key set / enum values / types are
fingerprinted and compared with the descriptor and with the baseline stored in
`<configDir>/probe.<id>.json`. Status per root, attached to `GET /api/roots`:

| status | meaning | shown |
|---|---|---|
| `baseline` | first sample of this root, stored | Folders dialog |
| `ok` | matches the descriptor and the baseline | Folders dialog |
| `changed` | keys the baseline never saw, or a listed enum value seen for the first time | Folders dialog (“format changed”), log |
| `drift` | a required key in fewer than half the sampled records, an enum value the descriptor does not list, a type that changed | **badge on the folder chip**, Folders dialog with the details, `accept` / `re-check` |
| `empty` | nothing to sample yet | — |

Thresholds (decision 4 below, 2026-09-08): a new optional key is not worth a badge —
warn only on what every consumer of the format needs. `POST /api/probe/accept`
makes the current shape the baseline; `POST /api/probe/run` re-samples now.
`test/format-probe.test.js` lays the spec fixtures out as homes and breaks the
format the way a vendor would.

## 6. MCP config normalization

| Provider | Where | Shape → `McpServer` |
|---|---|---|
| Claude Code | `~/.claude.json` (`mcpServers`, `projects[cwd].mcpServers`), `.mcp.json`, plugin `.mcp.json` | `type?` `stdio\|http\|sse\|ws` (default stdio); `command/args/env` or `url/headers` |
| Codex | `~/.codex/config.toml` `[mcp_servers.<name>]` | `command/args/env` or `url`; `enabled`, `enabled_tools`→`toolAllow`, `disabled_tools`→`toolDeny`, `startup_timeout_sec` |
| Gemini CLI | `~/.gemini/settings.json` `mcpServers` | `command` or `url` (sse) or `httpUrl` (http) |
| Antigravity | `~/.gemini/config/mcp_config.json`, `.agents/mcp_config.json` | `serverUrl`→`url`, `disabled`→`!enabled`, `disabledTools`→`toolDeny` |
| Agent Plugins 1.0 | `<plugin>/mcp.json` | `type` required: `stdio\|streamable-http\|sse`; `${PLUGIN_ROOT}` |

Precedence when the same name appears twice: local > project > user > plugin.

## 7. Decisions to make together

1. ~~Rename `tool_use` → `tool_call`~~ — done 2026-09-07 (the normalized part kind is `tool_call`; raw vendor types unchanged). (rename touched
   every Conversation/ToolCall component)
2. ~~Sub-agents: one `children[]`~~ **done 2026-09-07** (`server/shared/children.js`; `groups[]` for workflow runs; provider lists kept so the UI is unchanged). Was: one `children[]` for both providers, with claude workflow runs as an
   optional `groups[]` — agree?
3. **decided 2026-09-07**: show the common fields first, then the provider's own, and the backend must say which is which (`fields` on `/api/stats`). Was: should the UI ever show provider-specific tiles (reasoning, cache create) or only
   non-zero fields of the common `Tokens`?
4. **decided 2026-09-08**: no — a new optional key is `changed` (dialog + log only); `drift` = missing required key (< 50% of sampled records), unknown enum value, type change (chip badge). Was: is a new optional key worth a badge?
5. **decided 2026-09-08**: yes — codex thread memories live under the same project Memory tab, marked read-only (`writable: false` in the payload). Was: expose codex thread memories under the same project tab (read-only) — yes?
6. **decided 2026-09-08**: yes — conversations without a `cwd` sit in a "(no workspace)" bucket (`NO_CWD` in the provider's paths.js); a later probe may recover the cwd. Was: Antigravity's transcripts carry no `cwd`; do we accept a "no project" bucket?

## 7b. AI hand-off (implemented 2026-09-08)

AgentDeck does not call models. `cli.prompt` in the descriptor is the argv that
starts the CLI interactive and seeded (`claude "<prompt>"`, `codex "<prompt>"`,
`agy -i "<prompt>"`); `POST /api/terminal` with a `brief` object writes
`<configDir>/handoffs/<id>.md` (request, kind, file, current content, official
docs URL from the UI's docs map, how to work) and starts the terminal with a
one-line prompt pointing at that file (`server/shared/handoff.js`). Capability
`ai_handoff`. Entry points: the three Config views (current selection as
context) and Insights (the digest as context).

## 7c. Portable conversation JSONL (host service, 2026-09-09)

This is separate from the config-assistance `brief` above. The registry declares
`capabilities.readTimeline` and `capabilities.interactiveContext`; an optional
`validateContextTarget(root)` adapter rejects unsupported execution homes before
launch (for example Antigravity's non-CLI data root). A provider that does not
declare these capabilities is unsupported, not guessed from its name.

The registry's `history` adapter provides `read(source)` (fingerprinted timeline)
and `children(source)` (child locators). Independent-session providers recurse;
nested-sidecar providers enumerate the owner's sidecars and resolve exact parent
spawn IDs before stripping tool events. No provider-specific storage branching
is needed in the UI. Unresolved/missing child histories are recorded explicitly.

The host captures the full locally available visible conversation graph, checking
stability across whole-graph reads, then writes a self-contained JSONL with one
`handoff` header, conversation descriptors, and ordered message records. There
is no SQLite or draft/approval lifecycle. Exports carry no cwd/root paths as
metadata; original message text is preserved. Incomplete exports cannot launch.
The source cwd is private local runtime metadata, not inferred from imported
history. A fsynced exclusive file claim commits launch intent before spawning;
only an in-process `HANDOFF_LAUNCH` grant can authorize a `handoffExportId` and
matching launch/target. The provider uses its own `promptArgs` and normal
permissions; no vendor-native transcript is imported or overwritten.

See the [host collaboration layer](../server/deck/) for state, retention and
unknown/reconcile semantics. Provider capability declarations alone do not
establish real CLI transport compatibility; validate each adapter interactively.

## 8. Reference

- Agent Plugins 1.0 — https://agent-plugins.org/ (packaging only; Anthropic absent)
- Agent Skills — https://agentskills.io/ (shared by every vendor)
- OpenTelemetry GenAI semantic conventions — https://opentelemetry.io/docs/specs/semconv/gen-ai/
- deepseek-ai/deepseek-harness — plugin-per-concern harness; session log = append-only typed events with `seq`, messages derived
- Research notes (local, git-ignored): `tmp/research/standards-2026-09.md`, `tmp/research/antigravity-*.md`; provider audit 2026-09-07 folded into §4

## 9. Cross-source Home adapter

The server registry may expose a `home` adapter for cross-source Home pages.
This is distinct from the interactive history/handoff adapter and from the
provider's native UI `homePages`. The shared service lives in
`server/deck/home.js`; the reusable dispatch adapter is
`server/deck/homeAdapter.js`. No provider ID switches belong in aggregation.

The resolver supplies `{ provider, root, rootLabel, allProjects: true }` for
each registered root. Folder catalog availability and sidebar filters are not
dependencies of these reads. Roots without conversations still supply user
resources and plugins. Legacy explicit adapter project filters remain supported:
an empty projects array without `allProjects` means no projects, never all.

Optional reader methods (unsupported methods produce source-level notices):

| Method | Result contract |
| --- | --- |
| `stats(source)` | `{ projects, fields: { common, specific }, incomplete? }`; per-project counters and provider-computed token totals, filtered before aggregation |
| `insights(source)` | `{ records }`; project-native session summaries with IDs, timestamps, counts, `isSubagent` and `oversized` flags |
| `history(source)` | `{ history, coverage? }`; unpaginated native prompts with stable source-local `rowId`, optional `sessionId`, `project`, `ts`, `display` |
| `plugins(source)` | `{ installed, marketplaces? }`; keep enabled state unknown when it is not reported |
| `resources(source, project?)` | `{ items: [{ label, names }], readOnly, base }`; metadata only; omitted project means User scope |

`statsNote` describes the provider's actual accounting population. The common
dispatch adapter requests `home=1`; explicit project-scoped callers may also supply `slugs=<JSON array>` and `cwds=<JSON array>`.
Native Stats and Activity handlers filter the slugs before scanning. Home
Activity returns records instead of pre-aggregated daily buckets; legacy callers
retain their original response. Native History filters before the legacy
500-record limit; `coverage` reports unattributed, malformed and unreadable data.

`GET /api/deck/home` accepts `view`, JSON `excluded` provider IDs, optional
`excludedRoots` (JSON array of canonical `JSON.stringify([provider, root])`
keys), optional
History `search`/`cursor`, and `fresh=1`. Legacy `folder`/`unavailable`
parameters do not narrow the read. Source identities remain exact
`(provider, root, sessionId)`; Stats/Insights include canonical folder breakdowns
alongside overall totals. Unresolved folders remain source-specific.
History retains unattributed/old-folder prompts. Cursors bind to the query and
config directory and expire after two minutes. No reader invokes a writer.

Client Home follows the sidebar preference. Provider mode uses the selected
provider/root's native `homePages` and the complete shared Insights page. Folder
mode reads all registered roots except providers or exact roots excluded in the sidebar;
there is no second filter row or independent per-tab scope. Legacy `homeScope`
links still parse but cannot override the sidebar. An explicit `homeSource`
in Folder mode opens native User resources or plugins with exact ownership.

Stats drill-down reuses the provider's `homePages.stats`, whose optional props
`initialProject` (native slug), `breadcrumbPrefix` and `embedded` provide a
project entry point within Folder mode. Existing `root`, `focus`, `onOpen`
behavior stays unchanged when these props are absent. Providers forwarding to
shared `Stats` should forward all three optional props. A provider without a
detail page gets an explicit unsupported state, never another provider's page.
With one selected root, Stats renders that root's registered native page without
an initial project. Count the selected scope, not successful reads: an unreadable
second root must not trigger this shortcut. A folder with one member opens its
native project details directly. Root exclusions apply before adapter reads and
participate in cache and History cursor identity; same-named roots in different
providers never share a filter identity.

Insights folder breakdowns include `sources`, each with exact provider/root,
native `slug`/`cwd`, and recomputed `activity`. The global and folder summaries
use canonical folder keys; source details retain native project slugs for
navigation. These remain response metadata; the UI shows only the complete global
Insights presentation, including its original Needs attention section, without
additional folder/source dashboards.
Project configuration stays in the native project Config view. No standalone
Folder detail route or endpoint remains; `/api/deck/folders` is catalog metadata.
