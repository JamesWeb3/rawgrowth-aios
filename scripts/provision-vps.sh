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

# Secret the VPS-local minute tick sends when calling /api/cron/schedule-tick.
CRON_SECRET=$(openssl rand -hex 32)

NEXTAUTH_URL=https://${DOMAIN}
NEXT_PUBLIC_APP_URL=https://${DOMAIN}
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

# ─── 6. Extract the MCP token from the bootstrap log ─────────
MCP_TOKEN="$(echo "$LOG_OUTPUT" | grep -oE 'rgmcp_[a-f0-9]+' | head -1 || true)"
if [ -z "$MCP_TOKEN" ]; then
  red "✗ Could not extract MCP token from bootstrap log. Re-run after inspecting:"
  red "    ssh ${SSH_USER}@${HOST} 'cd ${TARGET} && docker compose logs app'"
  exit 1
fi
green "✓ MCP token captured: ${MCP_TOKEN:0:16}..."
echo

# ─── 7. Install Node + Claude Code + non-root runner + drain ─
bold "▸ Installing Node.js, Claude Code CLI, rawclaw user, and drain server"
$SSH "MCP_TOKEN='${MCP_TOKEN}' DOMAIN='${DOMAIN}' bash -s" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# Node.js 24 LTS (for Claude Code CLI + drain server)
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Non-root user — Claude Code refuses --dangerously-skip-permissions as root.
if ! id rawclaw >/dev/null 2>&1; then
  useradd -m -s /bin/bash rawclaw
fi

# Claude Code CLI installed as rawclaw (so its config lives in /home/rawclaw)
sudo -iu rawclaw bash -c '
  if ! command -v claude >/dev/null 2>&1; then
    curl -fsSL https://claude.ai/install.sh | bash
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.profile
  fi
'
ln -sf /home/rawclaw/.local/bin/claude /usr/local/bin/claude

# Register the rawgrowth MCP server at USER scope so it is visible no matter
# what cwd Claude Code is spawned from (systemd, SSH, interactive).
sudo -iu rawclaw claude mcp remove rawgrowth 2>/dev/null || true
sudo -iu rawclaw claude mcp add --scope user --transport http rawgrowth \
  "https://${DOMAIN}/api/mcp" \
  --header "Authorization: Bearer ${MCP_TOKEN}"

# Drain server — tiny HTTP router that spawns Claude Code on POST.
#   POST /chat    → /rawgrowth-chat (Telegram free-text replies)
#   POST /triage  → /rawgrowth-triage (drain one pending routine run)
#   POST /run     → spawns claude with a one-shot prompt from JSON body
#                  ({ prompt: "..." }). Used by the Slack webhook to
#                  hand off action requests with full context.
#   POST /        → backward-compat alias for /chat
# Per-command single-flight with redrive applies to /chat + /triage;
# /run is fire-and-forget per request (no dedup), since each Slack
# message is a distinct one-shot conversation.
# Listens on 0.0.0.0:9876 — only reachable from host + docker bridge.
mkdir -p /opt/rawclaw-drain
cat > /opt/rawclaw-drain/drain-server.mjs <<'JS'
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = 9876;
const CLAUDE = "/usr/local/bin/claude";

const slots = new Map(); // command → { running, redrive }

function trigger(command) {
  const slot = slots.get(command) ?? { running: false, redrive: false };
  slots.set(command, slot);
  if (slot.running) { slot.redrive = true; return; }
  slot.running = true;
  slot.redrive = false;
  const started = Date.now();
  const child = spawn(CLAUDE, [
    "--print",
    "--dangerously-skip-permissions",
    `/${command}`,
  ], { stdio: ["ignore", "inherit", "inherit"], detached: true });
  child.on("exit", (code) => {
    console.log(`drain[${command}] exit=${code} duration=${Date.now()-started}ms`);
    slot.running = false;
    if (slot.redrive) trigger(command);
  });
  child.unref();
}

