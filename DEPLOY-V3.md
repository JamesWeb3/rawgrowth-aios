# Deploying Rawclaw v3

This is the v3 deployment runbook. For the self-hosted (v2) per-VPS
Postgres model see `rawclaw-setup.md`; for the hosted SaaS model see
the repo README.

**Differences from v2 (self-hosted):**

- No local Postgres or PostgREST — the app talks directly to a shared
  Supabase project. Tenant isolation is RLS keyed to
  `organization_id` in the NextAuth JWT.
- Dual-path Claude runtime: Claude Code CLI under the client's Max
  OAuth is primary, the Anthropic Commercial API is the fallback. One
  env var (`DEPLOY_MODE=v3` + presence/absence of `ANTHROPIC_API_KEY`)
  toggles between them.
- `whisper.cpp` + `ggml-base.en` ship bundled in `Dockerfile.v3` for
  voice-note transcription when the Path A audio endpoint refuses.

---

## 1. One-time Supabase setup

Run once for the whole fleet (not per-VPS).

1. Create a Supabase project under the Rawgrowth org.
2. Export the project URL, anon key, service-role key, and the
   Postgres connection string.
3. Apply migrations `0001` through `0027` via the Supabase SQL editor,
   or point `scripts/migrate.ts` at the connection string:
   ```bash
   DATABASE_URL=postgres://... npm run self-hosted:migrate
   ```
4. Confirm RLS is ON for every `rgaios_*` table (the `0016_v3_rls_by_org`
   and per-new-table policies handle this).

## 2. Per-client VPS provisioning

1. Point DNS: add an A-record for `<slug>.rawgrowth.ai` at the new
   Hetzner CPX22.
2. SSH into the box, clone the repo (deploy key flow lives in
   `scripts/provision-vps.sh`).
3. Copy `.env.v3.example` to `.env` and fill in:
   - **shared** (same every VPS): `DATABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - **per-VPS**: `CADDY_SITE_ADDRESS`, `NEXTAUTH_URL`,
     `NEXTAUTH_SECRET`, `JWT_SECRET`, `CRON_SECRET`, `SEED_ORG_*`
   - **Anthropic fallback**: `ANTHROPIC_API_KEY` (used by voice + the
     Path B runtime switch)
   - **OpenAI**: `OPENAI_API_KEY` (onboarding chat + embeddings)
4. Boot:
   ```bash
   docker compose -f docker-compose.v3.yml up -d --build
   ```
5. Hand the invite URL printed during first-boot seeding to the
   client operator.
6. Walk the client through Claude Code login (Max plan) on the host:
   ```bash
   sudo -iu rawclaw claude login
   ```

## 3. What ships on each VPS

- Next.js app (`app` service in `docker-compose.v3.yml`)
- Caddy (`caddy` service) with TLS via Let's Encrypt
- Host-level `rawclaw-drain.service` and `rawgrowth-tick.timer`
  installed by `scripts/provision-vps.sh` (unchanged from v2)
- `whisper-cli` + `ggml-base.en.bin` inside the app image for voice
  fallback

## 4. Runtime selector

Every Claude call goes through a two-path selector:

| Path              | When                                       |
|-------------------|--------------------------------------------|
| Claude Code CLI   | Default. Uses client's Max OAuth.          |
| Anthropic SDK     | Fallback. `ANTHROPIC_API_KEY` must be set. |

Voice transcription (`src/lib/voice/transcribe.ts`) uses the same
pattern — native Anthropic audio is preferred when the API key is
present, `whisper-cli` is the fallback.

## 5. Banned-words enforcement

- **Build time**: ESLint rules `rawgrowth-brand/banned-tailwind-defaults`
  and `rawgrowth-brand/banned-words` (see `eslint.config.mjs`) fail
  CI on banned tokens in source.
- **Runtime**: `telegram_reply` MCP tool passes outbound text through
  `checkBrandVoice()` (`src/lib/brand/runtime-filter.ts`) and rewrites
  each banned word into a neutral substitute before sending.

## 6. §9.8 smoke test

Run after every deploy:

```bash
E2E_BASE_URL=https://<slug>.rawgrowth.ai \
E2E_OWNER_EMAIL=... \
E2E_OWNER_PASSWORD=... \
E2E_OTHER_ORG_JWT=... \
npm run test:smoke
```

Zero tolerance: any 5xx or console error on the primary routes fails
the suite. The cross-tenant RLS check in particular is a hard gate.

## 7. Stress test

Before final demo, hit the new bot with the burst script:

```bash
WEBHOOK_URL=... \
WEBHOOK_SECRET=... \
DATABASE_URL=... \
CHAT_ID=... \
./scripts/stress-telegram.sh 20
```

Success = every message answered inside the 15s SLA. Failures surface
with the unanswered count.

## 8. Rollback

v3 runs on a `v3` branch off `main`. To roll back to v2:

1. Point the VPS at the previous self-hosted compose file:
   ```bash
   docker compose -f docker-compose.yml up -d --build
   ```
2. Restore the local Postgres volume snapshot if you took one.
3. Revert the client's DNS if the domain changed.

v3 does **not** touch the v2 production data — Supabase is a fresh
project. Live v2 clients stay on `main`.
