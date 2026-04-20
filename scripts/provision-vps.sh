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
REPO="${RAWGROWTH_REPO:-git@github.com:Rawgrowth-Consulting/rawclaw.git}"
# GitHub API path derived from REPO (used to register deploy keys).
REPO_API_PATH="${RAWGROWTH_REPO_API_PATH:-Rawgrowth-Consulting/rawclaw}"
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
  --domain     Subdomain DNS already points at this VPS, e.g. acme.rawgrowth.ai
  --email      Admin email seeded as the org's owner
  --org        Org display name (use quotes if it has spaces)

Optional:
  --ssh-user   SSH user (default: root)
  --repo       Git URL to clone (default: rawgrowth-aios main)

Required environment variables (export before running):
  RESEND_API_KEY   Rawgrowth's shared Resend key, used for invite + reset emails.
                   Without this, client invites silently fail.

USAGE
  exit 1
fi

if [ -z "${RESEND_API_KEY:-}" ]; then
  red "✗ RESEND_API_KEY is not set. Invites and password resets will fail."
  red "  export RESEND_API_KEY=re_... before running this script, or pass it inline:"
  red "    RESEND_API_KEY=re_... $0 --host ... --domain ... --email ... --org \"...\""
  exit 1
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  red "✗ GITHUB_TOKEN is not set. Required to register the VPS's deploy key with the private repo."
  red "  Create a fine-grained PAT at https://github.com/settings/tokens?type=beta"
  red "    Repository access: only ${REPO_API_PATH}"
  red "    Permissions: Administration → Read & write (needed to register deploy keys)"
  red "  Then export it: export GITHUB_TOKEN=github_pat_..."
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

# ─── 2. Register a deploy key so the VPS can clone the private repo ──
bold "▸ Generating deploy key on the VPS and registering it with GitHub"

# Generate an ed25519 keypair on the VPS if we don't already have one.
# /root/.ssh/rawclaw_deploy is dedicated to this — don't reuse the host key.
$SSH 'mkdir -p /root/.ssh && chmod 700 /root/.ssh && \
      if [ ! -f /root/.ssh/rawclaw_deploy ]; then \
        ssh-keygen -t ed25519 -f /root/.ssh/rawclaw_deploy -N "" -C "rawclaw-deploy-${HOSTNAME}" >/dev/null; \
      fi'

DEPLOY_PUBKEY="$($SSH 'cat /root/.ssh/rawclaw_deploy.pub')"
echo "  Public key: ${DEPLOY_PUBKEY:0:40}..."

# Register it as a read-only deploy key on the repo via GitHub API.
# Title includes the VPS IP so we can identify which key belongs to which client later.
DEPLOY_KEY_TITLE="rawclaw-vps-${HOST//./-}"
API_RESP="$(curl -sS -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO_API_PATH}/keys" \
  -d "$(printf '{"title":"%s","key":"%s","read_only":true}' \
        "$DEPLOY_KEY_TITLE" \
        "$(printf '%s' "$DEPLOY_PUBKEY" | sed 's/"/\\"/g')")")"

if echo "$API_RESP" | grep -q '"id":'; then
  green "✓ Deploy key registered with ${REPO_API_PATH} as '${DEPLOY_KEY_TITLE}'"
elif echo "$API_RESP" | grep -q 'key is already in use'; then
  green "✓ Deploy key already registered (reusing existing)"
else
  red "✗ Failed to register deploy key:"
  echo "$API_RESP"
  exit 1
fi

# Make sure the VPS trusts github.com's host key + uses the deploy key for this repo.
$SSH 'ssh-keyscan -t ed25519,rsa github.com >> /root/.ssh/known_hosts 2>/dev/null && \
      sort -u /root/.ssh/known_hosts -o /root/.ssh/known_hosts && \
      cat > /root/.ssh/config <<SSHCFG
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/rawclaw_deploy
  IdentitiesOnly yes
SSHCFG
chmod 600 /root/.ssh/config /root/.ssh/rawclaw_deploy'

echo

# ─── 3. Clone (or pull) the repo ─────────────────────────────
bold "▸ Cloning rawclaw into ${TARGET}"
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
