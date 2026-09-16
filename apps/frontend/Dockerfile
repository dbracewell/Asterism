FROM node:22-bookworm-slim AS build

RUN npm install --global pnpm@11.17.0 \
  && apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && pnpm --version

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY docker-pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

COPY . /app

ARG NEXT_PUBLIC_BACKEND_API_URL
ENV NEXT_PUBLIC_BACKEND_API_URL=$NEXT_PUBLIC_BACKEND_API_URL \
  BETTER_AUTH_SECRET=build-time-only-secret \
  BETTER_AUTH_URL=http://localhost:3000
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY ./docker-entrypoint.sh ./docker-entrypoint.sh
RUN  chmod +x ./docker-entrypoint.sh
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/migrate-db.mjs ./migrate-db.mjs
COPY --from=build /app/src/lib/auth-options.ts ./src/lib/auth-options.ts
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
