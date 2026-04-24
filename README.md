# rawclaw v3 — backup pessoal

**Esse repo não é oficial. Serve só pra salvar os commits do trial enquanto não tenho push access no repo de verdade.**

Repo canônico: `github.com/Rawgrowth-Consulting/rawclaw` branch `v3`. Aguardando Chris liberar write access. Até lá, esse aqui evita perder o trabalho se o laptop pifar.

## pra que serve

- Checkpoint dos 14 dias de trial enquanto espero access.
- Revisar diff do celular ou outra máquina.
- Backup antes de dormir, antes de viajar, antes de qualquer `rm -rf` acidental.

## pra que NÃO serve

- Review. Chris / Scan / Ali não olham aqui.
- CI, deploy, Vercel, Hetzner — nada wired.
- PRs. Só no repo oficial, depois do access.
- Histórico permanente — vai tomar force-push toda vez que eu re-sync.

## onde tá o resto

- **Briefs (PDFs)** em `~/Downloads/`:
  - `Rawclaw v3 — Developer Brief (Pedro).pdf` — brief original do Chris
  - `rawclaw-v3-cto-brief.pdf` — CTO brief que mandei pro Chris
  - `rawclaw-v3-day1-reply.pdf` — brief técnico pro Ali
  - `rawclaw-v3-execution-plan.pdf` — plano dia-a-dia D1-D14
- **Canonical:** `github.com/Rawgrowth-Consulting/rawclaw` branch `v3` (pendente push access)
- **Working tree local:** `~/rawclaw-research/rawclaw`

## commits

Um por dia, D1 → D14:

| dia | o quê |
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

Detalhe técnico: `ARCHITECTURE-V3.md` + `DEPLOY-V3.md`.

## contribuir

não.
