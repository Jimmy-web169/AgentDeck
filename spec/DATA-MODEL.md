# AgentDeck — Data Model

AgentDeck reads the files a CLI coding agent already writes to disk; each
**provider** maps that agent's on-disk layout into shared shapes. Native
transcripts remain the source of conversation history. AgentDeck-owned
configuration, dashboard references and reviewed context handoffs are stored
separately; context snapshots do not overwrite provider-native transcripts.

## Shared contract

Every provider's backend implements the same output shapes (see `README.md` for
the full interface), so the frontend is layout-agnostic:

- **Root** — a tracked config home: `{ id, label, dir, exists, …probe }`.
- **Project** — a grouping of sessions: `{ slug, cwd, sessionCount, lastActivity }`.
- **Session summary** — `{ id, title, firstPrompt, lastUserPrompt, lastUserPromptTs, firstTs, lastTs, userTurns,
  assistantTurns, toolCalls, models, toolCounts, tokens, … }` (providers may add
  optional fields such as `cwd`, `contextWindow`, `lastTokenUsage`, `rateLimits`).
- **Timeline event** — `{ kind: 'user' | 'assistant' | 'system', ts, parts: [{ kind:
  'text' | 'thinking' | 'tool_call', … }] }`.
- **Sub-agent / child** — a session spawned by another, summarized the same way.
- **Usage** — `{ rateLimits, sessionId, ts, contextWindow? }` when available.

A session is addressed by an opaque `(slug?, id)` pair; the host never builds a
filesystem path from a slug — it always asks the provider, which keeps path
handling (and any traversal guard) inside the provider.

`lastUserPrompt` is a whitespace-normalized preview (up to 140 characters plus
an ellipsis) of the last recognized user question in native event order, not
the session title or last assistant/tool activity. `lastUserPromptTs` is that
question's native timestamp, or null when unavailable. Empty sessions use
`''` / `null`. Known image/document-only user records may use an attachment
placeholder; metadata-only records do not replace the previous question.
Codex prefers event messages over duplicate response items; Antigravity follows
`step_index`. Full question text remains available in the conversation timeline.

## Claude provider

| Thing | Location |
| --- | --- |
| Root | a Claude config dir (e.g. `~/.claude`), containing `projects/` |
| Session | `projects/<slug>/<id>.jsonl` (slug = a real project directory) |
| Sub-agents | nested under the parent: `projects/<slug>/<id>/subagents/agent-*.jsonl`, plus workflow runs under `subagents/workflows/wf_*/` |
| Transcript record | `{ type: 'assistant'|'user'|'system'|'attachment', message: { role, content, model, usage }, timestamp, isSidechain }` |
| Tool pairing | `tool_call` ↔ `tool_result` (raw: Claude `tool_use`) by `tool_use_id` |
| Usage limits | exposed only to a status line; an optional bridge writes `<root>/rate-limits.json` (see README) |

## Codex provider

| Thing | Location |
| --- | --- |
| Root | a Codex home (e.g. `~/.codex`), containing `sessions/` |
| Session | `sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`; the id is the trailing UUID, the slug is the session's `cwd` (synthesized grouping) |
| Sub-agents | independent top-level rollouts linked via `session_meta.source.subagent.thread_spawn.parent_thread_id` |
| Transcript record | wrapped `{ timestamp, type: 'response_item'|'event_msg'|'turn_context'|'session_meta', payload }` (or bare legacy records), normalized internally |
| Tool pairing | by `call_id`; token usage + context window + rate limits ride on `token_count` events |
| Memory / plugins | `memories_1.sqlite` (read via the `sqlite3` CLI) and `plugins/cache/**/plugin.json` |

## Writes

The only writes are user-initiated config edits (create/edit/delete a resource,
open a terminal) at a chosen scope, plus session **forks**
(`POST /api/<provider>/fork`): a fork copies a transcript up to a cut point
into a NEW session id — claude: truncate before a user record's `uuid`,
rewrite `sessionId`; codex: truncate before the N-th user prompt, rewrite
`session_meta.id` and the rollout filename — so `--resume <newId>` /
`codex resume <newId>` continues the branch in its terminal. The original
transcript is never modified. Resource deletes go to the OS trash
(recoverable). The server is localhost-only and never touches credentials.

Host collaboration APIs (`/api/deck/*`) also persist user-initiated dashboard
references and portable JSONL conversation exports. Exports are stored under
`<configDir>/.agentdeck/handoffs/`; the first `handoff` record describes the format,
origin project/provider, completeness and reading guidance without machine paths.
Conversation records retain branch identity/parentage, and message records retain
per-conversation ordering. Only visible user/assistant text is exported, including
available subagent transcripts. Full text is not clipped to a recent-N window.
The [file store](../server/deck/handoffStore.js) publishes immutable JSONL and
keeps small, separate runtime launch receipts with exclusive, fsynced claims.
There is no SQLite handoff store or staging/approval UI. Receipt files are local
execution bookkeeping; a moved JSONL remains readable without them. Explicit
send uses the source cwd, never a cwd inferred from portable metadata. Unknown
launches are checked by exact identity, never automatically replayed.
