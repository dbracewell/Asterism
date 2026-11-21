# syntax=docker/dockerfile:1.29.0@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS frontend-base

# Build tools for better-sqlite3's native module.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.17.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json

# Only the frontend's runtime packages reach the image: next, the auth CLI and
# their dependencies, without test, lint and build tools (US-90.8).
FROM frontend-base AS frontend-deps
RUN --mount=type=cache,id=asterism-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --fetch-timeout=300000

FROM frontend-base AS frontend-build
RUN --mount=type=cache,id=asterism-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir /pnpm/store --fetch-timeout=300000
COPY apps/frontend apps/frontend
COPY scripts scripts

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @asterism/frontend build \
  && test ! -e /storage/users.db

FROM python:3.15-slim-bookworm@sha256:96599df822d0e1c6bb700014a05c7f3c8cabc6e0f7ff3c4f9f69cee033b4b5d9 AS backend-build
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

# torch: the lockfile installs the CPU-only build on Linux. TORCH_VARIANT=gpu
# swaps in the same versions from PyPI, whose Linux wheels bundle CUDA
# (about 4 GB more). Image generation, embeddings and captioning use either.
ARG TORCH_VARIANT=cpu
RUN --mount=type=cache,target=/root/.cache/uv \
  case "$TORCH_VARIANT" in \
    cpu) ;; \
    gpu) \
      version() { .venv/bin/python -c "import importlib.metadata as m; print(m.version('$1').split('+')[0])"; }; \
      uv pip install --python .venv/bin/python --index-url https://pypi.org/simple \
        --reinstall-package torch --reinstall-package torchvision \
        "torch==$(version torch)" "torchvision==$(version torchvision)" ;; \
    *) echo "TORCH_VARIANT must be cpu or gpu, not $TORCH_VARIANT" >&2; exit 1 ;; \
  esac

# Headless Chromium for the web fetch tool's JavaScript pages. Only the shell is
# downloaded here; the runtime stage installs the few libraries it needs.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 .venv/bin/playwright install --only-shell chromium \
  && chmod -R a+rX /opt/ms-playwright

# Runtime needs SQLite >=3.45 for the backend's JSONB SQL functions.
# Bookworm-built native dependencies remain compatible with newer glibc.
FROM python:3.15-slim-trixie@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928 AS runtime

# Headless Chromium's libraries, without Playwright's install-deps (a virtual
# display, extra fonts, and LLVM and Mesa through libgbm1). libgbm.so.1 itself
# is unpacked from its package alone: it needs only libdrm, expat and
# wayland-server, while installing libgbm1 would pull in Mesa's drivers and LLVM.
RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx tini libstdc++6 libgomp1 fonts-dejavu-core \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libdbus-1-3 libexpat1 libglib2.0-0t64 \
    libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libxkbcommon0 \
    libasound2t64 libdrm2 libwayland-server0 \
  && cd /tmp && apt-get download libgbm1 && dpkg-deb -x libgbm1_*.deb gbm \
  && cp -a gbm/usr/lib/. /usr/lib/ && ldconfig && rm -rf /tmp/gbm /tmp/libgbm1_*.deb \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --create-home asterism \
  && mkdir -p /storage /backups && chown asterism:asterism /storage /backups
# Node is needed only as a runtime; copied once, without npm (US-90.8).
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
RUN python --version && node --version
COPY --from=backend-build /opt/ms-playwright /opt/ms-playwright
WORKDIR /app
# Preserve pnpm's workspace symlinks and native Node modules.
COPY --from=frontend-deps /app/node_modules ./node_modules
COPY --from=frontend-deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=frontend-build --chown=asterism:asterism /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=frontend-build /app/apps/frontend/public ./apps/frontend/public
COPY --from=frontend-build /app/apps/frontend/package.json /app/apps/frontend/next.config.ts ./apps/frontend/
# The official auth CLI needs the source configuration, not Next.js build chunks.
COPY --from=frontend-build /app/apps/frontend/src/lib/auth-core.ts ./apps/frontend/src/lib/auth-core.ts
COPY --from=frontend-build /app/apps/frontend/src/lib/auth-rate-limit.ts ./apps/frontend/src/lib/auth-rate-limit.ts
COPY --from=frontend-build /app/apps/frontend/src/lib/auth-cli.ts ./apps/frontend/src/lib/auth-cli.ts
COPY --from=frontend-build /app/apps/frontend/src/lib/server-config-core.ts ./apps/frontend/src/lib/server-config-core.ts
# next.config.ts reads the security headers and the shared upload limit.
COPY --from=frontend-build /app/apps/frontend/src/lib/content-security-policy.ts ./apps/frontend/src/lib/content-security-policy.ts
COPY --from=frontend-build /app/scripts/config-check.mjs \
  /app/scripts/config-contract.mjs /app/scripts/run-with-env.mjs \
  /app/scripts/edge-config.mjs ./scripts/
COPY --from=backend-build /app/apps/backend ./apps/backend
# The user guide, served at /help/guide for this version (US-90.9).
COPY docs/guide ./docs/guide
COPY docker/entrypoint.sh docker/healthcheck.py docker/nginx.conf docker/nginx-api-headers.conf ./docker/
RUN chmod +x /app/docker/entrypoint.sh
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
  PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
  STORAGE_ROOT=/storage
# What this image was built from (US-91.1). Status and backups report the app
# version from the backend package and the commit from ASTERISM_COMMIT. A given
# ASTERISM_VERSION must be that version, so the label cannot disagree with it.
# These come last so that a new commit rebuilds only these layers.
ARG ASTERISM_VERSION=unknown
ARG ASTERISM_COMMIT=unknown
RUN version="$(/app/apps/backend/.venv/bin/python -c 'import importlib.metadata as m; print(m.version("asterism-core"))')" \
  && if [ "$ASTERISM_VERSION" != unknown ] && [ "$ASTERISM_VERSION" != "$version" ]; then \
    echo "ASTERISM_VERSION is $ASTERISM_VERSION, but the app version is $version" >&2; exit 1; fi
LABEL org.opencontainers.image.title="Asterism" \
  org.opencontainers.image.description="A self-hosted AI assistant for learning" \
  org.opencontainers.image.source="https://github.com/dbracewell/Asterism" \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.version="$ASTERISM_VERSION" \
  org.opencontainers.image.revision="$ASTERISM_COMMIT"
ENV ASTERISM_COMMIT=$ASTERISM_COMMIT
USER asterism
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD ["python", "/app/docker/healthcheck.py"]

ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/docker/entrypoint.sh"]
