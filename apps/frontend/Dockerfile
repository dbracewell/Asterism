FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN npm install --global pnpm@11.17.0 \
    && apt-get update \
    && apt-get install --yes --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && pnpm --version

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @asterism/frontend... --config.ignore-scripts=false \
    && cd node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3 \
    && npm run install

COPY apps/frontend ./apps/frontend

WORKDIR /app/apps/frontend

ARG NEXT_PUBLIC_BACKEND_API_URL
ENV NEXT_PUBLIC_BACKEND_API_URL=$NEXT_PUBLIC_BACKEND_API_URL \
    BETTER_AUTH_SECRET=build-time-only-secret \
    BETTER_AUTH_URL=http://localhost
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app/apps/frontend

ENV NODE_ENV=production

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/frontend/package.json ./package.json
COPY --from=build /app/apps/frontend/node_modules ./node_modules
COPY --from=build /app/apps/frontend/.next ./.next
COPY --from=build /app/apps/frontend/public ./public

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
