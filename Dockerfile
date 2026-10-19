# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: full workspace install (incl. dev deps) + pnpm build.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app

# Manifests first so the install layer caches independently of source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# better-sqlite3 and sqlite-vec ship prebuilt linux-x64 binaries, so no
# toolchain is needed. If a prebuild is ever missing for your platform,
# uncomment this (and the same line in the runtime stage below):
#   RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# Runtime stage: production deps only + built server, shared package, web app.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# (Toolchain fallback if native prebuilds are unavailable — see build stage.)
#   RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
# Drizzle migrations are applied at boot from this folder.
COPY apps/server/drizzle apps/server/drizzle

EXPOSE 3001
# Serves the API and the built web app on :3001; data lives in /app/data
# (mount ./data there — see docker-compose.yml).
CMD ["pnpm", "start"]
