# SoE Hub production image: one image for api, worker and migrations (different commands).
# Build:  docker build -t soe-hub .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@12.21.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/formula/package.json packages/formula/
COPY packages/metrics/package.json packages/metrics/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @soe/web build && pnpm --filter @soe/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
# The bundles in dist/ are self-contained (no node_modules needed).
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
