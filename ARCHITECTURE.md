Before you add anything, check whether it already exists.

# AgentDeck architecture

This is the authoritative guide to module ownership and implementation rules.
[README.md](README.md) introduces the product; [CONTRIBUTING.md](CONTRIBUTING.md)
covers development; [spec/](spec/README.md) owns provider formats and contracts.

## Layers

AgentDeck is one local Node process and one React application. Node 22.18 or
newer runs the TypeScript server directly, without a server build. Vite builds
the browser application. The HTTP host binds to localhost.

| Owner | Responsibility |
| --- | --- |
| `spec/api/` | JSON Schemas for shared wire shapes; generate `shared/types.d.ts` |
| `spec/providers/`, `spec/fixtures/` | Native provider descriptors and parser goldens |
| `shared/` | Isomorphic identities, query keys, hash routing and constants; no Node, DOM or third-party runtime dependencies |
| `server/index.ts` | Process bootstrap, terminal registration, listening and shutdown |
| `server/http.ts` | Injectable HTTP/SSE host, static files, ETags and host-owned watcher lifecycle |
| `server/registry.ts` | Typed server provider registrations and capabilities |
| `server/shared/` | Dispatch, validation, roots, state paths, transcript caches, watchers, terminal mechanisms and native JSON guards |
| `server/providers/<id>/` | Provider DATA handlers, native paths/parsers/resources, terminal and skill adapters |
| `server/deck/` | Cross-provider Home, folder catalog, dashboards and conversation handoff |
| `src/api/` | The sole browser HTTP client, Query data, mutations, cache policy and SSE invalidation |
| `src/store/` | Local shell state, navigation, dialogs and terminal inventory subscriptions |
| `src/providers/` | Frontend metadata, addressing and presentation capabilities |
| `src/SessionApp.tsx` | Shared session lifecycle and provider presentation slots |
| `src/components/shared/sidebar/` | Sidebar frame, model, sections and row components |
| `src/lib/quickSwitcher.ts` | Home/project/folder search grouping and exact source-addressed drill-down; the shared QuickSwitcher owns keyboard, pointer and dialog rendering |
| `src/components/<id>/` | Provider-specific presentation |
| `src/lib/` | Pure UI helpers and hooks; existing preference stores retain browser persistence |

`shared/` imports only itself. The server and browser never import one another.
Native provider implementations do not import another provider's data layer.
The registries adapt capabilities to shared mechanisms; differences in native
formats belong in their adapters, not conditionals in shared views.

## Data and lifecycle ownership

One TanStack Query client owns server data. `src/api/fetcher.ts` owns conditional
GETs and preserves cached object identity on 304. Query keys come from
`shared/identity.ts`; mutation success invalidates the affected owner and scope.
One SSE connection batches changes and invalidates those same keys. Terminal
polling follows visibility; attaching a dashboard is an explicit command and
does not replay on focus or SSE events.

Zustand owns the shell's local state. Components select individual fields;
store modules do not import the API. `src/api/shell.ts` injects terminal services,
and UI hooks join successful server mutations to local navigation changes.
Existing preferences, pins and workspaces keep their persistence and cross-tab
storage synchronization. There is no `agentdeck:*` window event bus.

The HTTP host is independently constructible. Each host owns its SSE clients,
watchers, retry timers and mutation pause state. Provider imports declare
terminal configuration; only bootstrap registers providers with the process
terminal pool. Native transcript input stays `unknown` until narrowed. Parser
output is checked against the shared schema and exact fixture goldens.

## Files, private state and migrations

Use the existing owning layer before introducing a file or directory. Tests
mirror modules: `server/shared/state.ts` owns `test/server/shared/state.test.ts`.
HTTP scenarios belong in `test/integration/`; protocol and architecture checks
belong in `test/spec/`. Durable fixtures belong in `spec/fixtures/`.

`tmp/` contains pending experiments, diagnostics, screenshots, review evidence
and handoffs. Public promotion material belongs in `docs/`. Neither is an
application data directory. Provider-owned homes remain owned by the provider.

All new AgentDeck state uses the configured base's `.agentdeck/` directory:

| State | Owner under `.agentdeck/` |
| --- | --- |
| Tracked provider roots | `roots/<provider>.json` |
| Format probe baselines | `probe/<provider>.json` |
| Dashboard records | `dashboards/` |
| Briefs and portable conversation exports | `handoffs/` |
| Machine-local handoff launch receipts | `runtime/handoffs/` |

