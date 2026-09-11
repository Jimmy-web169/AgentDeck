# `spec/` — the provider protocol layer

Everything that says *what a provider is* lives here, apart from the code that
implements one (`server/providers/<id>/`, `src/providers/<id>.jsx`). A new CLI
should be describable in this folder first and coded second.

| File | What it is | Status |
|---|---|---|
| `PROVIDER-SPEC.md` | The contract: normalized components, the descriptor layer, the code-side contract, known claude/codex misalignments, drift detection, MCP normalization, open decisions (§7) | draft, for discussion |
| `DATA-MODEL.md` | Per-provider description of what is on disk today (Claude Code, Codex) and how it maps onto the normalized model | maintained |
| `provider.schema.json` | JSON Schema 2020-12 for a descriptor — the machine-checked contract | validates both descriptors |
| `providers/claude.yaml` | Claude Code descriptor | validates; documentation only |
| `providers/codex.yaml` | Codex descriptor | validates; documentation only |
| `providers/antigravity.yaml` | Antigravity (`agy`) descriptor, from nine real runs; parser in `server/providers/antigravity/` | experimental; validates; fixture + golden |
| `fixtures/<id>/` | Fictional raw sessions (from `scripts/demo/make-fixture.ts`; hand-written from real record shapes for Antigravity) with the parser's golden output under `expected/` | claude, codex, antigravity |

Check everything (also part of `npm test` and `npm run release:check`):

```
npm run check:spec            # schema ✓, fixtures parse to their goldens ✓, vocabulary ✓
npm run check:spec -- --update   # after an intended parser change: rewrite the goldens, then review the diff
```

`check:spec` does three things: validates every descriptor against the schema;
parses every fixture session with the provider's real `parser.js` and compares
`summary` + `timeline` to the committed golden; and checks that the descriptor's
`timeline.map` kinds, `timeline.parts` and `tokens` fields describe everything the
parser actually emitted. A parser that starts producing something the descriptor
does not mention fails the gate — that is what keeps the descriptor honest.

## Where the roll-out stands (2026-09-07)

1. **Descriptors as documentation, schema-validated** — done.
2. **Conformance** — done (`check:spec`, above). Goldens are content-only (no
   mtimes or paths) so they are stable across machines.
3. **Format-drift probe** — done (2026-09-08): `server/shared/formatProbe.ts`
   runs each descriptor's `probe:` block over the newest files of every tracked
   root at startup / hourly / when a folder is added, compares with the
   descriptor and the baseline in `<configDir>/probe.<id>.json`, and flags the
   folder chip on `drift` (details, accept and re-check in the Folders dialog).
   Thresholds: PROVIDER-SPEC §5 / §7.4.
4. **Server reads `capabilities` / `cli` from the descriptor** — `probe` is read
   from it already; the rest after the Antigravity descriptor settles.
5. **Generic rule-driven parser** — later. Antigravity got a hand-written
   parser first (2026-09-08): its transcript needs adjacency pairing and a
   SQLite sidecar, which is exactly the kind of case the rule language will
   have to cover — see `hooks:` in its descriptor for what stayed in code.

The supported descriptor contract is defined by [provider.schema.json](provider.schema.json).
[PROVIDER-SPEC.md §7](PROVIDER-SPEC.md#7-decisions-to-make-together) distinguishes
the implemented conformance/probe checks from the proposed descriptor interpreter.
