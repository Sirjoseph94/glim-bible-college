# syntax=docker/dockerfile:1.7
# One image for every container in deploy/compose.yaml (TRD §22.4): the API, the worker and the
# migrate step differ only by command. It includes pg_dump 18 for the weekly
# logical backup.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN npm install -g pnpm@12.8.1
WORKDIR /app

# ---- build: install everything, build the SPA into apps/api/static ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @glim/web build && node apps/api/scripts/copy-static.mjs

# ---- runtime: production dependencies only, plus the built SPA ----
FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y gnupg curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node . .
# Once node_modules is linked, the pnpm store, pnpm itself and the npm bundled with Node are all
# dropped: nothing at runtime runs them, and Trivy flags what they bundle (ticket 46; pnpm
# 12.8.1's own undici). Containers start their entry point with tsx directly.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
 && rm -rf "$(pnpm store path)" \
 && rm -rf /usr/local/lib/node_modules/pnpm /usr/local/bin/pnpm /usr/local/bin/pnpx \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
 && chown -R node:node /app/node_modules
COPY --from=build --chown=node:node /app/apps/api/static ./apps/api/static
USER node
ENV NODE_ENV=production \
    PORT=8080 \
    PG_DUMP_PATH=/usr/bin/pg_dump
EXPOSE 8080
# The API's `start` script, run without pnpm (deploy/compose.yaml does the same for each service).
WORKDIR /app/apps/api
CMD ["node_modules/.bin/tsx", "--tsconfig", "../../tsconfig.base.json", "src/main.ts"]
