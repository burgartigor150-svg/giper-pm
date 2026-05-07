# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------
# Production image for apps/ws — small Node WebSocket fanout server.
# No bundling needed; we run the TS source via tsx, same as dev.
# Image stays under ~150 MB.
# -----------------------------------------------------------------------

ARG NODE_VERSION=20
ARG PNPM_VERSION=9.12.3

FROM node:${NODE_VERSION}-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/ws/package.json apps/ws/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/realtime/package.json packages/realtime/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --filter @giper/ws...

# Runtime — same image, just trim and copy source over.
FROM node:${NODE_VERSION}-alpine AS runtime
RUN apk add --no-cache libc6-compat tini
WORKDIR /app

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/ws/node_modules ./apps/ws/node_modules
COPY apps/ws ./apps/ws
COPY tsconfig.base.json ./tsconfig.base.json

# Ensure tsx is resolvable from /app (NODE_PATH fallback for module resolution)
ENV NODE_PATH=/app/apps/ws/node_modules

ENV NODE_ENV=production \
    WS_PORT=3001 \
    WS_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health > /dev/null || exit 1

EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx/esm", "apps/ws/src/index.ts"]
