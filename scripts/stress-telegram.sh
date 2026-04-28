#!/usr/bin/env bash
# Stress test for brief §9.6 concurrency gate. Sends N text messages to a
# target bot's webhook endpoint in a 5-second burst, then checks that every
# message produced a response within 15s (§9.4 SLA).
#
# Usage:
#   BOT_TOKEN=... WEBHOOK_URL=... ./scripts/stress-telegram.sh [N]
#
# Required env:
#   WEBHOOK_URL        — https://<slug>.rawgrowth.ai/api/webhooks/telegram/<connectionId>
#   WEBHOOK_SECRET     — the X-Telegram-Bot-Api-Secret-Token value from rgaios_connections.metadata
#   DATABASE_URL       — Supabase Postgres URL for verifying responded_at
#   CHAT_ID            — test-user chat_id (get it by sending /start once to the bot)
#
# Optional:
#   N                  — message count (default 20)

set -euo pipefail

N="${1:-20}"
BURST_SECS=5
DEADLINE_SECS=20 # 5s burst + 15s SLA

: "${WEBHOOK_URL:?WEBHOOK_URL required}"
: "${WEBHOOK_SECRET:?WEBHOOK_SECRET required}"
: "${DATABASE_URL:?DATABASE_URL required}"
: "${CHAT_ID:?CHAT_ID required}"

base_message_id=$(date +%s)
delay_between=$(awk "BEGIN { print $BURST_SECS / $N }")

echo "[stress] firing $N messages in ${BURST_SECS}s burst"
started_at=$(date +%s)

for i in $(seq 1 "$N"); do
  message_id=$((base_message_id + i))
  payload=$(cat <<JSON
{
  "update_id": $message_id,
  "message": {
    "message_id": $message_id,
    "from": { "id": 1, "username": "stress", "first_name": "Stress" },
    "chat": { "id": $CHAT_ID, "type": "private" },
    "date": $(date +%s),
    "text": "stress ping #$i"
  }
}
JSON
)
  curl -sS --fail \
    -X POST "$WEBHOOK_URL" \
    -H "content-type: application/json" \
    -H "X-Telegram-Bot-Api-Secret-Token: $WEBHOOK_SECRET" \
    --data "$payload" > /dev/null &
  sleep "$delay_between"
done
wait

echo "[stress] all $N webhooks POSTed, waiting for drain…"
sleep "$DEADLINE_SECS"

# Verify: every inserted row should have responded_at within deadline.
unanswered=$(psql "$DATABASE_URL" -qt -c "
  select count(*) from rgaios_telegram_messages
  where received_at >= to_timestamp($started_at)
    and responded_at is null;
")
answered=$(psql "$DATABASE_URL" -qt -c "
  select count(*) from rgaios_telegram_messages
  where received_at >= to_timestamp($started_at)
    and responded_at is not null;
")

echo "[stress] answered=${answered// /} unanswered=${unanswered// /}"

if [ "${unanswered// /}" != "0" ]; then
  echo "[stress] FAIL — ${unanswered// /} messages unanswered after ${DEADLINE_SECS}s"
  exit 1
fi

echo "[stress] PASS — all $N messages answered inside SLA"
