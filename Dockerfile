# ─── Base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat curl
WORKDIR /app
# The web image never needs the Electron binary that the apps/desktop
# workspace pulls in — skip its ~200 MB postinstall download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# ─── Dependencies ─────────────────────────────────────────────────────
# npm workspaces keep a single lockfile at the repo root and hoist packages
# into the root node_modules. We copy every workspace manifest so `npm ci`
# can resolve the whole graph, then build the shared contract and generate the
# Prisma client.
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/web/prisma ./apps/web/prisma/
# --ignore-scripts: the web workspace's postinstall runs `prisma migrate
# deploy`, which needs a live database we don't have at image-build time.
# Migrations are applied at deploy time (see .gitlab-ci.yml); here we only need
# the dependency tree, the shared contract and a generated Prisma client.
RUN npm ci --ignore-scripts
RUN npm run build:shared
RUN npx prisma generate --schema apps/web/prisma/schema.prisma

# ─── Build ────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/dist ./packages/shared/dist
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Builds packages/shared, then the Next.js app (apps/web).
RUN npm run build

# ─── Production ───────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Root manifest + hoisted dependencies (includes the @trioz/shared symlink).
COPY --from=builder /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules

# The shared contract, resolved via the node_modules/@trioz/shared symlink.
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# The built web app. `server.ts` is a custom server run through tsx, so we ship
# its source (src/), the Next build (.next), public assets, prisma schema and
# config.
COPY --from=builder /app/apps/web ./apps/web

# Create uploads directory with correct permissions
RUN mkdir -p apps/web/public/uploads/avatars apps/web/public/uploads/admin \
    apps/web/public/uploads/messages apps/web/public/uploads/badges && \
    chown -R nextjs:nodejs apps/web/public/uploads

# Self-hosted desktop installer store (mounted as a persistent volume in
# docker-compose). Installers are published here after build; served by
# /api/download/desktop and /desktop/.
RUN mkdir -p apps/web/public/desktop && chown -R nextjs:nodejs apps/web/public/desktop

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

USER nextjs
EXPOSE 3000

# Run the custom Next.js + Socket.IO server from the web workspace. Its cwd must
# be apps/web so Next finds .next/ and the relative src/ imports resolve; the
# hoisted root node_modules is still on the resolution path.
WORKDIR /app/apps/web
CMD ["npx", "tsx", "server.ts"]
