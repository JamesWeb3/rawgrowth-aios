# Rawclaw v3 — CTO Trial Delivery

Full 14-day v3 execution by Pedro (CTO trial, Apr 24 → May 7, 2026).
Branch `v3` extends `Rawgrowth-Consulting/rawclaw` with everything brief
§9 requires: per-VPS onboarding ported from the portal, shared Supabase
with RLS, voice pipeline, Telegram per-agent provisioning, agent tree,
per-agent RAG, runtime brand-voice filter, smoke suite, docs.

This mirror lives under my personal account while push access to
`Rawgrowth-Consulting/rawclaw` is pending. Same commit SHAs, same tree.
When access lands it fast-forwards to the canonical repo with no
history rewrite needed.

## Briefs (reference)

All in `~/Downloads/` in the dev environment, linked here for context:

- `Rawclaw v3 — Developer Brief (Pedro).pdf` — Chris's original brief
- `rawclaw-v3-cto-brief.pdf` — CTO brief I delivered on Day 1
- `rawclaw-v3-day1-reply.pdf` — engineering brief for Ali
- `rawclaw-v3-execution-plan.pdf` — day-by-day plan D1 → D14

## What's in here

Every §9 acceptance item maps to a commit. Read the log in order —
each day is a standalone PR-sized change with a full commit message
explaining the decision, the diff, and the §9 item it covers.

| day | what shipped | §9 coverage |
| --- | --- | --- |
| D1  | `v3` deploy mode + RLS migration (0016) + Docker compose stack | §9.1 |
| D2  | Port portal onboarding (OnboardingChat, gpt-4o agentic loop) + 6 schema migrations (0017–0022) | §9.2 |
| D3  | Brand tokens + ESLint guards for §12 (banned-tailwind-defaults + banned-words) | §12 + §7 |
| D4  | Public-source scrape pipeline + dashboard unlock gate (0023) | §9.2 scrape |
| D5  | Voice pipeline, dual-path (Anthropic native audio primary, whisper.cpp fallback bundled in Dockerfile.v3) | §9.4 voice |
| D6  | Per-agent Telegram provisioning UX (0024) + BotFather modal + seed-on-approval hook | §9.3 + §9.4 + §9.5 |
| D8  | Agent tree (ReactFlow) + right-click add sub-agent modal | §9.3 tree + add |
| D9  | Per-agent panel (5 tabs) + Supabase Realtime activity feed + read-only brand profile view | §9.3 panel + feed + brand |
| D10 | File upload + RAG per agent (0025–0027), pgvector top-K MCP tool | §9.3 files + §9.4 test |
| D11 | `agent_invoke` MCP + add-department UI + 20-msg Telegram stress script | §9.4 + §9.5 + §5 + §9.6 |
| D12 | Runtime brand-voice filter on `telegram_reply` MCP output | §12 runtime + auto-fail |
| D13 | Playwright smoke suite + `DEPLOY-V3.md` + `ARCHITECTURE-V3.md` | §9.8 + §9.9 |
| D14 | Build + lint pass-green (ESLint config scoped, Supabase types extended for the 8 new tables) | ship-ready |

`git log --oneline` will walk these in chronological order.

## Validation

| check | status |
| --- | --- |
| `npm install` (1050 packages) | ✅ |
| `npm run lint` | ✅ 0 errors, 145 warnings (all legacy / pre-v3 pattern deprecations) |
| `npm run build` | ✅ compiled in ~21s, every v3 route generated |
| `npm run dev` (on fake Supabase) | ✅ 8/8 routes respond, middleware guards work, MCP + NextAuth boot |
| Migrations apply on real Supabase | ⏳ needs Rawgrowth Supabase project access |
| Fresh-droplet install <10 min | ⏳ needs Hetzner API token |
| Live Telegram voice round-trip | ⏳ needs ANTHROPIC_API_KEY + public URL |
| Playwright smoke on staging | ⏳ needs live VPS |
| 48h Rawgrowth dogfood | ⏳ D13 once staging is up |
| Final demo + Loom | ⏳ D14, May 7 |

## Key architecture decisions

1. **Extend `rawclaw` on a `v3` branch** — not a new repo. 70% of the
   infrastructure is already in place; green-field would have wasted
   5 days re-implementing Docker Compose, Caddy, MCP, Nango, agent
   CRUD. Live v2 clients on `main` stay untouched.
2. **Two-path Claude runtime.** Claude Code CLI under the client's
   Max OAuth is primary; Anthropic Commercial API is the equal second
   path. One env var flips per VPS. Hedges the Feb 2026 ToS update.
3. **Shared Supabase per brief §2.** Dropped the single-org-per-VPS
   trigger, added RLS keyed to `organization_id` on every `rgaios_*`
   table. SQLite per VPS stays for hot agent state (memory, queue,
   audit buffer).

Detail: `ARCHITECTURE-V3.md` and `DEPLOY-V3.md`.

## What's missing

Nothing code-level. What remains is infra access + live validation:
push rights to the canonical repo, a Supabase project, a Hetzner API
token, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, the Figma file with the
design tokens, and the `RawgrowthOS/brand/voice.md` source. All listed
in the CTO brief §06.

## How to review

1. Read the CTO brief PDF (`rawclaw-v3-cto-brief.pdf`) first — it
   frames the decisions and the 14-day plan.
2. Walk `git log --oneline v3` in order. Each commit message is
   self-contained and covers the §9 item the change satisfies.
3. Jump to `ARCHITECTURE-V3.md` for the system diagram, migration
   table, and request-flow traces.
4. Jump to `DEPLOY-V3.md` for the runbook a fresh operator would
   follow on a blank Hetzner droplet.
5. Smoke suite lives in `tests/smoke.spec.ts`; stress script in
   `scripts/stress-telegram.sh`.

## Contact

Pedro — open a PR on the canonical repo once access lands, or DM me
in the WhatsApp gc with feedback any time before then.
