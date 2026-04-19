# Rawgrowth AIOS

**An AI operating system for 7–9 figure companies.** Delivered as a SaaS platform (each client gets a unique subdomain), sold as a $10K/mo retainer with white-glove setup. The product is a **custom AI workforce** — a hierarchy of AI agents with live access to every tool the client's business runs on, running autonomous workflows on triggers, governed by a real org chart.

Rawgrowth is built on two tightly-coupled pieces of tech:

1. **Company LLM (via MCP)** — a per-tenant MCP server that exposes the client's entire stack (Gmail, Drive, HubSpot, Stripe, Shopify, Slack, Fathom, etc.) as custom tools. Tools run **live against provider APIs**, not against a cached database. Any MCP-compatible client — Claude Desktop, Claude Cowork, Claude Code, Cursor, a Telegram bot — can plug into it and query the company as if it were a single unified data source.
2. **Agent Organization** — custom AI agents arranged in an org chart, running repeatable workflows (routines) on triggers, with approvals and audit trail baked in.

The MCP server is the read and write surface. The agents are the autonomous workers. Integrations (mediated through Nango) power both.

---

## 1 — Company LLM

Not a vector store. **A live, unified, per-tenant query layer** over the client's connected tools, exposed as a private MCP server URL.

### What it is

When a client onboards, we configure a custom MCP server for them: `https://acme.aios.rawgrowth.ai/mcp`. That URL exposes a curated set of tools — `search_gmail`, `draft_email`, `find_client`, `query_revenue`, `post_to_wins_channel`, etc. — each tailored to *their* business. When a tool is called (by their team in Claude Desktop, or by one of their agents in a routine), our server proxies the call straight to the provider's API using the OAuth tokens we hold.

No data is pre-indexed. No vector store. No sync workers. Everything is live.

This has three consequences worth naming:

- **Always fresh.** Results reflect the state of Gmail/Shopify/etc. at the moment the tool is called. Never stale.
- **Zero ingest infrastructure.** No embedding costs, no chunking pipeline, no bronze/silver/gold tables for integration content. Only orchestration state lives in our DB.
- **Per-client customization is the moat.** Generic "search my inbox" is commodity. What clients pay $10K/mo for is *their* tools: `find_client(name)` that handles their spelling variants, `post_weekly_digest()` that knows their template and Slack channel, `check_churn_risk(id)` that fans across Stripe + HubSpot + their support system with their own rules.

### What integrations contribute

Each connected tool is exposed as a set of MCP tools — some read, some write:

| Tool | Example read tools | Example write tools |
| --- | --- | --- |
| Gmail | `search_emails`, `get_thread`, `list_contacts` | `draft_email`, `send_email`, `add_label` |
| Google Drive | `search_drive`, `get_file`, `list_recent` | `create_doc`, `update_doc` |
| HubSpot | `find_contact`, `get_deal`, `search_notes` | `create_note`, `update_deal_stage` |
| Shopify | `query_revenue`, `top_customers`, `search_orders` | `create_order`, `update_inventory` |
| Stripe | `list_payments`, `customer_ltv` | `issue_refund`, `create_customer` |
| Slack | `search_messages`, `list_channels` | `post_message`, `update_message` |
| Fathom | `find_meeting`, `get_transcript` | — |
| Notion | `search_pages`, `get_page` | `create_page`, `append_block` |

Tools are defined in code; scopes are requested at connection time; write tools may be gated by the approvals layer (see Pillar 2).

### Access surfaces

The MCP URL isn't locked to the Rawgrowth app. It plugs into any MCP-compatible client, so the client's team uses it from wherever they already work:

- **Claude Desktop** — `{ "mcpServers": { "acme": { "url": "...", "headers": { "Authorization": "Bearer ..." } } } }` and the team chats with their whole stack.
- **Claude Cowork / Claude Code / Cursor** — same pattern, same URL.
- **In-app agents** — the agent runtime (Pillar 2) calls the same MCP tools during autonomous routines.
- **Telegram / custom bots** — a thin wrapper queries the MCP server so team members ask questions from anywhere.

**The unit economics unlock**: interactive queries from human team members flow through their own Claude subscription. Claude Desktop does the reasoning; we just serve data. Our API bill only kicks in for autonomous agent runs (routines firing without a human). Clients pay for their own inference on the chat side, we meter ours on the automation side.

