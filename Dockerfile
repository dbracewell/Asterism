# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS frontend-build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.17.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN --mount=type=cache,id=asterism-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store --fetch-timeout=300000 
COPY apps/frontend apps/frontend
COPY scripts scripts

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @asterism/frontend build \
  && test ! -e /storage/users.db

FROM python:3.13-slim-bookworm AS backend-build
# Avoid compiling llama.cpp for build-host-only CPU features (notably ARM VMs).
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 CMAKE_ARGS="-DGGML_NATIVE=OFF"
RUN pip install --no-cache-dir uv==0.12.13 \
  && apt-get update && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/backend
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
  uv sync --locked --no-dev --no-install-project
COPY apps/backend/asterism ./asterism
COPY apps/backend/README.md ./README.md
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev

# Runtime needs SQLite >=3.45 for the backend's JSONB SQL functions.
# Bookworm-built native dependencies remain compatible with newer glibc.
FROM python:3.13-slim-trixie AS runtime

COPY --from=node:22-slim /usr/local/bin /usr/local/bin
COPY --from=node:22-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN python --version && node --version && npm --version

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx tini libstdc++6 libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --create-home asterism \
  && mkdir -p /storage && chown asterism:asterism /storage
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
# Preserve pnpm's workspace symlinks and native Node modules.
COPY --from=frontend-build /app/node_modules ./node_modules
COPY --from=frontend-build /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=frontend-build --chown=asterism:asterism /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=frontend-build /app/apps/frontend/public ./apps/frontend/public
COPY --from=frontend-build /app/apps/frontend/package.json /app/apps/frontend/next.config.ts ./apps/frontend/
# The official auth CLI needs the source configuration, not Next.js build chunks.
COPY --from=frontend-build /app/apps/frontend/src/lib/auth-core.ts ./apps/frontend/src/lib/auth-core.ts
COPY --from=frontend-build /app/apps/frontend/src/lib/auth-cli.ts ./apps/frontend/src/lib/auth-cli.ts
COPY --from=frontend-build /app/apps/frontend/src/lib/server-config-core.ts ./apps/frontend/src/lib/server-config-core.ts
COPY --from=frontend-build /app/scripts/config-check.mjs \
  /app/scripts/config-contract.mjs /app/scripts/run-with-env.mjs ./scripts/
COPY --from=backend-build /app/apps/backend ./apps/backend
COPY docker/entrypoint.sh docker/healthcheck.py docker/nginx.conf ./docker/
RUN chmod +x /app/docker/entrypoint.sh
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
  STORAGE_ROOT=/storage
USER asterism
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD ["python", "/app/docker/healthcheck.py"]

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/docker/entrypoint.sh"]
