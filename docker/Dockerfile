# Build context = 仓库根目录（由 compose 的 context: .. 指定）
# —— Build stage ——
FROM node:20-bookworm AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY config ./config
COPY src ./src
COPY ops ./ops
COPY assets ./assets

RUN npm run build \
  && npm prune --omit=dev

# —— Runtime ——
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ops/sql ./ops/sql
COPY --from=builder /app/ops/scripts ./ops/scripts
COPY --from=builder /app/ops/docs ./ops/docs
COPY --from=builder /app/assets ./assets
COPY docker/entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh \
  && chmod +x /entrypoint.sh \
  && mkdir -p /app/data

ENV NODE_ENV=production \
    USE_MYSQL=1 \
    PORT=17890 \
    DATA_ROOT=/app/data \
    MYSQL_HOST=mysql \
    MYSQL_PORT=3306 \
    MYSQL_USER=hanye \
    MYSQL_DATABASE=hanye_printer

EXPOSE 17890
VOLUME ["/app/data"]

ENTRYPOINT ["/entrypoint.sh"]