### Integration auth, simplified with Nango

We use [Nango](https://www.nango.dev) as the auth and proxy layer. Clients still connect via OAuth or API key, but Nango handles:

- Token storage, encryption, refresh, expiry
- Rate limiting, retries, pagination
- 250+ pre-built provider configs

Our MCP tool implementations collapse from "fetch fresh token → construct request → retry on 401 → handle pagination" to a single `nango.proxy()` call per endpoint. Net: we skip writing a full HTTP client per integration, and integration #4–20 takes hours instead of weeks.

For sensitive/restricted scopes (Gmail `send`, Drive `readonly`, etc.), OAuth client verification is still required — that's a Google/Meta/Slack requirement, not a Nango one. Our enterprise unlock: **domain-wide delegation for Google Workspace clients** — their IT admin grants our service account authority to impersonate users across their domain. No CASA review, no consent screens, no per-user friction. Fits the $10K/mo buyer profile perfectly.

---

## 2 — Agent Organization

A customer's AI workforce: a hierarchy of custom AI agents, each with a role, a manager, a budget, and a job description.

### Agents

Clients hire agents inside the app the same way they'd hire humans:

- **Name + title** — e.g. Atlas, *Head of Growth*
- **Role** — CEO / CTO / Engineer / Marketer / SDR / Ops Manager / Designer / General
- **Reports-to** — a manager in the org chart (or none, if they're a root)
- **Job description** — plain-English responsibilities
- **Runtime** — which model powers them (Claude Sonnet/Opus/Haiku, GPT, Gemini)
- **Monthly budget** — hard spend cap; agent stops when hit
- **Write policy** — per-tool permissions (draft-only / requires-approval / direct) so a loose agent can't accidentally send 500 customer emails

Agents are visualised as an org chart with connector lines. Clicking any card opens an edit sheet with pause, resume, and fire actions. Every agent has access to the same MCP tools the human team uses — which is how they "know" the business.

### Routines — automated workflows

Agents don't sit idle. Each agent owns one or more **routines** — repeatable workflows that fire on triggers.

A routine is simply:

> **trigger** + **assigned agent** + **natural-language instructions**

The agent decides *how* to execute using its available MCP tools. No node graph, no step-by-step DAG — the LLM is the planner.

### Trigger types

- **Schedule** — cron expression or preset (every hour, every weekday at 9, every Monday, custom).
- **Webhook** — Rawgrowth mints a unique inbound URL per trigger; any service can POST JSON to fire the routine.
- **Integration event** — fires when a connected tool emits an event (e.g. *Fathom — Meeting ended*, *Stripe — Payment succeeded*, *Shopify — New order*, *HubSpot — Deal stage changed*). Events from unconnected integrations are greyed out in the UI with a "Connect" CTA.
- **Manual** — explicit "Run now" only; useful for ad-hoc execution.

Multiple triggers per routine supported. Any trigger firing runs the routine.

### Approvals — the safety rail

Every write tool call an agent makes can be gated by an approval. The `approvals` queue surfaces proposed actions in the UI; a human clicks approve → the action fires server-side. Default policy for externally-visible writes (email send, Slack post to public channel, Stripe refund) is *requires approval*. For routine internal automation (update deal stage, post to #private-internal) agents can execute directly. Policy is configurable per agent per tool, with a full audit log.

This is what makes an agent platform safe to ship at enterprise: the difference between *"our AI accidentally emailed 500 customers with the wrong price"* and *"our AI drafted 500 emails and a human approved them in batches."*

### A concrete routine

**Post-call SOP generator**

- **Trigger**: Fathom — *Meeting ended*
- **Agent**: Atlas, Head of Client Success
- **Instructions**:
  1. Pull the transcript from the webhook payload.
  2. Call `find_client(name)` to locate the account across HubSpot + Drive.
  3. Call `get_recent_notes(client_id)` to pull prior SOP drafts.
  4. Draft an updated SOP.
  5. Call `draft_email(to: account_manager, subject: ..., body: ...)` — draft lands in the account manager's Gmail drafts folder for human review and send.

Every tool call happens live against the provider. No data was pre-indexed. The routine runs in ~15 seconds, costs a few cents in API fees, and the client team sees a drafted email in Gmail waiting for them.

---

## How the two pillars interlock

```
                  ┌──────────────────────────┐
                  │      Integrations        │
                  │  (Gmail, Drive, HubSpot, │
                  │   Stripe, Shopify, etc.) │
                  └────────────┬─────────────┘
                               │
                    via OAuth / API keys
                               │
                               ▼
                    ┌──────────────────────┐
                    │        Nango         │
                    │  (auth + API proxy)  │
                    └──────────┬───────────┘
                               │
                               ▼
                 ┌──────────────────────────┐
                 │   Per-tenant MCP server  │
                 │  (live tools, read+write)│
                 └──────┬───────────────┬───┘
                        │               │
              queried by │               │ called by
                        ▼               ▼
          ┌────────────────────┐  ┌────────────────────┐
          │  Human team via    │  │  Agent Organization│
          │  Claude Desktop /  │  │   (autonomous      │
          │  Cowork / Code /   │  │    routines, runs  │
          │  Cursor / Telegram │  │    24/7)           │
          │  — paid by their   │  │   — paid by API,   │
          │  Claude sub        │  │    client billed   │
          └────────────────────┘  └────────────────────┘
```

Nango serves both pillars: it's how humans and agents alike reach into live provider data.

---

## What we're NOT building (deliberate deferrals)

Clarity on what's *not* in scope saves time later:

- **Pre-indexed vector store of integration content.** Dropped entirely. Claude Connectors and Claude Cowork are commoditizing this fast; we differentiate on the agent + routine layer, not on owning a copy of the client's data.
- **Custom embeddings / RAG pipeline.** Not needed when tools fetch live.
- **Our own chat UI.** Clients use Claude Desktop / Cowork / Cursor. We don't compete with those.
- **Model fine-tuning.** System prompts + examples in the routine instructions do the personalisation.

What *does* live in our DB: `connections` (OAuth tokens + API keys), `agents`, `routines`, `routine_triggers`, `routine_runs`, `approvals`, `audit_log`. That's the orchestration layer — ~10 tables — not a data warehouse.

---

## The pitch at $10K/mo

You're not buying *"an AI that knows your company."* Claude already sells that.

You're buying:

> Your AI workforce — a custom org chart of agents with budgets, routines, and approvals — wired into every tool your company uses. Plug their MCP URL into Claude Desktop and your entire team has company-wide AI access. Set up in a week. Runs 24/7.

---

## Current build state

**Stack**: Next.js 16 App Router · Tailwind v4 · shadcn/ui on Base UI · Neon Postgres (control plane only) · Vercel deployment · Nango for integration auth + proxy · MCP server at `/api/mcp`.

**Shipped**:

- Dashboard with four business-pillar charts
- Integrations catalog UI with per-integration connection sheet (API Key / OAuth / Webhook UX)
- Agents page unified with Org Chart — tree layout, click-to-edit sheet, hire/fire/pause flows
- Routines builder with four trigger kinds; integration-event triggers gated by connection status
- Shared design primitives (PageShell, EmptyState, sidebar, user popover)
- Live Google OAuth flow, deployed to Vercel
- Remote HTTP MCP server at `/api/mcp` with bearer-token auth; connects cleanly to Claude Desktop

**In flight — pivot to the new architecture**:

- Rip out the RAG/sync pipeline (`bronze_drive_files`, `drive_files`, `drive_file_chunks`, FTS5). Deprecated.
- Rewire OAuth flow through Nango SDK instead of bespoke Google client. One flow serves 250+ providers.
- Rewrite MCP tools as thin `nango.proxy()` calls — live API, no DB reads for integration content.
- Add write tools (`draft_email`, `send_email`, `create_doc`, etc.) gated by approvals layer.
- Add `audit_log` entries for every tool call (read and write).

**Next after that**:

- Autonomous agent runtime via Claude Agent SDK for scheduled routines.
- Domain-wide delegation option for Google Workspace clients (enterprise install path, sidesteps CASA).
- Per-tenant MCP URLs and token provisioning (subdomain or path-based).
- Cost metering per agent per company via Vercel AI Gateway (autonomous runs only).