On every start `server/shared/state.ts` copies clean legacy roots/probe files
and handoff/dashboard directories into `.agentdeck/` and retains the originals,
so existing installations converge without an operator step while older
versions still find their files. A current owner takes precedence; conflicting,
malformed or blocked entries are left authoritative in place with a startup
warning; an interrupted directory copy retains the legacy view via a pending
marker.
Dashboard tmux socket identity remains based on its original configured-base
namespace, independent of the selected record directory.

```sh
npm run migrate:state -- --config-dir /path/to/config-base
# After reviewing the plan and stopping the service using that base:
npm run migrate:state -- --config-dir /path/to/config-base --apply
```

The default only inspects. Apply preflights conflicts and symlinks, verifies
source and destination bytes, copies without overwriting, and retains originals.
It also preserves empty directories. Startup performs the same clean copy
automatically; the command exists to inspect conflicts and to apply after they
are resolved by hand. Nothing silently merges competing stores or removes
legacy state. Brief retention removes only old Markdown briefs, never portable
JSONL exports.

## Enforced rules

⚙ identifies a repository check; ⏳ identifies a human review requirement.
Local exceptions name a concrete reason at the relevant statement.

1. **Dependency direction.** Respect the layer boundaries above. ⚙ Architecture tests.
2. **Identity compatibility.** Construct session, project, tab, terminal and
   query identities through `shared/identity.ts`; preserve persisted bytes. ⚙
   Architecture and identity tests.
3. **Shared contracts.** Update schemas and regenerate declarations when a
   wire shape changes. Review parser golden changes and descriptor vocabulary
   together. ⚙ Contract tests, `check:spec` and generated declaration checking.
4. **Client I/O.** HTTP, EventSource and polling belong in `src/api/`; browser
   persistence belongs in the existing stores. ⚙ Architecture tests.
5. **State ownership.** Server data belongs in Query; shell state belongs in
   Zustand. Do not reintroduce custom window events. ⚙ Architecture tests.
6. **Components.** Define components at module scope. Prefer files of at most
   400 lines; explain exceptions during review. UI chrome uses theme tokens;
   user-selected accent colors remain data. ⚙ Module-scope and Tailwind source
   coverage tests. ⏳ Size, visual design and theme review. The existing Claude
   Resources editor is a bounded 414-line exception: its selection and editor
   state remain together; definitions and guided creation already have owners.
   Existing HomeView (626), InsightsPage (871) and QuickSwitcher remain
   explicit size exceptions for their page/report/search composition.
   QuickSwitcher grouping now lives in the existing `src/lib/` layer so its
   presentation does not also own catalog/search composition. Its 436-line
   grouping model is a bounded size exception: local result types stay with the
   search projection so one owner defines both the rows and their grouping.
   The other pages
   keep their existing ownership; further feature growth requires
   reviewing extraction into existing shared owners. These are not examples
   of the preferred size for new components.
7. **Server requests and persistence.** Validate request boundaries, return
   data from handlers, and let dispatch/host own HTTP responses. New private
   state belongs under `.agentdeck/`; migrations preserve identities. ⚙ Route,
   state, lifecycle and integration tests; root-directory architecture guard.
8. **Provider capabilities.** Declare addressing and capabilities in provider
   descriptors/registries. Common routes come from `makeProviderRoutes(DATA)`.
   ⚙ Architecture and provider contract tests.
9. **Test ownership.** Keep one test owner per module; add cases there rather
   than creating feature-named test files. Behavior tests execute behavior;
   architecture constraints may inspect source. ⚙ Architecture tests.
10. **Documentation ownership.** Keep structure here, native formats in `spec/`,
    promotion in README/docs, and maintainer preferences in local instructions.
    Update CHANGELOG with the change. ⚙ Local instruction parity; ⏳ editorial review.

All maintained application code, scripts, tests and build configurations use
TypeScript or TSX. Four strict projects cover the server/shared boundary, the
complete UI, tools/configuration, and tests. `allowJs` is disabled; architecture
tests ensure every maintained source belongs to a checked project. Native Node
entry points use explicit `.ts` imports, type-only imports and erasable syntax;
Vite handles browser TSX and bundles its TypeScript PostCSS configuration.
Generated declarations receive a separate check without `skipLibCheck`, so a
missing referenced part cannot become silently unchecked. JavaScript embedded
in browser evaluation strings, generated artifacts and external dependencies
is runtime output, not an unchecked maintained module.

## UI invariants

- Home and session tabs share one persistent sidebar. Rows show pin and ⋯;
  destructive actions use the centered confirmation dialog.
