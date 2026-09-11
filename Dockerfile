# syntax=docker/dockerfile:1
# Override with an approved tag or digest when a fixed base is required.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /opt/agentdeck
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS build
WORKDIR /opt/agentdeck
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts postcss.config.ts tailwind.config.ts ./
COPY tsconfig*.json ./
COPY scripts/postcss-font-units.ts ./scripts/
COPY src ./src
COPY shared ./shared
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    AGENTDECK_HOST=0.0.0.0 \
    AGENTDECK_PORT=47841 \
    AGENTDECK_CONFIG_DIR=/data
WORKDIR /opt/agentdeck
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/.agentdeck \
    && chown -R node:node /data
COPY package.json ./
COPY --from=dependencies /opt/agentdeck/node_modules ./node_modules
COPY --from=build /opt/agentdeck/dist ./dist
COPY server ./server
COPY shared ./shared
COPY spec/providers ./spec/providers
COPY scripts/container.ts ./scripts/container.ts
USER node
EXPOSE 47841
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.AGENTDECK_PORT+'/',{signal:AbortSignal.timeout(3000)}).then(async r=>{await r.arrayBuffer();if(!r.ok)throw new Error('HTTP '+r.status);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"
CMD ["node", "server/index.ts"]
