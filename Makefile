# AgentDeck — dev/run helpers.
# Usage: make init   (first-time setup), then   make all
PORT ?= 47841

.DEFAULT_GOAL := help
.PHONY: help init all be fe build install stop

help: ## list targets
	@echo "AgentDeck:"
	@echo "  make init     first-time setup: npm deps + ttyd + check codex (OS-friendly)"
	@echo "  make all      backend + frontend, hot reload  -> http://localhost:47842"
	@echo "  make be       backend (API) only              -> http://localhost:$(PORT)"
	@echo "  make fe       frontend (Vite) only            -> http://localhost:47842"
	@echo "  make build    build frontend into dist/"
	@echo "  make install  npm install"
	@echo "  make stop     free the API port ($(PORT))"

# first-time onboarding: installs Node deps + the optional ttyd (Terminal mode)
# via your OS package manager, and checks for the codex CLI. Safe to re-run.
init: ## one-shot setup (npm install + ttyd + codex check)
	@sh scripts/setup.sh

all: stop ## backend + frontend together (hot reload)
	@test -d node_modules || { echo "Dependencies not installed — run 'make init' first."; exit 1; }
	@npm run dev || { echo ""; echo "'make all' failed. If this is a fresh checkout, run 'make init' first to set up dependencies."; exit 1; }

be: stop ## backend / API server only (also serves dist/)
	@test -d node_modules || { echo "Dependencies not installed — run 'make init' first."; exit 1; }
	@npm run server || { echo ""; echo "'make be' failed. If this is a fresh checkout, run 'make init' first to set up dependencies."; exit 1; }

fe: ## frontend Vite dev server only (proxies /api,/events,/chat to the backend)
	@test -d node_modules || { echo "Dependencies not installed — run 'make init' first."; exit 1; }
	@npm run web || { echo ""; echo "'make fe' failed. If this is a fresh checkout, run 'make init' first to set up dependencies."; exit 1; }

build: ## compile the frontend into dist/
	npm run build

install: ## install dependencies
	npm install

# free the API port first so `make all` / `make be` never hit EADDRINUSE.
# Uses a Node helper (not lsof) so it works on Windows too, where lsof is absent.
stop: ## kill whatever is listening on the API port
	@node scripts/free-ports.mjs $(PORT)
