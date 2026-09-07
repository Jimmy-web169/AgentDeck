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
| `SessionSummary` | `id, title, firstPrompt, firstTs, lastTs, userTurns, assistantTurns, toolCalls, models[], toolCounts{}, tokens` + `cwd?, origin?('user'\|'subagent'), parentId?, childCount?, contextWindow?, mtime?, oversized?` | `origin`/`parentId` let sub-agents be plain sessions (codex) or nested (claude) |
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

1. **Three total-token formulas disagree** (`lib/format.js`, `shared/Stats.jsx`,
   `shared/activity.js`) whenever `total` is present or `reasoning` ≠ 0, i.e. always
   for codex. Fix: providers emit `tokens.total`; one helper reads only that.
2. **Codex `getStats` mixes populations**: per-project `sessions` excludes
   sub-agents, the token/turn loop includes them, so root `sessions` ≠ Σ projects.
   Fix: emit `sessions` and `subagentSessions` separately, same population everywhere.
3. **Two Stats components** (`shared/Stats.jsx` vs `codex/Stats.jsx`): "user
   prompts"/"Prompts", "cache read"/"Cached input", "Tool usage"/"Tools used", model
   chips (counts dropped) vs bars, `cacheCreate` tile always 0 for codex, reasoning
   only for codex, `assistantTurns` shown only by codex, session id/time range only
   by codex. Fix: one Stats component driven by the `Stats` shape above; hide
   zero-valued tiles instead of provider-specific tiles.
4. `GET /api/memory` means two different things (writable project notes vs
   read-only thread memories). Fix: `Memory` component above with `scope` + `writable`.
5. `history.project` (claude) vs `history.sessionId` (codex), ISO vs ms `ts`;
   `usage.updatedAt` vs `ts`; `roots.hasProjects` vs `hasSessions`;
   `plugins.marketplaces` objects vs strings.
6. `GET /api/browse` and `pick-folder` are byte-identical copies → move to shared.
7. Codex `getStats`/`getActivity` skip the fingerprint that claude threads through,
   so cross-provider refreshes see different freshness.
8. The cross-folder aggregated view the user wants (all tracked folders of all
   providers on one Stats page) is blocked only by items 1–3.

## 5. Format-drift detection

Vendors change their on-disk formats without notice. Each provider ships a
declarative `probe.js`:

```js
export const PROBE = {
  version: 1,
  files: { glob: 'projects/*/*.jsonl', newest: 5, head: 200, tail: 200 },
  required: ['type', 'timestamp', 'message.role'],           // dotted paths, must exist
  enums: { type: ['user', 'assistant', 'system', 'summary'] }, // observed values ⊆ set
  types: { 'message.usage.input_tokens': 'number' },
  sidecars: ['subagents/agent-*.jsonl'],
}
```

`server/shared/formatProbe.js` samples the newest files, canonicalizes the observed
key set / enum values / types, hashes it, and compares with the fingerprint stored
in `roots.<id>.json`: `baseline` (first run) · `ok` · `changed` (new optional keys →
info badge) · `drift` (missing required key, unknown enum value, type change → banner
on the folder chip and an entry on Home › Activity with "mark as expected"). Runs at
startup and hourly, never on hot reads, through the existing `makeRoots({ dataProbe })`
seam. One frozen fixture per known format generation lives under `test/probe/` so
the probe itself is unit-tested. `make all` already updates the CLIs first; the probe
tells the user the same morning when the update changed what is on disk.

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
2. Sub-agents: one `children[]` for both providers, with claude workflow runs as an
   optional `groups[]` — agree?
3. Should the UI ever show provider-specific tiles (reasoning, cache create) or only
   non-zero fields of the common `Tokens`?
4. Drift `changed` vs `drift` thresholds: is a new optional key worth a badge?
5. Memory: expose codex thread memories under the same project tab (read-only) — yes?
6. Antigravity: its transcripts carry no `cwd`; do we accept a "no project" bucket?

## 8. Reference

- Agent Plugins 1.0 — https://agent-plugins.org/ (packaging only; Anthropic absent)
- Agent Skills — https://agentskills.io/ (shared by every vendor)
- OpenTelemetry GenAI semantic conventions — https://opentelemetry.io/docs/specs/semconv/gen-ai/
- deepseek-ai/deepseek-harness — plugin-per-concern harness; session log = append-only typed events with `seq`, messages derived
- Research notes (local, git-ignored): `tmp/research/standards-2026-09.md`, `tmp/research/antigravity-*.md`; provider audit 2026-09-07 folded into §4
