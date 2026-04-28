#!/usr/bin/env bash
set -uo pipefail

# §9.8 ship-check gate. Walks every primary route after a fresh
# credentials login and asserts each returns 200 (or 307 for the
# /company → /company/general redirect). Zero tolerance for 4xx/5xx.
#
# Usage:
#   SMOKE_BASE_URL=https://<slug>.rawgrowth.ai \
#   SMOKE_EMAIL=admin@... SMOKE_PASSWORD=... \
#   ./scripts/smoke-routes.sh
#
# Defaults to localhost:3002 + the seeded pedro@local creds for dev.

BASE="${SMOKE_BASE_URL:-http://localhost:3002}"
EMAIL="${SMOKE_EMAIL:-pedro@local}"
PASSWORD="${SMOKE_PASSWORD:-devdevdev}"

ROUTES=(
  /
  /brand
  /departments
  /knowledge
  /agents
  /agents/tree
  /routines
  /activity
  /approvals
  /connections
  /skills
  /company/general
  /company/members
  /onboarding
  /api/agents
  /api/dashboard/stats
  /api/runs
  '/api/approvals?status=pending'
  /api/onboarding/questionnaire
  /api/onboarding/documents
  /api/knowledge
)

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR" /tmp/smoke-csrf-$$.json' EXIT

curl -sf -c "$COOKIE_JAR" "${BASE}/api/auth/csrf" > "/tmp/smoke-csrf-$$.json"
CSRF=$(grep -oP '"csrfToken":"\K[^"]+' "/tmp/smoke-csrf-$$.json")
if [ -z "$CSRF" ]; then
  echo "fail: could not read CSRF token from $BASE/api/auth/csrf" >&2
  exit 2
fi

curl -sf -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=${CSRF}" \
  --data-urlencode "email=${EMAIL}" \
  --data-urlencode "password=${PASSWORD}" \
  --data-urlencode "callbackUrl=/" \
  --data-urlencode "json=true" \
  "${BASE}/api/auth/callback/credentials" -o /dev/null

ok=0; fail=0
for route in "${ROUTES[@]}"; do
  code=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w "%{http_code}" "${BASE}${route}")
  if [ "$code" = "200" ] || [ "$code" = "307" ]; then
    printf "  ok  %3s  %s\n" "$code" "$route"
    ok=$((ok+1))
  else
    printf "  FAIL %3s  %s\n" "$code" "$route" >&2
    fail=$((fail+1))
  fi
done

total=$((ok+fail))
echo "smoke: ${ok}/${total} ok"
[ "$fail" -eq 0 ]
