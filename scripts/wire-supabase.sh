#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# Wire a fresh Rawgrowth Supabase project into this VPS.
# Run once when Chris hands off the credentials. Writes
# .env.production with all four Supabase values + keeps
# every other key from .env.v3.example untouched.
#
# Usage:
#   ./scripts/wire-supabase.sh \
#     "postgres://postgres:PWD@db.PROJECT.supabase.co:5432/postgres" \
#     "https://PROJECT.supabase.co" \
#     "eyJ...anon..." \
#     "eyJ...service_role..."
#
# After running:
#   1. Edit .env.production for any other keys (Anthropic, OpenAI, etc.)
#   2. Run: DEPLOY_MODE=v3 DATABASE_URL=... npx tsx scripts/migrate.ts
#   3. Boot: docker compose -f docker-compose.v3.yml up -d
# ──────────────────────────────────────────────────────────

bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

if [ "$#" -ne 4 ]; then
  red "Usage: $0 DATABASE_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

DATABASE_URL="$1"
PUBLIC_URL="$2"
ANON_KEY="$3"
SERVICE_ROLE_KEY="$4"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/.env.v3.example"
TARGET="$ROOT/.env.production"

if [ ! -f "$TEMPLATE" ]; then
  red ".env.v3.example missing. Are you in the repo root?"
  exit 1
fi

bold "▸ Generating $TARGET"
cp "$TEMPLATE" "$TARGET"

# Escape sed-replacement metacharacters: & \ |. The delimiter is | so we
# also escape any literal | in the value. Without this, a Supabase DB
# password containing & or | corrupts the .env silently.
escape_sed_repl() {
  printf '%s\n' "$1" | sed -e 's/[&|\\]/\\&/g'
}

DATABASE_URL_E=$(escape_sed_repl "$DATABASE_URL")
PUBLIC_URL_E=$(escape_sed_repl "$PUBLIC_URL")
ANON_KEY_E=$(escape_sed_repl "$ANON_KEY")
SERVICE_ROLE_KEY_E=$(escape_sed_repl "$SERVICE_ROLE_KEY")

sed -i \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL_E|" \
  -e "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$PUBLIC_URL_E|" \
  -e "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY_E|" \
  -e "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY_E|" \
  "$TARGET"

# Auto-mint the rotated secrets the operator must rotate per VPS. These
# are openssl hex output so no metachar risk, but we escape for safety.
NEXTAUTH_SECRET=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
sed -i \
  -e "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$NEXTAUTH_SECRET|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" \
  -e "s|^CRON_SECRET=.*|CRON_SECRET=$CRON_SECRET|" \
  "$TARGET"

green "✓ Supabase wired into $TARGET"

# ── Create the agent-files storage bucket if it doesn't exist ──
# Per-agent RAG (D10) needs this bucket. Without it, upload silently
# returns 500. Free-tier project file_size_limit caps at 50MB; a paid
# project can be raised by editing the bucket later.
bold "▸ Provisioning storage bucket 'agent-files' (50MB cap)"
BUCKET_RES=$(curl -fsS -o /tmp/bucket-res.json -w "%{http_code}" \
  -X POST "$PUBLIC_URL/storage/v1/bucket" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "content-type: application/json" \
  -d '{"id":"agent-files","name":"agent-files","public":false,"file_size_limit":52428800}' \
  || true)
if [ "$BUCKET_RES" = "200" ] || [ "$BUCKET_RES" = "201" ]; then
  green "✓ Bucket 'agent-files' created"
elif grep -q "already exists" /tmp/bucket-res.json 2>/dev/null; then
  green "✓ Bucket 'agent-files' already present"
else
  red "⚠  Bucket create returned $BUCKET_RES — check /tmp/bucket-res.json. Per-agent file uploads will 500 until this exists."
fi

echo
bold "Next steps:"
echo "  1. Open $TARGET, fill ANTHROPIC_API_KEY + OPENAI_API_KEY (+ RESEND, NANGO if used)."
echo "  2. Update CADDY_SITE_ADDRESS + NEXTAUTH_URL with the client's domain."
echo "  3. Apply migrations:"
echo "       DEPLOY_MODE=v3 DATABASE_URL=\"$DATABASE_URL\" npx tsx scripts/migrate.ts"
echo "  4. (Optional) seed first org:"
echo "       SEED_ADMIN_EMAIL=admin@client.com SEED_ADMIN_PASSWORD=\"\$(openssl rand -hex 16)\" \\"
echo "         npx tsx scripts/seed-self-hosted.ts"
echo "  5. Boot: docker compose -f docker-compose.v3.yml up -d"
