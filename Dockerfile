# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
# Rawgrowth AIOS — self-hosted Docker image
# Multi-stage build, Node 22 LTS, Next.js standalone output.
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

# Prod-only deps stage. We need the full transitive tree of pg +
# jsonwebtoken (used by entrypoint scripts) and any prod dep referenced
# by the standalone server but not bundled into it. Running
# `npm prune --omit=dev` against the deps tree is the cheapest way to
# get a clean install without pulling fresh from the registry (which
# was breaking on a transitive `workspace:*` spec).
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY patches ./patches
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

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

# Prod node_modules tree (pg, jsonwebtoken, bcryptjs + their full
# transitives) from the prod-deps stage. Standalone Next.js excludes
# anything its bundler doesn't see imported from server.js, so the
# entrypoint scripts (migrate.ts, gen-jwt.ts) need a real tree on disk.
# Using the prod-deps stage keeps it lean (no devDeps) and avoids the
# "missing transitive" whack-a-mole of hand-listing every package.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
