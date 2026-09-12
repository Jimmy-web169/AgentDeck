# Contributing to AgentDeck

AgentDeck is a local, provider-pluggable dashboard for CLI coding agents.
Use Node.js 22.18 or newer and install dependencies with `npm ci`.

Application modules, React views, tools, tests and build configurations are
TypeScript/TSX. Run `npm run check:types` to check all four strict projects and
generated contracts. Use explicit `.ts` imports for Node modules and `import
type` for erased declarations; enums, parameter properties and other syntax
requiring a TypeScript runtime transform are not supported. Browser TSX is
compiled by Vite. The test runner sends backend `.test.ts` files to native Node
and browser tests to Vitest; it accounts for every discovered test file.

## Dev setup

`npm run dev` starts the API on 47841 and Vite on 47842 with hot reload.
Its port-cleanup hook stops existing listeners, so use it only for your own
development instance. The backend runs TypeScript directly; Vite builds the UI.
`npm run build` creates `dist/`, and `npm start` serves it from the local API.
The server binds to localhost and applies the existing browser-origin guard.

To verify alongside an existing instance, build and run on separate ports:

```sh
npm run build
AGENTDECK_PORT=47851 AGENTDECK_WEB_PORT=47852 node server/index.ts
```

Stop only that verification process. Use synthetic configuration and provider
homes for tests; never point destructive tests at a real account or data store.

## Layout and adding a provider

[ARCHITECTURE.md](ARCHITECTURE.md) owns module boundaries, state paths, UI
invariants and the provider scaffold workflow. Start there before adding code.
[spec/](spec/README.md) owns provider formats and shared API contracts.
Provider-specific parsing stays with the provider; common routes and session
views are adapted through descriptors. Do not duplicate a whole provider app.

## Verifying a change

Use five gates for behavior-preserving refactors and substantial changes:

| Gate | Command / evidence | Acceptance |
| --- | --- | --- |
| G1 behavior | `npm run snapshot -- --label before`, then `--label after`; compare with `npm run snapshot -- --diff before after` | Empty API/layout/text diff for internal refactors; explain every intended difference individually |
| G2 tests | `npm test` | Zero failures; preserve existing cases and explain every retirement separately |
| G3 contracts | `npm run release:check` | Raw Biome, generated declarations, strict types, tests, build, provider probes, privacy and spec all pass |
| G4 layout | `npm run check:layout` (also captured by snapshot) | No added hard violations across the theme/width/mode matrix; visually inspect touched views |
| G5 independent review | Read-only review of the exact diff, report and fingerprints using `scripts/review-prompt.md` | Resolve findings and repeat G1–G4 after revisions; retain the final `NO FINDINGS` output |

Capture before changing the runtime and preserve the reference. Snapshots run
the captured runtime's own tests and use synthetic data. Never normalize away
an unexplained difference or update a baseline merely to make a check pass.
G4 runs on Linux in CI against a baseline whose entries name the platforms that
observed them, so a Windows or macOS pass is not evidence for that job; a
geometry finding recorded elsewhere still counts as new there, while a contrast
finding does not.
Test counts distinguish passed, skipped and failed cases; a skipped test is
not a pass. The historical minimum is 247 tests / 244 passes / 3 skips, and
later checkpoints must account for their additional cases too.

Before either snapshot, generate a fixture with
`node scripts/demo/make-fixture.ts --out tmp/snapshot-fixture` and set
`AGENTDECK_CONFIG_DIR=tmp/snapshot-fixture` in that process's environment.
Use the same fixture for both captures. Layout builds its own synthetic scenarios.

For the automated independent review, use Claude Opus 5 in plan mode with only
Read/Grep/Glob tools, and append the unchanged review criteria file. Supply a
bounded scope and evidence paths. Keep every round's output. Fix blockers and
should-fix findings; a disputed finding needs concrete source/test evidence.
After five rounds with unresolved blockers, report them for maintainer judgment.
The main contributor still reviews the final diff and each fingerprint change.

Backend tests mirror their modules under `test/server/`. Shared, script and
protocol tests have corresponding owners; browser behavior uses Vitest under
`test/ui/`, and cross-module flows belong in `test/integration/`. Reuse the
existing test helpers. Do not replace behavioral assertions with source scans;
source inspection is appropriate for architectural constraints.

For parser changes, run `npm run check:spec`. If an output change is intended,
use `npm run check:spec -- --update`, inspect the golden diff and update the
provider descriptor for changed kinds, parts or token fields. Shared wire
changes update `spec/api/`; run `npm run gen:types` and review the generated diff.
Afterward, generation must produce no further diff.

Preserve the [UI invariants](ARCHITECTURE.md#ui-invariants): one persistent
sidebar and one scope-chip set, moved rather than duplicated pinned/grouped
rows, centered destructive confirmation, theme-token chrome, distinct Insights
and Stats, visible keyboard hints and unchanged behavior outside the scope.
Check midnight, light and graphite, including narrow and wide layouts. The
mandatory Linux layout environment is pinned in `scripts/layout.Dockerfile`;
a local macOS check does not establish a remote CI result.

Include a review report with:

- Scope, changed owners, motivation and any explicitly approved plan amendments.
- G1 command and exact diff, with a disposition for every nonempty entry.
- G2 totals and case inventory, including skips and individually explained retirements.
- G3 final status of each check and any reviewed schema/golden changes.
- G4 reference/current violation counts, scene count and visual evidence.
- G5 final output and evidence paths, revision dispositions and remaining limitations.
- A short maintainer checklist for interaction review and any operator actions.

Keep pending evidence in `tmp/`; link maintained documentation to shipped files.
Update CHANGELOG with accepted code changes. Commit, push, release and data
migration are separate explicit actions; follow [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md)
when preparing an authorized release.
