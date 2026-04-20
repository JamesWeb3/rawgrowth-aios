#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Rawgrowth — provision a per-client VPS
#
# Run this from YOUR laptop. It SSHes into a fresh Ubuntu/Debian VPS,
# installs Docker, clones the rawgrowth repo, and boots the stack.
#
# Prerequisites on the VPS:
#   • Fresh Ubuntu 22.04+ or Debian 12+ with SSH access (root or sudo user)
#   • Public IP, ports 22/80/443 open
#   • DNS A record pointing your subdomain at the VPS IP
#     (set this BEFORE running so Caddy can issue TLS certs on first boot)
#
# Usage:
#   ./provision-vps.sh \
#     --host 1.2.3.4 \
#     --domain acme.rawgrowth.app \
#     --email founder@acme.com \
#     --org "Acme Corp" \
#     --ssh-user root
#
# What it does:
#   1. Installs Docker + git on the VPS
#   2. git clones rawgrowth-aios
#   3. Generates .env with the domain baked in
#   4. Boots docker compose
#   5. Captures the credentials banner and prints it for you to email/hand off
# ─────────────────────────────────────────────────────────────

HOST=""
DOMAIN=""
EMAIL=""
ORG=""
SSH_USER="root"
REPO="${RAWGROWTH_REPO:-https://github.com/JamesWeb3/rawgrowth-aios.git}"
TARGET="/opt/rawgrowth"

while [ $# -gt 0 ]; do
  case "$1" in
    --host)     HOST="$2"; shift 2 ;;
    --domain)   DOMAIN="$2"; shift 2 ;;
    --email)    EMAIL="$2"; shift 2 ;;
    --org)      ORG="$2"; shift 2 ;;
    --ssh-user) SSH_USER="$2"; shift 2 ;;
    --repo)     REPO="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

if [ -z "$HOST" ] || [ -z "$DOMAIN" ] || [ -z "$EMAIL" ] || [ -z "$ORG" ]; then
  cat <<USAGE
Usage:
  $0 --host <ip> --domain <subdomain> --email <admin-email> --org <"Org Name"> [--ssh-user <user>]

Required:
  --host       Public IP or hostname of a fresh Ubuntu/Debian VPS
  --domain     Subdomain DNS already points at this VPS, e.g. acme.rawgrowth.app
  --email      Admin email seeded as the org's owner
  --org        Org display name (use quotes if it has spaces)

Optional:
  --ssh-user   SSH user (default: root)
  --repo       Git URL to clone (default: rawgrowth-aios main)

USAGE
  exit 1
fi

SSH="ssh -o StrictHostKeyChecking=accept-new ${SSH_USER}@${HOST}"

bold "▸ Provisioning ${ORG} → ${DOMAIN} on ${HOST}"
echo

# ─── 1. Install Docker + git on the VPS ──────────────────────
bold "▸ Installing Docker + git on the VPS"
$SSH bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker --version
REMOTE
green "✓ Docker ready"
echo

# ─── 2. Clone (or pull) the repo ─────────────────────────────
bold "▸ Cloning rawgrowth into ${TARGET}"
$SSH "if [ -d ${TARGET}/.git ]; then cd ${TARGET} && git pull --rebase --autostash; else git clone ${REPO} ${TARGET}; fi"
green "✓ Repo in place"
echo

# ─── 3. Write .env on the VPS ────────────────────────────────
bold "▸ Writing .env"
ESCAPED_ORG="$(printf '%s' "$ORG" | sed 's/"/\\"/g')"
$SSH "cat > ${TARGET}/.env" <<EOF
DEPLOY_MODE=self_hosted

POSTGRES_DB=rawgrowth
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(openssl rand -hex 32)

JWT_SECRET=$(openssl rand -hex 32)
SUPABASE_SERVICE_ROLE_KEY=

NEXTAUTH_URL=https://${DOMAIN}
NEXTAUTH_SECRET=$(openssl rand -hex 32)
CADDY_SITE_ADDRESS=${DOMAIN}

RESEND_API_KEY=${RESEND_API_KEY:-}
EMAIL_FROM=${EMAIL_FROM:-portal@rawgrowth.ai}

NANGO_SECRET_KEY=${NANGO_SECRET_KEY:-}
NANGO_PUBLIC_KEY=${NANGO_PUBLIC_KEY:-}
NANGO_WEBHOOK_SECRET=${NANGO_WEBHOOK_SECRET:-}

SEED_ORG_NAME=${ESCAPED_ORG}
SEED_ORG_SLUG=$(printf '%s' "$ORG" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
SEED_ADMIN_EMAIL=${EMAIL}
SEED_ADMIN_PASSWORD=
SEED_ADMIN_NAME=Owner
EOF
green "✓ .env written"
echo

# ─── 4. Boot the stack ───────────────────────────────────────
bold "▸ Booting docker compose (this takes ~2 min on first build)"
$SSH "cd ${TARGET} && docker compose up --build -d"
green "✓ Stack started"
echo

# ─── 5. Wait for the credentials banner ──────────────────────
bold "▸ Waiting for the credentials banner (up to 3 min)"
LOG_OUTPUT=""
for i in $(seq 1 90); do
  LOG_OUTPUT="$($SSH "cd ${TARGET} && docker compose logs app 2>&1" || true)"
  if echo "$LOG_OUTPUT" | grep -q "First-boot bootstrap complete"; then
    break
  fi
  sleep 2
done

# ─── 6. Print the credentials block ──────────────────────────
echo
bold "════════════════════════════════════════════════════════════"
bold "  Provision complete: ${ORG}"
bold "════════════════════════════════════════════════════════════"
echo "$LOG_OUTPUT" | sed -n '/Bootstrap complete/,/────────────/p' || true
echo
bold "════════════════════════════════════════════════════════════"
echo
echo "  Email the client:"
echo "    1. Their invite URL (they click → set password → signed in)"
echo "    2. The one-liner below to connect their Claude Code:"
echo
echo "  curl -fsSL ${REPO%.git}/raw/main/scripts/cc-install.sh | \\"
echo "    bash -s -- --token <MCP_TOKEN_FROM_ABOVE> --url https://${DOMAIN}"
echo