- Scope is expressed by the sidebar's visible folder chips, with one set only.
  Home pages follow that scope. Do not add dropdown/checkmark scope pickers.
- Workspaces show a flat session list with source tags. Suggestions are facts
  without dismiss buttons. Pinning/grouping moves rows out of their source
  lists, retaining muted hints; duplicates are allowed only for search or a
  disabled destination section. A row may be both pinned and grouped.
- Insights describes personal rhythm and session shape; Stats owns token/tool
  totals and model mix. Keyboard hints remain visible without scrolling.
- Theme tokens own chrome colors. Accent values use `accentStyle`, generated
  provider classes and theme-supplied lightness. Cover light and graphite as
  well as midnight when reviewing visuals.
- A scoped feature must preserve the other modes and established layout. Tab
  shortcuts use Alt because browsers reserve Ctrl+T/W/Tab/1–9.

## Adding a provider

```sh
npm run new:provider -- example
npm test
```

The scaffold creates typed server owners, one frontend descriptor, a provider
YAML descriptor and a fixture README. It refuses existing destinations and adds
inactive TODOs to the three registries. Complete the DATA inventory, paths,
normalizers, resource capabilities, terminal configuration and presentation
slots before enabling it. No duplicate provider page is generated.

`test/spec/provider-contract.test.ts` checks every provider directory for its
DATA contract, server/metadata registration, valid descriptor and native/golden
fixtures. Frontend descriptor tests check addressing and presentation slots.
Run `check:spec`, inspect any golden changes, and run `check:providers` against
the actual CLI. The CLI check executes help/version probes, never sessions.

## Verification

`npm run release:check` runs raw Biome, generated declarations and all four strict
type projects, backend/UI/integration tests, the build, provider help checks,
privacy and parser contracts. There is no lint allowance baseline.

`npm run snapshot -- --label <label>` captures API responses and scene fingerprints
against synthetic fixtures under `tmp/`. `npm run check:layout` covers three
themes, three widths and Provider/Folder modes. Layout and text differences
must be explained; automated checks supplement visual inspection. Its baseline
in `scripts/layout-baseline.json` records which platforms observed each finding:
geometry rules read glyph metrics and stay scoped to those platforms, while a
contrast ratio is computed from colours alone, so one platform's capture speaks
for the rest. Reference copies can run their original JavaScript or current
TypeScript bootstrap.
Snapshot requires `AGENTDECK_CONFIG_DIR` pointing to a generated fixture;
see CONTRIBUTING for setup.

CI checks Linux, macOS and Windows, including the minimum Node version, and a
pinned Linux Chromium/font environment for layout. A local pass is not evidence
that a remote CI matrix has run. Never use live provider data for fixture checks.

## Decision records

- **Single package.** Shared code is a directory, not a separately released
  workspace package. Revisit only for independently deployed consumers.
- **Native HTTP.** Keep `node:http` with an injectable host; existing SSE,
  lifecycle and ETag behavior outweigh framework routing conveniences.
  A request's `AsyncLocalStorage` context carries its host-owned watcher gate
  through native mutations. Passing the gate through every provider helper
  would mix host lifecycle into data adapters; a global fallback would prevent
  isolation between hosts. Missing request context throws explicitly, while
  directly constructed gates remain independently testable.
- **Query without Router.** Query owns server data. Hash routing and the tab
  store preserve the existing multiple-tab model; reconsider a router if
  shareable navigation requires a different URL model.
- **Zustand shell.** Field selectors provide local state subscriptions without
  an event bus. Existing preference stores remain useful and retain storage sync.
- **JSON Schema authority.** The language-neutral provider contract generates
  TS declarations and validates runtime goldens. Do not add a competing schema
  library or manually edit generated declarations.
- **Two test runners.** Node tests cover server/shared/spec; Vitest supplies
  browser and JSX facilities. Shared helpers remove per-test transpiler setup.
- **Biome.** One formatter/linter owns style. The migration ratchet was
  temporary and is retired; exceptions are local and explained.
- **Explicit state migration.** Preserve bytes, root IDs and tmux namespaces.
  Migration is an inspectable operator action; removing fallback or legacy
  records requires a separate, tested decision.
- **Executable architecture.** AST/module guards report the owning alternative
  when a boundary is violated. Human review still owns scope and visual quality.
- **Singular docs.** Architecture ships here; local CLAUDE/AGENTS instructions
  retain maintainer preferences and are kept identical.
- **Deferred additions.** No monorepo, SSR, GraphQL, Redux or new routing
  framework is needed for this refactor. Revisit them for a concrete requirement.
