#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Rawgrowth — Claude Code installer
#
# Run this on the CLIENT'S laptop. It:
#   1. Adds the rawgrowth MCP server to ~/.claude/settings.json
#   2. Drops the rawgrowth slash commands into ~/.claude/commands/
#
# Usage:
#   ./cc-install.sh --token rgmcp_xxx --url https://acme.rawgrowth.app
#
# Or curl-pipe:
#   curl -fsSL https://raw.githubusercontent.com/JamesWeb3/rawgrowth-aios/main/scripts/cc-install.sh \
#     | bash -s -- --token rgmcp_xxx --url https://acme.rawgrowth.app
# ─────────────────────────────────────────────────────────────

TOKEN=""
URL=""
NAME="rawgrowth"

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --url)   URL="$2"; shift 2 ;;
    --name)  NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "$TOKEN" ] || [ -z "$URL" ]; then
  echo "Usage: $0 --token <rgmcp_...> --url <https://your.rawgrowth.app>"
  exit 1
fi

bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

bold "▸ Installing Rawgrowth into Claude Code"
echo

CC_DIR="$HOME/.claude"
SETTINGS="$CC_DIR/settings.json"
COMMANDS_DIR="$CC_DIR/commands"

mkdir -p "$CC_DIR" "$COMMANDS_DIR"

# ─── 1. Merge MCP server config into settings.json ───────────
if ! command -v node >/dev/null 2>&1; then
  red "✗ Node is required to safely merge JSON. Install from https://nodejs.org or run the manual setup in CLAUDE_CODE_SETUP.md."
  exit 1
fi

node - <<EOF
const fs = require("fs");
const path = "${SETTINGS}";

let settings = {};
try {
  if (fs.existsSync(path)) {
    settings = JSON.parse(fs.readFileSync(path, "utf8"));
  }
} catch (e) {
  console.error("Could not parse existing settings.json — refusing to overwrite. Fix it manually first.");
  process.exit(1);
}

settings.mcpServers = settings.mcpServers || {};
settings.mcpServers["${NAME}"] = {
  url: "${URL}/api/mcp",
  headers: { Authorization: "Bearer ${TOKEN}" }
};

fs.writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
EOF
green "✓ Wrote MCP server config → $SETTINGS"

# ─── 2. Install slash commands ───────────────────────────────
install_command() {
  local name="$1"
  local body="$2"
  local file="$COMMANDS_DIR/${name}.md"
  printf '%s' "$body" > "$file"
  green "✓ Installed /$name"
}

install_command "rawgrowth-status" \
"Use the rawgrowth MCP server to give me a one-paragraph status update on this organization.

Specifically:
1. Call \`runs_list_pending\` to count pending routine runs.
2. Look up how many approvals are pending (use any rawgrowth tool that surfaces approvals; if none, just say so).
3. Summarize in 3-4 sentences: pending work, anything blocked, anything that needs my attention.

Be terse. Don't recite tool names. Just give me the picture.
"

install_command "rawgrowth-triage" \
"Pick up the OLDEST pending routine run from the rawgrowth MCP server and execute it end-to-end.

Steps:
1. Call \`runs_list_pending\` (limit 1) to find the oldest pending run.
2. If none, say so and stop.
3. Call \`runs_claim\` with that run_id — read the routine instructions and input payload it returns.
4. Execute the routine using the available rawgrowth MCP tools (gmail, knowledge, etc.).
5. When done, call \`runs_complete\` with a short plain-text summary.
6. If something blocks completion, call \`runs_fail\` with a clear error.

Stay scoped to a single run. Do not loop into another one without me asking.
"

install_command "rawgrowth-help" \
"List what the rawgrowth MCP server can do for this organization.

1. Call \`tools/list\` (or describe what tools the rawgrowth server exposes).
2. Group them: what reads, what writes, what's gated by approvals.
3. List any prompts (active routines).
4. End with 2-3 example commands the user could give me right now.
"

install_command "rawgrowth-chat" \
"Check my Telegram inbox via the rawgrowth MCP server and respond to every unanswered message.

Steps:
1. Call \`telegram_inbox_read\` to see unanswered messages.
2. If none, say 'Inbox zero.' and stop.
3. For each message, in order (oldest first):
   a. Understand what the user is asking for.
   b. Use the appropriate rawgrowth or native connector tools (Gmail, Slack, Drive, agents_*, routines_*, runs_*) to do the work.
   c. Call \`telegram_reply\` with that message's id and a concise, helpful response.
4. After all messages are answered, give me a one-line summary of what you handled.

Keep replies terse — Telegram, not email.
"

echo
bold "▸ Done."
echo
echo "  Next steps:"
echo "    1. Restart Claude Code (or reload it)."
echo "    2. Type   /mcp   — confirm 'rawgrowth' is listed."
echo "    3. Try    /rawgrowth-status"
echo
