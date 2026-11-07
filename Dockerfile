# syntax=docker/dockerfile:1
# Imagen única: API Express + SPA compilada (servida por la propia API desde /app/dist).
#
#   docker build -t luminary-api .
#   docker build --build-arg VITE_STELLAR_NETWORK=mainnet --build-arg VITE_SOROBAN_RPC_URL=... .
#
# Para producción fija la imagen base por digest (node:22-alpine@sha256:…) y reconstruye
# periódicamente para recibir parches de seguridad.
ARG NODE_IMAGE=node:22-alpine

# ------------------------------------------------------------------ deps (todas, para el build)
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------------ build de la SPA
FROM deps AS web-build
# Variables VITE_* (públicas: quedan en el bundle). Ver .env.production.example.
ARG VITE_STELLAR_NETWORK=testnet
ARG VITE_API_BASE_URL=
ARG VITE_HORIZON_URL=
ARG VITE_SOROBAN_RPC_URL=
ARG VITE_USDC_ISSUER=
ARG VITE_EXPLORER_URL=
ENV VITE_STELLAR_NETWORK=$VITE_STELLAR_NETWORK \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_HORIZON_URL=$VITE_HORIZON_URL \
    VITE_SOROBAN_RPC_URL=$VITE_SOROBAN_RPC_URL \
    VITE_USDC_ISSUER=$VITE_USDC_ISSUER \
    VITE_EXPLORER_URL=$VITE_EXPLORER_URL
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# ------------------------------------------------------------------ deps de producción
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ------------------------------------------------------------------ runtime
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="luminary-api" \
      org.opencontainers.image.description="Luminary P2P USDC API + SPA" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    STATIC_DIR=/app/dist \
    NODE_OPTIONS=--enable-source-maps
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --chown=root:root server ./server
COPY --from=web-build --chown=root:root /app/dist ./dist
# Los archivos pertenecen a root y son de solo lectura para el proceso; se ejecuta como `node`.
RUN rm -rf server/test server/scripts
USER node
EXPOSE 4000
# Readiness (BD + Redis). Para liveness pura usa /api/health/live en el orquestador.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Node es PID 1 y gestiona SIGTERM/SIGINT (apagado ordenado en server/index.js).
STOPSIGNAL SIGTERM
CMD ["node", "server/index.js"]
