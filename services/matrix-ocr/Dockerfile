FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY resources ./resources

RUN npm run models:download \
    && npm run build \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ORT_DISABLE_TELEMETRY=1 \
    MATRIX_OCR_BIND_HOST=0.0.0.0 \
    MATRIX_OCR_PORT=8090 \
    MATRIX_OCR_RESOURCES_ROOT=/app/resources

WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/resources ./resources

USER node
EXPOSE 8090

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/v1/ocr/health',{headers:{authorization:'Bearer '+process.env.MATRIX_OCR_HTTP_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
