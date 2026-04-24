# rawclaw v3 — personal backup

**This repo is not official. Exists only to save commits from the CTO trial while I wait for push access to the real one.**

Canonical: `github.com/Rawgrowth-Consulting/rawclaw` branch `v3`. Waiting on Chris to grant write access. Until then, this keeps the work safe if the laptop dies.

## what it's for

- Checkpoint the 14 days of trial work while I wait for access.
- Review diffs from my phone or another machine.
- Backup before sleep, before travel, before any accidental `rm -rf`.

## what it's NOT for

- Review. Chris / Scan / Ali don't look here.
- CI, deploy, Vercel, Hetzner — nothing wired.
- PRs. Only on the canonical repo, after access.
- Permanent history — gets force-pushed every time I re-sync.

## where the rest lives

- **Briefs (PDFs)** in `~/Downloads/`:
  - `Rawclaw v3 — Developer Brief (Pedro).pdf` — Chris's original brief
  - `rawclaw-v3-cto-brief.pdf` — CTO brief I sent Chris
  - `rawclaw-v3-day1-reply.pdf` — engineering brief for Ali
  - `rawclaw-v3-execution-plan.pdf` — day-by-day plan D1-D14
- **Canonical:** `github.com/Rawgrowth-Consulting/rawclaw` branch `v3` (pending push access)
- **Local working tree:** `~/rawclaw-research/rawclaw`

## commits

One per day, D1 → D14:

| day | what |
| --- | --- |
| D1  | deploy mode + RLS migration + compose stack |
| D2  | port portal onboarding + 6 schema migrations |
| D3  | brand tokens + ESLint guards §12 |
| D4  | scrape pipeline + dashboard gate |
| D5  | voice pipeline dual-path + whisper.cpp |
| D6  | Telegram per-agent provisioning UX |
| D8  | agent tree ReactFlow + add sub-agent modal |
| D9  | per-agent panel + activity feed + brand view |
| D10 | file upload + RAG per agent |
| D11 | agent_invoke MCP + add-dept + stress script |
| D12 | runtime brand-voice filter |
| D13 | Playwright smoke + deploy/arch docs |
| D14 | build + lint pass prep |

Technical detail: `ARCHITECTURE-V3.md` + `DEPLOY-V3.md`.

## contributing

don't.
