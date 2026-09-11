# AgentDeck — dev/run helpers.
# Usage: make init   (first-time setup), then   make all
PORT ?= 47841
CONTAINER_PORT ?= 47861
CONTAINER_IMAGE ?= agentdeck:local
CONTAINER_NAME ?= agentdeck-container
CONTAINER_STATE_VOLUME ?= agentdeck-container-state
CONTAINER_HOSTNAME ?= $(CONTAINER_STATE_VOLUME)
# Optional explicit mounts, e.g. --mount 'type=bind,src=/data/export,dst=/sources,readonly'
CONTAINER_RUN_ARGS ?=
CONTAINER_PROJECT_DIRS ?= []
export CONTAINER_PORT CONTAINER_IMAGE CONTAINER_NAME CONTAINER_STATE_VOLUME CONTAINER_HOSTNAME CONTAINER_PROJECT_DIRS

.DEFAULT_GOAL := help
.PHONY: help init all be fe build install stop update container-build container-up container-stop container-down container-logs container-status container-check container-plan container-import container-up-local

help: ## list targets
	@echo "AgentDeck:"
	@echo "  make init     first-time setup: npm deps + ttyd + check codex (OS-friendly)"
	@echo "  make all      update provider CLIs, then backend + frontend (hot reload) -> http://localhost:47842"
	@echo "  make update   update every tracked provider CLI (claude / codex / agy update); AGENTDECK_SKIP_UPDATE=1 to skip"
	@echo "  make be       backend (API) only              -> http://localhost:$(PORT)"
	@echo "  make fe       frontend (Vite) only            -> http://localhost:47842"
	@echo "  make build    build frontend into dist/"
	@echo "  make install  npm install"
	@echo "  make stop     free the API port ($(PORT))"
	@echo "  make container-build   build the production Docker image"
	@echo "  make container-up      start an isolated container -> http://localhost:$(CONTAINER_PORT)"
	@echo "  make container-plan    preview local settings and same-path read-only source mounts"
	@echo "  make container-import  copy local settings into an EMPTY state volume once"
	@echo "  make container-up-local start with imported roots at their original paths"
	@echo "  make container-stop    stop only the named container; keep it and its data"
	@echo "  make container-down    remove only the named container; keep its state volume"
	@echo "  make container-logs    follow container logs"
	@echo "  make container-status  show container state and published ports"

# first-time onboarding: installs Node deps + the optional ttyd (Terminal mode)
# via your OS package manager, and checks for the codex CLI. Safe to re-run.
init: ## one-shot setup (npm install + ttyd + codex check)
	@sh scripts/setup.sh

# keep every provider CLI current before the servers start — each CLI runs its
# own updater; failures only warn (set AGENTDECK_SKIP_UPDATE=1 to skip offline)
update: ## update every tracked provider CLI
	@node scripts/update-providers.ts

all: stop update ## update provider CLIs, then backend + frontend together (hot reload)
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
	@node scripts/free-ports.ts $(PORT)

# Container targets deliberately have no dependency on local stop/update/dev.
# Docker fails on an occupied port or existing name; never free either for it.
container-check:
	@case "$(CONTAINER_PORT)" in ''|*[!0-9]*) echo "CONTAINER_PORT must be an integer"; exit 1;; esac
	@test "$(CONTAINER_PORT)" -ge 1024 -a "$(CONTAINER_PORT)" -le 65535 || { echo "CONTAINER_PORT must be 1024..65535"; exit 1; }
	@test "$(CONTAINER_PORT)" -ne 47841 -a "$(CONTAINER_PORT)" -ne 47842 -a "$(CONTAINER_PORT)" -ne "$(PORT)" || { echo "CONTAINER_PORT must differ from local API/Vite ports"; exit 1; }

container-build:
	docker build --tag "$(CONTAINER_IMAGE)" .

container-plan:
	node scripts/container.ts plan

container-import:
	node scripts/container.ts import

container-up-local: container-check
	node scripts/container.ts up-local

container-up: container-check
	docker run --detach --init --name "$(CONTAINER_NAME)" --hostname "$(CONTAINER_HOSTNAME)" \
		--publish "127.0.0.1:$(CONTAINER_PORT):47841" \
		--mount "type=volume,src=$(CONTAINER_STATE_VOLUME),dst=/data/.agentdeck" \
		$(CONTAINER_RUN_ARGS) "$(CONTAINER_IMAGE)"
	@echo "AgentDeck container: http://localhost:$(CONTAINER_PORT)"

container-stop:
	docker stop --time 10 "$(CONTAINER_NAME)"

container-down:
	docker stop --time 10 "$(CONTAINER_NAME)"
	docker rm "$(CONTAINER_NAME)"

container-logs:
	docker logs --follow "$(CONTAINER_NAME)"

container-status:
	docker ps --all --filter "name=^/$(CONTAINER_NAME)$$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
