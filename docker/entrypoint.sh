#!/bin/sh
set -e

# ──────────────────────────────────────────────────────────
# Rawgrowth app container entrypoint.
#   1. Wait for Postgres (very briefly — compose has depends_on)
#   2. Apply pending schema migrations
#   3. Hand off to the Next.js standalone server
# ──────────────────────────────────────────────────────────

echo "[entrypoint] starting rawgrowth (DEPLOY_MODE=${DEPLOY_MODE:-unset})"

if [ -z "${DATABASE_URL}" ]; then
  echo "[entrypoint] DATABASE_URL is required"
  exit 1
fi

# If the operator didn't provide a service_role JWT (clients shouldn't need
# to mint one manually), derive one from JWT_SECRET on the fly. Same secret
# means PostgREST will accept it. This token is ephemeral — only used by
# this process for the lifetime of the container.
if [ -z "${SUPABASE_SERVICE_ROLE_KEY}" ] && [ -n "${JWT_SECRET}" ]; then
  echo "[entrypoint] minting service_role JWT from JWT_SECRET"
  SUPABASE_SERVICE_ROLE_KEY="$(node --experimental-strip-types scripts/gen-jwt.ts --secret "${JWT_SECRET}" --role service_role | tr -d '\n')"
  export SUPABASE_SERVICE_ROLE_KEY
fi

# Tiny retry loop in case postgres healthcheck isn't green yet
tries=30
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  tries=$((tries - 1))
  if [ "$tries" -le 0 ]; then
    echo "[entrypoint] postgres not reachable — giving up"
    exit 1
  fi
  echo "[entrypoint] waiting for postgres ($tries)..."
  sleep 1
done

echo "[entrypoint] running migrations"
node --experimental-strip-types scripts/migrate.ts

echo "[entrypoint] seed onboarding knowledge (idempotent)"
node --experimental-strip-types scripts/seed-onboarding-knowledge.ts || \
  echo "[entrypoint] WARN: onboarding knowledge seed failed (RAG will degrade)"

echo "[entrypoint] running self-hosted seed (no-op if org already exists)"
node --experimental-strip-types scripts/seed-self-hosted.ts || true

echo "[entrypoint] handing off to: $@"
exec "$@"
