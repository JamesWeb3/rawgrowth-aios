# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
# Rawgrowth AIOS — self-hosted Docker image
# Multi-stage build, Node 24 LTS, Next.js standalone output.
# The same image is used for every client VPS — only env differs.
# ─────────────────────────────────────────────────────────────

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# patch-package runs in postinstall and patches fastembed's broken
# `import tar from "tar"` (tar v7 dropped default export). Without
# the patches/ dir present at install time, patch-package logs
# "No patch files found" and the build later fails on the unpatched
# fastembed source.
COPY patches ./patches
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DEPLOY_MODE=self_hosted

# Drop root + create local-storage dir owned by nextjs (used by
# src/lib/storage/local.ts when DEPLOY_MODE=self_hosted; mounted as
# a docker-compose volume so files survive restarts).
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/storage && \
    chown -R nextjs:nodejs /app/storage

# The standalone output ships with a minimal server.js + node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migration runner + entrypoint ship inside the image
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/supabase/migrations ./supabase/migrations
COPY --from=builder --chown=nextjs:nodejs /app/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Runtime deps (pg, jsonwebtoken, bcryptjs) ship from the builder stage
# instead of a fresh `npm install` so we get the lockfile-resolved tree
# without npm 10 choking on `workspace:*` specs that some upstream
# transitive dep started carrying. The standalone output keeps server.js
# slim, so we copy these libs (and their transitives) directly from the
# fully-installed builder node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