function spawnWithPrompt(prompt) {
  const started = Date.now();
  const child = spawn(CLAUDE, [
    "--print",
    "--dangerously-skip-permissions",
    prompt,
  ], { stdio: ["ignore", "inherit", "inherit"], detached: true });
  child.on("exit", (code) => {
    console.log(`drain[run] exit=${code} duration=${Date.now()-started}ms prompt_len=${prompt.length}`);
  });
  child.unref();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

http.createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/run" && req.method === "POST") {
    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad json");
      return;
    }
    const prompt = String(body?.prompt ?? "").trim();
    if (!prompt) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("prompt required");
      return;
    }
    res.writeHead(202, { "content-type": "text/plain" });
    res.end("ok");
    spawnWithPrompt(prompt);
    return;
  }

  let command;
  if (path === "/triage") command = "rawgrowth-triage";
  else if (path === "/chat" || path === "/") command = "rawgrowth-chat";
  else {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
  trigger(command);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`rawclaw-drain listening on 0.0.0.0:${PORT}`);
});
JS
chown -R rawclaw:rawclaw /opt/rawclaw-drain

# systemd unit
cat > /etc/systemd/system/rawclaw-drain.service <<'UNIT'
[Unit]
Description=Rawclaw drain trigger — spawns Claude Code on HTTP POST
After=network.target

[Service]
Type=simple
User=rawclaw
Group=rawclaw
WorkingDirectory=/home/rawclaw
ExecStart=/usr/bin/node /opt/rawclaw-drain/drain-server.mjs
Restart=always
RestartSec=3
StandardOutput=append:/var/log/rawclaw-drain.log
StandardError=append:/var/log/rawclaw-drain.log

[Install]
WantedBy=multi-user.target
UNIT

touch /var/log/rawclaw-drain.log
chown rawclaw:rawclaw /var/log/rawclaw-drain.log

# ─── Rawgrowth minute tick ───────────────────────────────────
# Hits /api/cron/schedule-tick every minute to materialise scheduled
# routine runs. If the tick reports fired>0 or pending_count>0 it also
# pokes the drain daemon so Claude Code claims the pending work.
mkdir -p /opt/rawgrowth-tick
cat > /opt/rawgrowth-tick/tick.mjs <<'JS'
import fs from "node:fs";
import { execSync } from "node:child_process";

const ENV_FILE = "/opt/rawgrowth/.env";
const CREDS_PATH = "/home/rawclaw/.claude/.credentials.json";
const CREDS_DIR = "/home/rawclaw/.claude";

const env = Object.fromEntries(
  fs.readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      const k = l.slice(0, i).trim();
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [k, v];
    }),
);

const url = env.NEXTAUTH_URL || env.NEXT_PUBLIC_APP_URL;
const secret = env.CRON_SECRET;
if (!url) {
  console.error("tick: NEXTAUTH_URL missing from .env — aborting");
  process.exit(0);
}

