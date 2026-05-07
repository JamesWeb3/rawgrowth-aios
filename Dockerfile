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

# Runtime deps for entrypoint scripts:
#   - scripts/migrate.ts uses pg
#   - scripts/gen-jwt.ts uses jsonwebtoken
#   - bcryptjs is bundled into the Next standalone output already
#
# Copy only the packages those scripts need (plus pg's transitives)
# from the builder's resolved tree. Avoids the OOM hit of dragging
# the full ~1.5GB node_modules into the runner image, and dodges the
# `workspace:*` resolution failure that hits when we try to `npm
# install` from the registry without a lockfile.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg ./node_modules/pg
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-cloudflare ./node_modules/pg-cloudflare
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/split2 ./node_modules/split2
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jsonwebtoken ./node_modules/jsonwebtoken
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jws ./node_modules/jws
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jwa ./node_modules/jwa
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/buffer-equal-constant-time ./node_modules/buffer-equal-constant-time
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ecdsa-sig-formatter ./node_modules/ecdsa-sig-formatter
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/safe-buffer ./node_modules/safe-buffer
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.includes ./node_modules/lodash.includes
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.isboolean ./node_modules/lodash.isboolean
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.isinteger ./node_modules/lodash.isinteger
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.isnumber ./node_modules/lodash.isnumber
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.isplainobject ./node_modules/lodash.isplainobject
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.isstring ./node_modules/lodash.isstring
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lodash.once ./node_modules/lodash.once
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ms ./node_modules/ms
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/semver ./node_modules/semver

RUN chmod +x /usr/local/bin/entrypoint.sh

USER nextjs

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
