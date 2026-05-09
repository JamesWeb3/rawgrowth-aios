#!/bin/bash
# Pull-only deploy. Replaces `docker compose up -d --build` which
# OOM-killed the 4GB CX22 every time. Runs on the VPS, expects:
#
#   - /opt/rawgrowth checked out on branch v3
#   - .env in /opt/rawgrowth (postgres password, JWT, etc)
#   - GHCR_PULL_TOKEN env var (read-only PAT for ghcr.io) OR public image
#
# Triggered from your laptop:
#   ssh root@<vps-ip> 'bash /opt/rawgrowth/scripts/deploy-vps.sh'
#
# Or as a one-shot from anywhere with the repo checked out:
#   scp scripts/deploy-vps.sh root@<vps-ip>:/tmp/ && ssh root@<vps-ip> 'bash /tmp/deploy-vps.sh'

set -euo pipefail

cd /opt/rawgrowth

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
