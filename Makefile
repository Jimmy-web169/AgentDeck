# AgentDeck — dev/run helpers.
# Usage: make init   (first-time setup), then   make all
PORT ?= 47841

.DEFAULT_GOAL := help
.PHONY: help init all be fe build install deps stop update

help: ## list targets
	@echo "AgentDeck:"
	@echo "  make init               first-time setup: npm deps + ttyd + check codex (OS-friendly)"
	@echo "  make all                ask whether to update provider CLIs [y/N], then backend + frontend (hot reload) -> http://localhost:47842"
	@echo "  make update             update every tracked provider CLI (claude / codex / agy update); AGENTDECK_SKIP_UPDATE=1 to skip"
	@echo "                          AGENTDECK_UPDATE=1 answers yes for 'make all'; a non-interactive shell skips the question"
	@echo "  make be                 backend (API) only              -> http://localhost:$(PORT)"
	@echo "  make fe                 frontend (Vite) only            -> http://localhost:47842"
	@echo "  make build              build frontend into dist/"
	@echo "  make install            npm install"
	@echo "  make deps               check node_modules against package.json (installs what is missing)"
	@echo "  make stop               free the API port ($(PORT))"

# first-time onboarding: installs Node deps + the optional ttyd (Terminal mode)
# via your OS package manager, and checks for the codex CLI. Safe to re-run.
init: ## one-shot setup (npm install + ttyd + codex check)
	@sh scripts/setup.sh

# keep every provider CLI current before the servers start — each CLI runs its
# own updater; failures only warn (set AGENTDECK_SKIP_UPDATE=1 to skip offline)
update: ## update every tracked provider CLI
	@node scripts/update-providers.ts

# Every start path runs scripts/check-deps.ts, which compares node_modules
# against package.json and the lockfile and installs what a pull added. Testing
# that node_modules merely exists is not enough: Vite reports itself ready and
# only fails per request, so a half-installed tree looks like a working dev
# server. The npm pre-hooks (predev/preserver/preweb/prebuild) own that guard, so
# `npm run dev` is covered too; `all` also calls it directly, to fail before the
# CLI-update question rather than after it.
#
# The CLI updaters are optional at startup: answer y to run them, Enter to start
# right away. AGENTDECK_UPDATE=1 / AGENTDECK_SKIP_UPDATE=1 answer without asking.
all: stop ## ask whether to update provider CLIs, then backend + frontend together (hot reload)
	@node scripts/check-deps.ts --install
	@node scripts/update-providers.ts --ask
	@npm run dev

be: stop ## backend / API server only (also serves dist/)
	@npm run server

fe: ## frontend Vite dev server only (proxies /api,/events,/chat to the backend)
	@npm run web

build: ## compile the frontend into dist/
	npm run build

install: ## install dependencies
	npm install

# Same guard the run targets use, on its own — for CI, or after a pull.
deps: ## verify node_modules matches package.json (installing what is missing)
	@node scripts/check-deps.ts --install --verbose

# free the API port first so `make all` / `make be` never hit EADDRINUSE.
# Uses a Node helper (not lsof) so it works on Windows too, where lsof is absent.
stop: ## kill whatever is listening on the API port
	@node scripts/free-ports.ts $(PORT)
