# Drain re-provision runbook

How to land the drain-server changes from `c887283` (R1 startup sweep
+ safety heartbeat) and `7a35604` (R02 VPS_ORG_ID assert) on a VPS
that's already running an older drain. Both changes only take effect
on a fresh provision OR by manually updating `/opt/rawclaw-drain/
drain-server.mjs` + the systemd unit.

The R02 patch is FAIL-CLOSED: a drain that boots without `VPS_ORG_ID`
populated in `/etc/default/rawclaw-drain` will reject every POST to
`/chat`, `/triage`, `/run` with HTTP 503. Following the steps in
order matters - populating the env file FIRST means the new drain
boots already-scoped, no downtime.

## Pre-flight (one-time, on YOUR laptop)

Get the org UUID for this VPS from Supabase Cloud:

```bash
ssh root@<vps-ip> "grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' /opt/rawclaw/.env"
```

Then list the orgs visible to that service-role key:

```bash
URL=...   # from above
KEY=...   # from above
curl -sS "$URL/rest/v1/rgaios_organizations?select=id,name" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

There should be exactly one org per VPS (one-org-per-VPS invariant).
Copy its `id` - that's `VPS_ORG_ID`.

## On the VPS (root)

Run these in order. Each step is idempotent.

### 1. Populate the env file

```bash
VPS_ORG_ID=<paste-uuid-here>
mkdir -p /etc/default
[ -f /etc/default/rawclaw-drain ] || install -m 0640 -o root -g rawclaw /dev/null /etc/default/rawclaw-drain
grep -q '^VPS_ORG_ID=' /etc/default/rawclaw-drain \
  && sed -i "s|^VPS_ORG_ID=.*|VPS_ORG_ID=${VPS_ORG_ID}|" /etc/default/rawclaw-drain \
  || echo "VPS_ORG_ID=${VPS_ORG_ID}" >> /etc/default/rawclaw-drain
cat /etc/default/rawclaw-drain
```

Confirm the file contains a non-empty `VPS_ORG_ID=...` line.

### 2. Pull the latest provision-vps.sh (has the updated heredoc)

```bash
cd /opt/rawclaw
git fetch origin v3
git checkout v3
git pull --ff-only origin v3
```

### 3. Re-extract drain-server.mjs from the provision script

The drain heredoc lives between
`cat > /opt/rawclaw-drain/drain-server.mjs <<'JS'` and the next `JS`
sentinel inside `scripts/provision-vps.sh`. Re-emit it without
re-running the rest of provision:

```bash
awk "/cat > \\/opt\\/rawclaw-drain\\/drain-server.mjs <<'JS'/{flag=1; next} /^JS\$/{flag=0} flag" \
  /opt/rawclaw/scripts/provision-vps.sh \
  > /opt/rawclaw-drain/drain-server.mjs
chown rawclaw:rawclaw /opt/rawclaw-drain/drain-server.mjs
```

### 4. Re-extract the systemd unit + env-file wiring

```bash
awk "/cat > \\/etc\\/systemd\\/system\\/rawclaw-drain.service <<'UNIT'/{flag=1; next} /^UNIT\$/{flag=0} flag" \
  /opt/rawclaw/scripts/provision-vps.sh \
  > /etc/systemd/system/rawclaw-drain.service
systemctl daemon-reload
```

The new unit references
`EnvironmentFile=-/etc/default/rawclaw-drain` (the `-` makes it
tolerant of a missing file). Step 1 above already populated it, so
the drain boots scoped.

### 5. Restart + verify

```bash
systemctl restart rawclaw-drain
sleep 2
systemctl status rawclaw-drain --no-pager | head -20
journalctl -u rawclaw-drain -n 30 --no-pager
```

The log MUST show:

```
rawclaw-drain listening on 0.0.0.0:9876 org=<uuid>
drain[sweep] reason=startup command=rawgrowth-chat
drain[sweep] reason=startup command=rawgrowth-triage
```

If you see `org=UNSET` instead, the env file did not land - re-run
step 1 with the correct UUID + restart.

### 6. Probe each surface

```bash
curl -sS -X POST -w "\nstatus=%{http_code}\n" \
  http://localhost:9876/chat
curl -sS -X POST -w "\nstatus=%{http_code}\n" \
  http://localhost:9876/triage
curl -sS -X POST -H 'content-type: application/json' \
  -d '{"prompt":"probe"}' \
  -w "\nstatus=%{http_code}\n" \
  http://localhost:9876/run
```

All three should return HTTP 200 or 202 with body `ok`. A 503 with
`VPS_ORG_ID not configured; refusing spawn` means the env file is
still empty - re-do step 1.

### 7. Watch the heartbeat for 90s

```bash
journalctl -u rawclaw-drain -f --since "60 seconds ago"
```

You should see a `drain[sweep] reason=safety-heartbeat` line at the
60s mark. Ctrl-C after the second heartbeat confirms the interval
is alive.

## Rollback (if any step fails)

```bash
cd /opt/rawclaw
git log --oneline -3
git checkout <previous-sha>
# Re-run steps 3-5 to rewrite drain-server.mjs + systemd unit
# from the OLD provision-vps.sh script.
```

The env file (`/etc/default/rawclaw-drain`) is safe to leave
populated even on the old drain - it just gets ignored.

## When you DO want a clean re-provision instead

For a brand-new VPS or a VPS that needs a full reset, run
`scripts/provision-vps.sh` from your laptop with the same args you
used the first time. That script handles steps 2-5 above plus the
docker compose pull + Caddy + tick.timer wiring. Populate
`/etc/default/rawclaw-drain` (step 1) AFTER provision-vps.sh
completes, then `systemctl restart rawclaw-drain` to pick up the env.

## Notes

- `MAX_CONCURRENT_SPAWNS` defaults to 4. Override via env file if the
  VPS has > 4 GB RAM and you want more parallelism: add
  `MAX_CONCURRENT_SPAWNS=8` to `/etc/default/rawclaw-drain` and
  restart.
- `DRAIN_STARTUP_SWEEP_MS` (default 2000) and `DRAIN_SAFETY_SWEEP_MS`
  (default 60000) are similarly overridable. Set the safety sweep to
  `0` to disable the periodic heartbeat (rare; only useful when a
  client has noise-sensitive logs).
- The Telegram webhook writes a row into `rgaios_telegram_messages`
  then POSTs `localhost:9876/chat`. If the drain refuses with 503,
  the row is still in the table - the safety heartbeat will pick it
  up next time it fires OR the next inbound message will trigger a
  fresh `/chat` POST that succeeds once `VPS_ORG_ID` is populated.
- Logs land at `/var/log/rawclaw-drain.log` and via
  `journalctl -u rawclaw-drain`.
