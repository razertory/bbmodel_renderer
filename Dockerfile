# ---- Stage 1: install deps & build renderer bundle ----
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build:renderer

# ---- Stage 2: runtime with headless chromium ----
# mcr playwright image ships chromium + all system deps (jammy-based)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
# bun runtime binary from the official image
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=oven/bun:1 /usr/local/bin/bunx /usr/local/bin/bunx

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/assets ./assets
COPY package.json bun.lock ./
COPY src ./src

# match the chromium build bundled in the base image to playwright-core in node_modules
RUN bunx playwright-core install chromium || true

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/health || exit 1

CMD ["bun", "run", "src/index.ts"]
