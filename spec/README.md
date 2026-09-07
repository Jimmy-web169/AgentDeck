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
| `providers/antigravity.yaml` | Antigravity (`agy`) descriptor | not here yet — a draft lives in `tmp/research/` until the hands-on findings are confirmed |

Validate a descriptor:

```
npx -y ajv-cli@5 validate --spec=draft2020 -s spec/provider.schema.json -d spec/providers/claude.yaml
```

## Where the roll-out stands (2026-09-07)

1. **Descriptors as documentation, schema-validated** — done. Nothing reads them at runtime yet.
2. **Conformance** — not started. The plan: `spec/fixtures/<id>/` with a minimal raw
   session and its `expected.normalized.json`; `npm run check:spec` validates the
   schema, then asserts the real parser reproduces the golden output. This is what
   stops a descriptor from rotting, and it is the next step.
3. **Server reads `capabilities` / `cli` / `probe` from the descriptor** — not started.
4. **Generic rule-driven parser** — not started; Antigravity is the intended test case.

The maintainer's discussion notes on how far to take the descriptor language
(record grammar, examples, versioning) are local, in `tmp/`.
