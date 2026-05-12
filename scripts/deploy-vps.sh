#!/bin/bash
# Pull-only deploy. Replaces `docker compose up -d --build` which
# OOM-killed the 4GB CX22 every time. Runs on the VPS, expects:
#
#   - the repo checked out somewhere with docker-compose.yml + .env inside
#   - branch v3 checked out
#   - GHCR_PULL_TOKEN env var (read-only PAT for ghcr.io) OR public image
#
# Triggered from your laptop:
#   ssh root@<vps-ip> 'bash /opt/rawgrowth/scripts/deploy-vps.sh'
#
# On legacy boxes (e.g. Marti at /opt/rawclaw), the same script works
# because of the path-resolver below.
#
# Path resolution priority:
#   1. RAWGROWTH_HOME env var if set (explicit override)
#   2. parent dir of this script if it sits inside <repo>/scripts/
#      and that dir contains both docker-compose.yml and .env
#   3. fallback /opt/rawgrowth (historical default)

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PARENT_DIR="$( cd "${SCRIPT_DIR}/.." 2>/dev/null && pwd || echo "" )"

if [ -n "${RAWGROWTH_HOME:-}" ]; then
  TARGET="${RAWGROWTH_HOME}"
elif [ -n "${PARENT_DIR}" ] && [ -f "${PARENT_DIR}/docker-compose.yml" ] && [ -f "${PARENT_DIR}/.env" ]; then
  TARGET="${PARENT_DIR}"
elif [ -d /opt/rawgrowth ]; then
  TARGET=/opt/rawgrowth
else
  echo "[deploy] cannot find repo root. Set RAWGROWTH_HOME, run from inside <repo>/scripts/, or ensure /opt/rawgrowth exists." >&2
  exit 1
fi

echo "[deploy] working dir: ${TARGET}"
cd "${TARGET}"

echo "[deploy] git pull origin v3"
git pull origin v3

echo "[deploy] login to ghcr.io"
if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-pedroafonso-rawclaw}" --password-stdin
else
  # Public image works without auth. If our package is private, this
  # warning is the symptom you'll see on `docker pull`.
  echo "[deploy] no GHCR_PULL_TOKEN, attempting unauthenticated pull"
fi

echo "[deploy] docker compose pull (pulls latest v3 image from GHCR)"
docker compose pull app

echo "[deploy] docker compose up -d (no rebuild, just swap container)"
docker compose up -d app

echo "[deploy] tailing app logs for 30s, watching for 'Ready'"
timeout 30 docker compose logs -f app | grep -m1 "Ready in" || true

echo "[deploy] done. health check:"
sleep 2
curl -sS -o /dev/null -w "  /api/health %{http_code}\n" "http://127.0.0.1:3000/api/health" || true
