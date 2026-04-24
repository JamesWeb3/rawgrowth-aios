# Rawclaw v3 — Architecture

One-liner: per-client VPS app + shared Supabase + dual-path Claude
(Claude Code CLI primary, Anthropic API fallback) + per-agent RAG
+ per-agent Telegram bots.

```
  Client Phone ──── Telegram ────────────────┐
  Client Browser ── HTTPS ───────────────────┤
                                              │
                                              ▼
                                Per-client VPS (<slug>.rawgrowth.ai)
                                ┌────────────────────────────────────┐
                                │  Next.js app (DEPLOY_MODE=v3)      │
                                │  Caddy + TLS                       │
                                │  host-level: drain-server +        │
                                │    rawgrowth-tick.timer +          │
                                │    claude + whisper-cli            │
                                └───────────────┬────────────────────┘
                                                │
                                                ▼
                                Shared Supabase (all v3 clients)
                                ┌────────────────────────────────────┐
                                │  Postgres + PostgREST + Storage +  │
                                │  Realtime. RLS by organization_id. │
                                └────────────────────────────────────┘
```

## What changed versus v2 (self-hosted)

| Surface              | v2 self-hosted                                            | v3                                                                          |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Database             | Local Postgres 16 + PostgREST in docker-compose           | Shared Supabase cloud. RLS enforces tenant isolation.                       |
| Claude runtime       | Claude Code CLI only                                      | Claude Code CLI primary + Anthropic API SDK fallback (runtime selector)     |
| Voice                | Not implemented                                           | Anthropic audio primary + `whisper.cpp` subprocess fallback                 |
| Onboarding           | Operator-only (provision-vps.sh + invite email)           | Per-VPS AI-assisted chat (ported from portal, OpenAI gpt-4o)                |
| Per-agent files      | None (knowledge was org-wide + disabled in self-hosted)   | `rgaios_agent_files` + pgvector 1536-dim chunks + `knowledge_query` MCP     |
| Per-agent Telegram   | One Telegram connection per org                           | One connection per agent via `rgaios_connections.agent_id`                  |
| Brand voice          | None                                                      | Build-time ESLint + runtime `checkBrandVoice()` on `telegram_reply`         |

## Data model additions

All on the `v3` branch. Existing `0001`–`0015` migrations unchanged.

| Migration                       | Surface                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `0016_v3_rls_by_org`            | RLS helper `rgaios_current_org_id()` + policies on every `rgaios_*`     |
| `0017_onboarding_state`         | `onboarding_completed`, `onboarding_step`, `messaging_*` on org row     |
| `0018_brand_intakes`            | 13-section JSONB answers captured during onboarding                     |
| `0019_brand_profiles`           | Versioned markdown, `generating → ready → approved`                     |
| `0020_onboarding_documents`     | Brand-kit uploads (logo, guidelines, assets)                            |
| `0021_software_access`          | Platform-access checklist (IG BM, YouTube Studio, CRM, Drive, GA)       |
| `0022_scheduled_calls`          | Calendly kickoff handoff                                                |
| `0023_scrape_snapshots`         | Public-source onboarding scrape (sites, socials, competitors)           |
| `0024_connection_agent_link`    | Per-agent Telegram bots (`agent_id` FK + relaxed unique)                |
| `0025_agent_files`              | Per-agent file metadata                                                 |
| `0026_agent_file_chunks`        | 1536-dim pgvector embeddings for RAG                                    |
| `0027_match_agent_chunks`       | RPC for cosine top-K + ivfflat index                                    |

## Runtime selector

```
 ┌─────────────────────────────┐
 │  Claude invocation site     │
 └──────────────┬──────────────┘
                │
     ┌──────────┴──────────┐
     ▼                     ▼
 Path A                 Path B
 claude --print         Anthropic SDK (Commercial key)
 client's Max OAuth     server-owned workspace key
 default                fallback on Path A failure
                        preferred for voice transcription
```

Switching paths = one env var per VPS (`ANTHROPIC_API_KEY` present vs.
absent, plus a feature flag that lives in `rgaios_organizations` for
per-org overrides — not implemented this trial, hook reserved for
post-trial).

## Request flow: voice note

```
1. Client records voice → Telegram
2. Telegram POSTs /api/webhooks/telegram/[connectionId]
3. Route detects message.voice → transcribeVoice(file_id)
     └── Path A: Anthropic audio (haiku-4.5)
     └── Path B: whisper-cli <file> -m ggml-base.en
4. Transcript injected into message.text
5. Drain-server picks up run → claude --print "drain telegram inbox"
6. Claude calls telegram_inbox_read → telegram_reply MCP
7. telegram_reply runs checkBrandVoice() → substitutes banned words
8. Telegram API receives final text → user's phone
```

## Request flow: per-agent file upload

```
1. User drops file in FileDropZone on /agents/[id]
2. POST /api/agent-files/upload (multipart)
3. Route uploads blob → Supabase Storage bucket 'agent-files'
4. Insert rgaios_agent_files metadata row
5. extractText(buf, mime): pdf-parse / mammoth / passthrough
6. chunkText: 900-char recursive split, 120-char overlap
7. embedBatch: OpenAI text-embedding-3-large @ 1536 dims
8. Insert rgaios_agent_file_chunks rows
9. Next time the agent persona runs, knowledge_query(agent_id, prompt)
   RPCs rgaios_match_agent_chunks for top-K cited context
```

## Brand-voice guard

Brief §12 bans 11 words ("game-changer", "unlock", "leverage", etc.)
from user-facing copy. Two layers:

1. **Build time**: `rawgrowth-brand/banned-words` and
   `rawgrowth-brand/banned-tailwind-defaults` ESLint rules
   (`src/lib/brand/eslint-banned-*.mjs`) fail CI on source hits.
2. **Runtime**: `telegram_reply` MCP wraps outbound text with
   `checkBrandVoice()`. Hits get rewritten to neutral substitutes and
   logged.

## Concurrency

- Drain-server caps `claude --print` spawns at 4 concurrent per VPS
  (configurable via `MAX_CONCURRENT_SPAWNS` in the systemd unit env).
- `agent_invoke` tool piggybacks on the runs queue, never spawns
  directly — inherits the same cap.
- Runaway guard: 10 iterations per tick + 120s wall-clock timeout
  live in the drain-server prompt. Inherited from v2.

## §9.8 smoke suite

See `tests/smoke.spec.ts`. Validates:

- Public sign-in page without JS errors
- Authenticated happy path (tree → agent panel)
- Brand profile page
- `/api/dashboard/gate` returns 403 before onboarding completes
- Cross-tenant RLS: wrong-org JWT returns empty or 401/403
- All primary routes clear of 5xx

## §9.6 stress suite

See `scripts/stress-telegram.sh`. 20 webhook posts in a 5s burst,
verify every one cleared the SLA via `responded_at`.