// ─── 1. Sync the Claude Max token from the dashboard DB to disk ─────
// The dashboard stores the long-lived token (encrypted) in
// rgaios_connections. We pull the decrypted value via /api/cron/claude-token
// and overwrite ~rawclaw/.claude/.credentials.json if the value differs.
//
// To avoid trampling on credentials we didn't write (e.g. a manual
// `claude auth login` performed by the operator), we only ever touch
// credentials.json when the marker file is present. The marker is
// created the first time we write; revocation removes both files.
async function syncClaudeToken() {
  const MARKER = `${CREDS_DIR}/.rawgrowth-managed`;
  try {
    const res = await fetch(`${url}/api/cron/claude-token`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return;
    const body = await res.json();
    const newToken = body.connected && body.token ? String(body.token) : null;
    const ownedByUs = fs.existsSync(MARKER);

    let existingToken = null;
    try {
      const raw = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
      existingToken = raw?.claudeAiOauth?.accessToken ?? null;
    } catch {
      existingToken = null;
    }

    if (newToken && newToken !== existingToken) {
      fs.mkdirSync(CREDS_DIR, { recursive: true });
      const payload = {
        claudeAiOauth: {
          accessToken: newToken,
          refreshToken: "",
          expiresAt: 9_999_999_999_000,
          scopes: ["user:inference", "user:profile"],
          subscriptionType: "max",
        },
      };
      const tmp = `${CREDS_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, CREDS_PATH);
      fs.writeFileSync(MARKER, new Date().toISOString());
      try {
        execSync(`chown -R rawclaw:rawclaw ${CREDS_DIR}`);
      } catch {}
      console.log("tick sync: wrote new Claude Max token to credentials.json");
    } else if (!newToken && ownedByUs && existingToken) {
      // Token revoked in dashboard — only nuke files we wrote.
      try { fs.unlinkSync(CREDS_PATH); } catch {}
      try { fs.unlinkSync(MARKER); } catch {}
      console.log("tick sync: removed credentials.json (revoked in dashboard)");
    }
  } catch (err) {
    console.error(`tick sync err: ${err && err.message ? err.message : err}`);
  }
}

await syncClaudeToken();

// ─── 2. Executor liveness check ─────────────────────────────────────
// Is rawclaw's claude CLI actually logged in right now? If not,
// schedule-tick still runs (to sweep stale pendings) but doesn't
// materialise new scheduled runs. Prevents pile-up during auth gaps.
function isExecutorReady() {
  try {
    const out = execSync("sudo -iu rawclaw claude auth status 2>/dev/null", {
      timeout: 5_000,
    }).toString();
    return /"loggedIn"\s*:\s*true/.test(out);
  } catch {
    return false;
  }
}

const executorReady = isExecutorReady();

// ─── 3. Schedule tick ───────────────────────────────────────────────
try {
  const res = await fetch(
    `${url}/api/cron/schedule-tick?executor_ready=${executorReady ? 1 : 0}`,
    {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    console.error(`tick: schedule-tick ${res.status}`);
    process.exit(0);
  }
  const body = await res.json();
  const fired = Array.isArray(body.fired) ? body.fired.length : 0;
  const swept = Number(body.swept ?? 0);
  const pending = Number(body.pending_count ?? 0);
  console.log(
    `tick ok executor=${executorReady ? "ready" : "offline"} fired=${fired} swept=${swept} pending=${pending}`,
  );
  if (executorReady && (fired > 0 || pending > 0)) {
    await fetch("http://127.0.0.1:9876/triage", {
      method: "POST",
      signal: AbortSignal.timeout(1_000),
    }).catch(() => {});
  }
} catch (err) {
  console.error(`tick err: ${err && err.message ? err.message : err}`);
}
JS

cat > /etc/systemd/system/rawgrowth-tick.service <<'UNIT'
[Unit]
Description=Rawgrowth minute tick — materialise schedules + wake drain
After=network.target

[Service]
Type=oneshot
User=root
ExecStart=/usr/bin/node /opt/rawgrowth-tick/tick.mjs
StandardOutput=append:/var/log/rawgrowth-tick.log
StandardError=append:/var/log/rawgrowth-tick.log
UNIT

HEARTBEAT_INTERVAL_SEC=${HEARTBEAT_INTERVAL_SEC:-600}
if ! [[ "$HEARTBEAT_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [ "$HEARTBEAT_INTERVAL_SEC" -lt 10 ]; then
  red "HEARTBEAT_INTERVAL_SEC must be an integer >= 10 (got: $HEARTBEAT_INTERVAL_SEC)"
  exit 1
fi

cat > /etc/systemd/system/rawgrowth-tick.timer <<UNIT
[Unit]
Description=Rawgrowth heartbeat tick timer

[Timer]
OnBootSec=30s
OnUnitActiveSec=${HEARTBEAT_INTERVAL_SEC}s
AccuracySec=5s
Unit=rawgrowth-tick.service

[Install]
WantedBy=timers.target
UNIT

touch /var/log/rawgrowth-tick.log

systemctl daemon-reload
systemctl enable --now rawclaw-drain
systemctl enable --now rawgrowth-tick.timer
REMOTE
green "✓ Drain server + MCP + minute tick timer registered"
echo

# ─── 8. Print the credentials block ──────────────────────────
echo
bold "════════════════════════════════════════════════════════════"
bold "  Provision complete: ${ORG}"
bold "════════════════════════════════════════════════════════════"
echo "$LOG_OUTPUT" | sed -n '/Bootstrap complete/,/────────────/p' || true
echo
bold "════════════════════════════════════════════════════════════"
echo
echo "  Next (live on call with client — ~2 min):"
echo "    ssh -t ${SSH_USER}@${HOST} 'sudo -iu rawclaw claude login'"
echo "      → share the URL with the client"
echo "      → they sign in with their Claude Max account"
echo "      → they paste the auth code back"
echo
echo "  Smoke test:"
echo "    ssh ${SSH_USER}@${HOST} \"sudo -iu rawclaw claude --print '/rawgrowth-status'\""
echo
echo "  Send the client their invite URL (shown above)."
echo
