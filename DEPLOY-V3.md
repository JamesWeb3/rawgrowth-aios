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
3. Run `scripts/wire-supabase.sh` from a workstation. This:
   - writes a templated `.env.production` with the four Supabase
     values + auto-minted `NEXTAUTH_SECRET`/`JWT_SECRET`/`CRON_SECRET`
   - provisions the two private storage buckets used by RAG +
     Knowledge (`agent-files` 50 MB cap, `knowledge` 10 MB cap)
   ```bash
   ./scripts/wire-supabase.sh \
     "postgres://postgres:PWD@db.<project>.supabase.co:5432/postgres" \
     "https://<project>.supabase.co" \
     "sb_publishable_..." \
     "sb_secret_..."
   ```
4. Apply migrations `0001` through `0032` via the Supabase SQL editor,
   or point `scripts/migrate.ts` at the connection string:
   ```bash
   DATABASE_URL=postgres://... npm run self-hosted:migrate
   ```
5. Confirm RLS is ON for every `rgaios_*` table (the `0016_v3_rls_by_org`
   and per-new-table policies handle this).

## 2. Per-client VPS provisioning

1. Point DNS: add an A-record for `<slug>.rawgrowth.ai` at the new
   Hetzner CPX22.
2. SSH into the box, clone the repo (deploy key flow lives in
   `scripts/provision-vps.sh`).
3. Copy the `.env.production` produced by `wire-supabase.sh` (step 1.3)
   to the VPS as `.env`. wire-supabase.sh has already filled the four
   shared Supabase values, the three rotated secrets, and selected
   Path A (`RUNTIME_PATH=cli` + `CLAUDE_CLI_PATH`). Add the per-VPS
   values:
   - **per-VPS**: `CADDY_SITE_ADDRESS` (= `<slug>.rawgrowth.ai`),
     `NEXTAUTH_URL` (= `https://<slug>.rawgrowth.ai`),
     `SEED_ORG_NAME`, `SEED_ORG_SLUG`, `SEED_ADMIN_EMAIL`
   - **Anthropic fallback (optional)**: `ANTHROPIC_API_KEY` if you
     want Path B available; voice transcription also uses it before
     falling back to whisper-cli
   - **OpenAI (optional)**: `OPENAI_API_KEY` for onboarding chat
     fallback + embedding (see §1 — the multi-provider abstraction
     defaults to Path A CLI, so this is only needed if `LLM_PROVIDER`
     is flipped to `openai` per call site)
   - **Heartbeat**: `HEARTBEAT_INTERVAL_SEC=600` (defaults to 10 min;
     drop to 60-120 for the demo)
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
