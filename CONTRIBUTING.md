# Contributing to AgentDeck

Thanks for helping out! AgentDeck is a local, provider-pluggable dashboard for
CLI coding agents. This guide covers the dev loop and how to add a new provider.

## Dev setup

```bash
npm install
npm run dev      # API server (:47841) + Vite UI (:47842), both hot-reload
```

- Backend: `node --watch server/index.js`. Frontend: Vite.
- `npm run build` bundles the UI into `dist/`; `npm start` serves it from the
  single API process.
- The server binds `127.0.0.1` only and rejects cross-origin browser requests.

## Layout

```
server/
  index.js              HTTP/WS/SSE host; routes /api/<provider>/… and /chat/<provider>
  registry.js           the provider registry
  shared/               cross-provider code (roots, dispatch, terminal pool, skills, origin, launch)
  providers/<id>/       a provider's data layer (paths, parser, resources, chat, …)
src/
  App.jsx               shell; the sidebar's provider dropdown toggles visibility (apps stay mounted)
  api.js                provider-aware client
  providers/<id>.jsx    a provider's frontend config (docs, tabs, components, …)
  components/shared/     shared, parameterized components
  components/<id>/       a provider's specific components
```

See `README.md` for the architecture and `DATA-MODEL.md` for on-disk shapes.

## Adding a provider

The provider-pluggable design means a new agent should not require shared-core
changes:

1. **Backend** — add `server/providers/<id>/` implementing the provider
   interface (see `README.md` and the existing providers): `paths`, `parser`, `resources`, a route table +
   `dispatch = makeDispatch(ROUTES)`, a `chatWss` (via `makeChatWss`), and
   `TERMINAL_CONFIG` / `SKILL_CONFIG` for the shared pools. Register it in
   `server/registry.js`.
2. **Frontend** — add `src/providers/<id>.jsx` (config object) and any
   provider-specific components under `src/components/<id>/`. Reuse the shared
   components where possible. Register it in `src/providers/index.js`.

## Guidelines

- Keep data-layout-specific code inside the provider; keep cross-cutting code in
  `server/shared/` and `src/components/shared/`.
- Writes only ever happen on explicit user action; deletes go to the OS trash.
- Match the surrounding code style; no build step beyond Vite is required.
