# The layout gate owns its browser/fonts instead of inheriting a runner image.
# Keep this environment identical for local baseline captures and CI checks.
FROM node:22.20.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates git && rm -rf /var/lib/apt/lists/*
# Chromium's sandbox is unavailable in this disposable, fixture-only container.
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox "$@"\n' > /usr/local/bin/agentdeck-chromium && chmod +x /usr/local/bin/agentdeck-chromium
ENV CHROME_PATH=/usr/local/bin/agentdeck-chromium
WORKDIR /work
